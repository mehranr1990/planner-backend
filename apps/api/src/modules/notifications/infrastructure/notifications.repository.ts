import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as c from '@mehran/api-contracts';
import type {
  Prisma,
  Reminder,
  NotificationDelivery,
} from '../../../generated/prisma/client.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import { APP_CONFIG } from '../../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../../bootstrap/environment.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { ReminderTasks } from '../../tasks/public/index.js';
import { NotificationIdentity } from '../../account/public/index.js';
import { SpacesService } from '../../spaces/public/index.js';
import { writeAudit } from '../../../platform/audit/audit.service.js';
import { appendOutbox } from '../../../platform/outbox/outbox.js';
import { NotificationOutbox } from '../../../platform/outbox/notification-consumer.js';
import { idempotent } from '../../../platform/database/idempotency.js';
import type { MutationReceipt } from '../../../platform/database/idempotency.js';
import {
  afterCursor,
  cursorPosition,
  cursorPage,
} from '../../../platform/database/cursor-pagination.js';
import { NotificationsPort } from '../application/notifications.port.js';
import type {
  NotificationResource,
  NotificationWrite,
} from '../application/notifications.port.js';
import {
  NotificationStore,
  plain,
  reminderView,
  deliveryView,
  pendingStates,
  digest,
} from './notification-store.js';
import { safeEndpoint, validPushKeys } from './transport.js';
import { NotificationTransport } from '../application/transport.port.js';
import type {
  TransportMessage,
  TransportResult,
} from '../application/transport.port.js';
import { localParts, retryAt, overdueGraceMs } from '../domain/timing.js';
@Injectable()
export class NotificationsRepository extends NotificationsPort {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ReminderTasks) private readonly tasks: ReminderTasks,
    @Inject(NotificationIdentity)
    private readonly account: NotificationIdentity,
    @Inject(SpacesService) private readonly spaces: SpacesService,
    @Inject(NotificationOutbox) private readonly outbox: NotificationOutbox,
    @Inject(NotificationTransport)
    private readonly transport: NotificationTransport,
  ) {
    super();
  }
  private store(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    return new NotificationStore(tx, scope, this.tasks, this.account);
  }
  private async run<T>(
    scope: AuthorizedSpace,
    work: (s: NotificationStore) => Promise<T>,
  ) {
    return this.db.client.$transaction(
      async (tx) => {
        const s = this.store(tx, scope);
        await s.lock();
        await s.identity();
        return work(s);
      },
      { timeout: 30000 },
    );
  }
  private available() {
    return [
      'IN_APP',
      ...(this.config.NOTIFICATION_EMAIL_ENABLED ? ['EMAIL'] : []),
      ...(this.config.PUSH_MODE !== 'disabled' ? ['WEB_PUSH'] : []),
    ];
  }
  private preferenceView(row: unknown) {
    return {
      ...(plain(row) as object),
      availableChannels: this.available(),
      webPushPublicKey:
        this.config.PUSH_MODE === 'webpush'
          ? (this.config.PUSH_VAPID_PUBLIC_KEY ?? null)
          : null,
    };
  }
  private subscriptionView(row: {
    endpoint: string | null;
    auth: string | null;
    p256dh: string | null;
    endpointHash: string;
    [key: string]: unknown;
  }) {
    const {
      endpoint: _e,
      auth: _a,
      p256dh: _p,
      endpointHash: _h,
      ...rest
    } = row;
    return plain(rest);
  }
  private notificationView(row: { localDate: Date }) {
    return {
      ...(plain(row) as object),
      localDate: row.localDate.toISOString().slice(0, 10),
    };
  }
  async query(
    scope: AuthorizedSpace,
    resource: NotificationResource,
    id: string | undefined,
    query: Record<string, unknown>,
  ) {
    return this.run(scope, async (s) => {
      if (resource === 'preferences')
        return this.preferenceView(await s.preferences());
      if (id && resource === 'reminders')
        return reminderView(await s.reminder(id));
      if (id && resource === 'notifications')
        return this.notificationView(await s.notification(id));
      if (id && resource === 'subscriptions') {
        const row = await s.tx.pushSubscription.findFirst({
          where: s.where({ id }),
        });
        if (!row) throw new NotFoundException();
        return this.subscriptionView(row);
      }
      const limit = Number(query.limit ?? 25),
        filter =
          'notifications:' +
          resource +
          ':' +
          digest({ ...query, cursor: undefined, limit: undefined, id }).slice(
            0,
            40,
          ),
        position = cursorPosition(
          scope,
          filter,
          typeof query.cursor === 'string' ? query.cursor : undefined,
        ),
        common = { ...s.where(afterCursor(position)) },
        args = {
          take: limit + 1,
          orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
        };
      if (resource === 'reminders') {
        const rows = await s.tx.reminder.findMany({
          ...args,
          where: {
            ...common,
            ...(typeof query.state === 'string' ? { state: query.state } : {}),
            ...(typeof query.taskId === 'string'
              ? { taskId: query.taskId }
              : {}),
          },
        });
        const page = cursorPage(scope, filter, limit, rows);
        return { ...page, items: page.items.map(reminderView) };
      }
      if (resource === 'subscriptions') {
        const rows = await s.tx.pushSubscription.findMany({
          ...args,
          where: {
            ...common,
            ...(typeof query.state === 'string' ? { state: query.state } : {}),
          },
        });
        const page = cursorPage(scope, filter, limit, rows);
        return {
          ...page,
          items: page.items.map((v) => this.subscriptionView(v)),
        };
      }
      if (resource === 'deliveries') {
        if (!id) throw new BadRequestException();
        await s.reminder(id);
        const rows = await s.tx.notificationDelivery.findMany({
          ...args,
          where: {
            ...common,
            reminderId: id,
            ...(typeof query.state === 'string' ? { state: query.state } : {}),
            ...(typeof query.kind === 'string' ? { kind: query.kind } : {}),
          },
        });
        const page = cursorPage(scope, filter, limit, rows);
        return { ...page, items: page.items.map(deliveryView) };
      }
      const rows = await s.tx.notification.findMany({
        ...args,
        where: {
          ...common,
          ...(query.history === 'true' ? {} : { inbox: true }),
          ...(typeof query.reminderId === 'string'
            ? { reminderId: query.reminderId }
            : {}),
          ...(query.state === 'UNREAD'
            ? { readAt: null, dismissedAt: null }
            : query.state === 'READ'
              ? { readAt: { not: null }, dismissedAt: null }
              : query.state === 'DISMISSED'
                ? { dismissedAt: { not: null } }
                : { dismissedAt: null }),
        },
      });
      const page = cursorPage(scope, filter, limit, rows);
      return {
        ...page,
        items: page.items.map((v) => this.notificationView(v)),
      };
    });
  }
  async mutate(scope: AuthorizedSpace, command: NotificationWrite) {
    // Environment restriction precedes receipt replay as well as new effects.
    if (command.action === 'test' && this.config.NODE_ENV === 'production')
      throw new NotFoundException();
    const receipt = await idempotent(
      this.db.client,
      scope,
      'notifications.' + command.resource + '.' + command.action,
      command.key,
      command,
      async (tx) => {
        const s = this.store(tx, scope);
        await s.lock();
        await s.identity();
        const result = await this.write(s, command);
        return {
          resultId: result.id as string,
          statusCode:
            command.action === 'create' || command.action === 'test'
              ? 201
              : 200,
          result: plain(result) as NonNullable<MutationReceipt['result']>,
        };
      },
    );
    return receipt.result;
  }
  private async audit(
    s: NotificationStore,
    action:
      | 'REMINDER_CHANGE'
      | 'NOTIFICATION_CHANGE'
      | 'NOTIFICATION_PREFERENCE_CHANGE'
      | 'PUSH_SUBSCRIPTION_CHANGE',
    id: string,
  ) {
    await writeAudit(s.tx, {
      action,
      outcome: 'SUCCEEDED',
      actorUserId: s.scope.actor.userId,
      requestId: s.scope.actor.requestId,
      correlationId: s.scope.actor.correlationId,
      resourceId: id,
    });
  }
  private expected(row: { revision: number }, revision: number | undefined) {
    if (revision === undefined) throw new BadRequestException();
    if (row.revision !== revision) throw new ConflictException();
  }
  private async write(
    s: NotificationStore,
    cmd: NotificationWrite,
  ): Promise<Record<string, unknown>> {
    const now = await s.now();
    if (cmd.action === 'test') {
      if (this.config.NODE_ENV === 'production') throw new NotFoundException();
      const body = c.NotificationTestSchema.parse(cmd.body);
      return this.create(
        s,
        c.ReminderCreateSchema.parse({
          title: 'Channel test',
          rule: { version: 1, kind: 'ABSOLUTE', at: now.toISOString() },
          channels: [body.channel],
        }),
      );
    }
    if (cmd.resource === 'reminders') {
      if (cmd.action === 'create')
        return this.create(s, c.ReminderCreateSchema.parse(cmd.body));
      const before = await s.reminder(cmd.id!);
      this.expected(before, cmd.revision);
      if (cmd.action === 'patch') {
        const patch = c.ReminderPatchSchema.parse(cmd.body),
          data = c.ReminderCreateSchema.safeParse({
            title: before.title,
            body: before.body,
            taskId: before.taskId,
            taskRevision: before.selectedTaskRevision ?? undefined,
            rule: before.rule,
            timezoneMode: before.timezoneMode,
            timezone: before.timezone,
            channels: before.channels,
            urgent: before.urgent,
            ...patch,
            ...(patch.taskId === null ? { taskRevision: undefined } : {}),
          });
        if (!data.success) throw new BadRequestException();
        const v = data.data;
        this.checkChannels(v.channels);
        await s.validateTask(v.taskId, v.taskRevision ?? null);
        await s.cancelPending(before.id, 'RESCHEDULED');
        await s.tx.reminder.update({
          where: { id: before.id },
          data: {
            title: v.title,
            body: v.body,
            taskId: v.taskId,
            selectedTaskRevision: v.taskRevision ?? null,
            rule: v.rule as Prisma.InputJsonValue,
            timezoneMode: v.timezoneMode,
            timezone: v.timezone ?? before.timezone,
            channels: v.channels,
            urgent: v.urgent,
            sourceStamp: null,
            cursorDate: null,
            exhausted: false,
            ruleVersion: { increment: 1 },
            revision: { increment: 1 },
          },
        });
      } else {
        const state =
          cmd.action === 'pause'
            ? 'PAUSED'
            : cmd.action === 'resume'
              ? 'ACTIVE'
              : cmd.action === 'cancel'
                ? 'CANCELED'
                : null;
        if (!state) throw new BadRequestException();
        if (state === 'ACTIVE') {
          await s.validateTask(
            before.taskId,
            before.taskId
              ? ((await s.tasks.read(s.tx, s.scope, before.taskId))?.revision ??
                  null)
              : null,
          );
          if (
            (await s.tx.reminder.count({
              where: s.where({ state: 'ACTIVE' }),
            })) >= 1000 &&
            before.state !== 'ACTIVE'
          )
            throw new ConflictException();
        } else
          await s.cancelPending(
            before.id,
            state === 'PAUSED' ? 'PAUSED' : 'USER',
          );
        await s.tx.reminder.update({
          where: { id: before.id },
          data: {
            state,
            reason: state === 'CANCELED' ? 'USER' : null,
            pausedAt: state === 'PAUSED' ? now : null,
            canceledAt: state === 'CANCELED' ? now : null,
            nextAt: null,
            sourceStamp: state === 'ACTIVE' ? null : before.sourceStamp,
            cursorDate: state === 'ACTIVE' ? null : before.cursorDate,
            exhausted: state === 'ACTIVE' ? false : before.exhausted,
            revision: { increment: 1 },
          },
        });
      }
      await s.reconcile(
        await s.reminder(before.id),
        cmd.action === 'resume' || cmd.action === 'patch' ? 'RESUME' : 'NORMAL',
      );
      await this.audit(s, 'REMINDER_CHANGE', before.id);
      await appendOutbox(s.tx, s.scope, {
        type: 'reminder.changed',
        version: 1,
        aggregateId: before.id,
        payload: {},
      });
      return reminderView(await s.reminder(before.id)) as Record<
        string,
        unknown
      >;
    }
    if (cmd.resource === 'preferences') {
      const before = await s.preferences();
      this.expected(before, cmd.revision);
      const v = {
        ...before,
        ...c.NotificationPreferencePatchSchema.parse(cmd.body),
      };
      if (
        (v.quietStart === null) !== (v.quietEnd === null) ||
        (v.quietStart !== null && v.quietStart === v.quietEnd)
      )
        throw new BadRequestException();
      if (
        (v.email && !this.config.NOTIFICATION_EMAIL_ENABLED) ||
        (v.webPush && this.config.PUSH_MODE === 'disabled')
      )
        throw new BadRequestException();
      const row = await s.tx.notificationPreference.update({
        where: { id: before.id },
        data: {
          inApp: v.inApp ?? before.inApp,
          email: v.email ?? before.email,
          webPush: v.webPush ?? before.webPush,
          reactivateOnReopen: v.reactivateOnReopen ?? before.reactivateOnReopen,
          quietStart: v.quietStart ?? null,
          quietEnd: v.quietEnd ?? null,
          revision: { increment: 1 },
        },
      });
      const disabled = ['IN_APP', 'EMAIL', 'WEB_PUSH'].filter(
        (ch) => !s.enabled(ch, row),
      );
      const enabled = ['IN_APP', 'EMAIL', 'WEB_PUSH'].filter((ch) =>
        s.enabled(ch, row),
      );
      await s.tx.notificationDelivery.updateMany({
        where: s.where({
          kind: 'CHANNEL',
          channel: { in: enabled },
          state: { in: ['CANCELED', 'SKIPPED'] },
          reason: 'CHANNEL_DISABLED',
          scheduledAt: { gt: now },
          networkStartedAt: null,
          sentAt: null,
          reminder: { state: 'ACTIVE' },
        }),
        data: {
          state: 'PENDING',
          reason: null,
          reactivatedAt: now,
          notBefore: now,
          revision: { increment: 1 },
        },
      });
      await s.tx.notificationDelivery.updateMany({
        where: s.where({ state: { in: ['PENDING', 'RETRY'] } }),
        data: { notBefore: now, revision: { increment: 1 } },
      });
      await s.tx.notificationDelivery.updateMany({
        where: s.where({
          channel: { in: disabled },
          state: { in: pendingStates },
          networkStartedAt: null,
        }),
        data: {
          state: 'CANCELED',
          reason: 'CHANNEL_DISABLED',
          canceledAt: now,
          leaseToken: null,
          leaseUntil: null,
          revision: { increment: 1 },
        },
      });
      await this.audit(s, 'NOTIFICATION_PREFERENCE_CHANGE', row.id);
      return this.preferenceView(row);
    }
    if (cmd.resource === 'subscriptions') {
      if (cmd.action === 'revoke') {
        const before = await s.tx.pushSubscription.findFirst({
          where: s.where({ id: cmd.id! }),
        });
        if (!before) throw new NotFoundException();
        this.expected(before, cmd.revision);
        const row = await s.tx.pushSubscription.update({
          where: { id: before.id },
          data: {
            state: 'REVOKED',
            endpoint: null,
            auth: null,
            p256dh: null,
            revokedAt: now,
            revision: { increment: 1 },
          },
        });
        await this.audit(s, 'PUSH_SUBSCRIPTION_CHANGE', row.id);
        return this.subscriptionView(row) as Record<string, unknown>;
      }
      if (this.config.PUSH_MODE === 'disabled') throw new BadRequestException();
      const body = c.PushSubscriptionCreateSchema.parse(cmd.body),
        endpoint = safeEndpoint(body.endpoint);
      if (!endpoint || !validPushKeys(body.keys))
        throw new BadRequestException();
      const existing = cmd.id
        ? await s.tx.pushSubscription.findFirst({
            where: s.where({ id: cmd.id }),
          })
        : await s.tx.pushSubscription.findFirst({
            where: s.where({ endpointHash: endpoint.hash }),
          });
      if (cmd.id) {
        if (!existing) throw new NotFoundException();
        this.expected(existing, cmd.revision);
        if (existing.endpointHash !== endpoint.hash)
          throw new ConflictException();
      } else if (existing) throw new ConflictException();
      if (
        (!existing || existing.state !== 'ACTIVE') &&
        (await s.tx.pushSubscription.count({
          where: s.where({ state: 'ACTIVE' }),
        })) >= 20
      )
        throw new ConflictException();
      const data = {
        label: body.label,
        endpoint: endpoint.endpoint,
        endpointHost: endpoint.host,
        endpointHash: endpoint.hash,
        auth: body.keys.auth,
        p256dh: body.keys.p256dh,
        state: 'ACTIVE',
        revokedAt: null,
      };
      const row = existing
        ? await s.tx.pushSubscription.update({
            where: { id: existing.id },
            data: { ...data, revision: { increment: 1 } },
          })
        : await s.tx.pushSubscription.create({
            data: { ...s.owner(), ...data },
          });
      await this.audit(s, 'PUSH_SUBSCRIPTION_CHANGE', row.id);
      return this.subscriptionView(row) as Record<string, unknown>;
    }
    if (cmd.resource === 'notifications') {
      const before = await s.notification(cmd.id!);
      this.expected(before, cmd.revision);
      if (cmd.action === 'snooze')
        return this.snooze(
          s,
          before,
          c.NotificationSnoozeSchema.parse(cmd.body).until,
        );
      const body =
        cmd.action === 'read' ? c.NotificationReadSchema.parse(cmd.body) : null;
      if (cmd.action !== 'read' && cmd.action !== 'dismiss')
        throw new BadRequestException();
      const row = await s.tx.notification.update({
        where: { id: before.id },
        data: body
          ? {
              readAt: body.read ? now : null,
              acknowledgedAt: body.read
                ? (before.acknowledgedAt ?? now)
                : before.acknowledgedAt,
              revision: { increment: 1 },
            }
          : {
              dismissedAt: now,
              acknowledgedAt: before.acknowledgedAt ?? now,
              revision: { increment: 1 },
            },
      });
      await this.audit(s, 'NOTIFICATION_CHANGE', row.id);
      return this.notificationView(row);
    }
    throw new BadRequestException();
  }
  private checkChannels(channels: string[]) {
    if (channels.some((ch) => !this.available().includes(ch)))
      throw new BadRequestException();
  }
  private async create(s: NotificationStore, v: c.ReminderCreate) {
    this.checkChannels(v.channels);
    if (
      (await s.tx.reminder.count({ where: s.where({ state: 'ACTIVE' }) })) >=
      1000
    )
      throw new ConflictException();
    await s.validateTask(v.taskId, v.taskRevision ?? null);
    const identity = await s.identity();
    const row = await s.tx.reminder.create({
      data: {
        ...s.owner(),
        title: v.title,
        body: v.body,
        taskId: v.taskId,
        selectedTaskRevision: v.taskRevision ?? null,
        rule: v.rule as Prisma.InputJsonValue,
        timezoneMode: v.timezoneMode,
        timezone:
          v.timezoneMode === 'ACCOUNT' ? identity.timezone : v.timezone!,
        channels: v.channels,
        urgent: v.urgent,
      },
    });
    await s.reconcile(row);
    await this.audit(s, 'REMINDER_CHANGE', row.id);
    await appendOutbox(s.tx, s.scope, {
      type: 'reminder.changed',
      version: 1,
      aggregateId: row.id,
      payload: {},
    });
    return reminderView(await s.reminder(row.id)) as Record<string, unknown>;
  }
  private async snooze(
    s: NotificationStore,
    before: Awaited<ReturnType<NotificationStore['notification']>>,
    until: string,
  ) {
    const at = new Date(until),
      now = await s.now();
    if (at <= now || at.getTime() > now.getTime() + 365 * 86400000)
      throw new BadRequestException();
    const r = await s.reminder(before.reminderId);
    if (r.state !== 'ACTIVE') throw new ConflictException();
    if (
      await s.tx.notificationDelivery.count({
        where: s.where({ reminderId: r.id, kind: 'CHANNEL', scheduledAt: at }),
      })
    )
      throw new ConflictException();
    const p = localParts(at, r.timezone),
      source = await s.tx.notificationDelivery.findMany({
        where: s.where({ notificationId: before.id, kind: 'CHANNEL' }),
      });
    await s.insert(
      r,
      at,
      'snooze:' + before.id + ':' + at.toISOString(),
      p.date,
      p.time,
      r.timezone,
    );
    const rows = await s.tx.notificationDelivery.findMany({
      where: s.where({ reminderId: r.id, kind: 'CHANNEL', scheduledAt: at }),
    });
    for (const row of rows)
      await s.tx.notificationDelivery.update({
        where: { id: row.id },
        data: {
          sourceNotificationId: before.id,
          sourceDeliveryId:
            source.find((d) => d.channel === row.channel)?.id ?? null,
        },
      });
    const notification = await s.tx.notification.update({
      where: { id: before.id },
      data: {
        snoozedAt: now,
        acknowledgedAt: before.acknowledgedAt ?? now,
        revision: { increment: 1 },
      },
    });
    await this.audit(s, 'NOTIFICATION_CHANGE', before.id);
    return {
      id: before.id,
      revision: notification.revision,
      notification: this.notificationView(notification),
      deliveries: (
        await s.tx.notificationDelivery.findMany({
          where: s.where({
            reminderId: r.id,
            kind: 'CHANNEL',
            scheduledAt: at,
          }),
        })
      ).map(deliveryView),
    };
  }
  private async background(ownerUserId: string, spaceId: string) {
    const id = randomUUID(),
      scope = await this.spaces.authorizePersonal({
        userId: ownerUserId,
        requestId: id,
        correlationId: id,
      });
    if (scope.spaceId !== spaceId) throw new NotFoundException();
    return scope;
  }
  async sweep(after?: string) {
    const rows = await this.db.client.reminder.findMany({
      where: {
        ...(after ? { id: { gt: after } } : {}),
        OR: [
          { state: 'ACTIVE' },
          { state: 'CANCELED', reason: 'TASK_INACTIVE' },
          {
            deliveries: {
              some: { state: 'PROCESSING', leaseUntil: { lt: new Date() } },
            },
          },
        ],
      },
      orderBy: { id: 'asc' },
      take: 100,
    });
    for (const row of rows) {
      try {
        const scope = await this.background(row.ownerUserId, row.spaceId);
        await this.run(scope, async (s) => {
          await s.reconcile(await s.reminder(row.id));
          await this.recover(s);
        });
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
      }
    }
    return rows.length === 100 ? rows.at(-1)!.id : null;
  }
  async consumeOutbox() {
    return this.outbox.consume(async (tx, event) => {
      const rows = await tx.reminder.findMany({
        where: {
          spaceId: event.spaceId,
          ...(event.type.startsWith('task.')
            ? { taskId: event.aggregateId }
            : event.type === 'reminder.changed'
              ? { id: event.aggregateId }
              : {}),
        },
        take: 1000,
        orderBy: { id: 'asc' },
      });
      if (!rows[0]) return;
      const scope = await this.background(rows[0].ownerUserId, event.spaceId),
        s = this.store(tx, scope);
      await s.lock();
      for (const row of rows) await s.reconcile(await s.reminder(row.id));
    });
  }
  private async recover(s: NotificationStore) {
    const now = await s.now();
    await s.tx.notificationDelivery.updateMany({
      where: s.where({
        state: 'PROCESSING',
        leaseUntil: { lt: now },
        networkStartedAt: null,
      }),
      data: {
        state: 'RETRY',
        reason: 'LEASE_RECOVERED',
        leaseToken: null,
        leaseUntil: null,
        notBefore: now,
        revision: { increment: 1 },
      },
    });
    await s.tx.notificationDelivery.updateMany({
      where: s.where({
        state: 'PROCESSING',
        leaseUntil: { lt: now },
        networkStartedAt: { not: null },
      }),
      data: {
        state: 'AMBIGUOUS',
        reason: 'ACCEPTANCE_UNKNOWN',
        leaseToken: null,
        leaseUntil: null,
        revision: { increment: 1 },
      },
    });
  }
  async pending() {
    const rows = await this.db.client.notificationDelivery.findMany({
      where: {
        state: { in: ['PENDING', 'RETRY'] },
        notBefore: { lte: new Date(Date.now() + 7 * 86400000) },
      },
      orderBy: [
        { queuedAt: { sort: 'asc', nulls: 'first' } },
        { notBefore: 'asc' },
        { id: 'asc' },
      ],
      take: 100,
      select: { id: true, notBefore: true },
    });
    if (rows.length)
      await this.db.client.notificationDelivery.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { queuedAt: new Date() },
      });
    return rows.map((r) => ({ id: r.id, at: r.notBefore! }));
  }
  async dispatch(id: string) {
    const row = await this.db.client.notificationDelivery.findUnique({
      where: { id },
    });
    if (!row) return;
    let scope: AuthorizedSpace;
    try {
      scope = await this.background(row.ownerUserId, row.spaceId);
    } catch {
      return;
    }
    if (row.channel === 'WEB_PUSH' && row.kind === 'CHANNEL') {
      await this.fanout(scope, id);
      return;
    }
    const message = await this.run(scope, (s) => this.gate(s, id));
    if (!message) return;
    const result = await this.transport.send(message);
    await this.run(scope, (s) =>
      this.finish(s, id, message.leaseToken, result),
    );
  }
  private async gate(
    s: NotificationStore,
    id: string,
  ): Promise<(TransportMessage & { leaseToken: string }) | null> {
    let d = await s.tx.notificationDelivery.findFirst({
      where: s.where({ id }),
    });
    if (!d || !['PENDING', 'RETRY'].includes(d.state)) return null;
    let r = await s.reminder(d.reminderId);
    await s.reconcile(r);
    r = await s.reminder(r.id);
    d = await s.tx.notificationDelivery.findFirstOrThrow({
      where: s.where({ id }),
    });
    if (!['PENDING', 'RETRY'].includes(d.state)) return null;
    const now = await s.now(),
      prefs = await s.preferences(),
      identity = await s.identity();
    if (
      r.state !== 'ACTIVE' ||
      !s.enabled(d.channel, prefs) ||
      !this.available().includes(d.channel)
    ) {
      await s.tx.notificationDelivery.update({
        where: { id },
        data: {
          state: 'CANCELED',
          reason: 'DELIVERY_DISABLED',
          canceledAt: now,
          revision: { increment: 1 },
        },
      });
      return null;
    }
    if (
      !d.scheduledAt ||
      d.scheduledAt.getTime() < now.getTime() - overdueGraceMs
    ) {
      await s.tx.notificationDelivery.update({
        where: { id },
        data: {
          state: 'EXPIRED',
          reason: 'MISSED',
          revision: { increment: 1 },
        },
      });
      return null;
    }
    if (await s.defer(d, r, prefs, r.timezone, now)) return null;
    if (
      d.kind === 'CHANNEL' &&
      (await s.tx.notificationDelivery.findFirst({
        where: s.where({
          reminderId: d.reminderId,
          kind: 'CHANNEL',
          id: { not: d.id },
          occurrenceKey: d.occurrenceKey,
          channel: d.channel,
          state: { in: ['DELIVERED', 'AMBIGUOUS', 'PROCESSING'] },
        }),
      }))
    ) {
      await s.tx.notificationDelivery.update({
        where: { id: d.id },
        data: {
          state: 'SKIPPED',
          reason: 'LOCAL_ALREADY_DELIVERED',
          revision: { increment: 1 },
        },
      });
      return null;
    }
    let subscription:
      { endpoint: string; keys: { auth: string; p256dh: string } } | undefined;
    if (d.kind === 'ENDPOINT') {
      const sub = await s.tx.pushSubscription.findFirst({
        where: s.where({
          id: d.subscriptionId!,
          state: 'ACTIVE',
          revision: d.subscriptionRevision!,
        }),
      });
      if (!sub?.endpoint || !sub.auth || !sub.p256dh) {
        await s.tx.notificationDelivery.update({
          where: { id },
          data: {
            state: 'SKIPPED',
            reason: 'SUBSCRIPTION_REVOKED',
            revision: { increment: 1 },
          },
        });
        return null;
      }
      subscription = {
        endpoint: sub.endpoint,
        keys: { auth: sub.auth, p256dh: sub.p256dh },
      };
    }
    const notification = await this.notificationFor(s, d, r);
    if (d.channel === 'IN_APP') {
      await s.tx.notification.update({
        where: { id: notification.id },
        data: {
          inbox: true,
          firstDeliveredAt: notification.firstDeliveredAt ?? now,
        },
      });
      await s.tx.notificationDelivery.update({
        where: { id },
        data: {
          notificationId: notification.id,
          state: 'DELIVERED',
          attempts: { increment: 1 },
          sentAt: now,
          revision: { increment: 1 },
        },
      });
      return null;
    }
    const token = randomUUID();
    await s.tx.notificationDelivery.update({
      where: { id },
      data: {
        notificationId: notification.id,
        state: 'PROCESSING',
        attempts: { increment: 1 },
        leaseToken: token,
        leaseUntil: new Date(now.getTime() + 60000),
        networkStartedAt: now,
        revision: { increment: 1 },
      },
    });
    return {
      deliveryId: id,
      notificationId: notification.id,
      leaseToken: token,
      channel: d.channel as 'EMAIL' | 'WEB_PUSH',
      ...(d.channel === 'EMAIL' ? { email: identity.email } : {}),
      ...(subscription ? { subscription } : {}),
    };
  }
  private async notificationFor(
    s: NotificationStore,
    d: NotificationDelivery,
    r: Reminder,
  ) {
    if (!d.scheduledAt) throw new Error('MISSING_DELIVERY_INSTANT');
    return s.tx.notification.upsert({
      where: {
        reminderId_scheduledAt: {
          reminderId: r.id,
          scheduledAt: d.scheduledAt,
        },
      },
      create: {
        ...s.owner(),
        reminderId: r.id,
        scheduledAt: d.scheduledAt,
        occurrenceKey: d.occurrenceKey,
        timezone: d.timezone,
        localDate: d.localDate,
        title: r.title,
        body: r.body,
        sourceNotificationId: d.sourceNotificationId,
      },
      update: {},
    });
  }
  private async finish(
    s: NotificationStore,
    id: string,
    leaseToken: string,
    result: TransportResult,
  ) {
    const d = await s.tx.notificationDelivery.findFirst({
      where: s.where({ id, state: 'PROCESSING', leaseToken }),
    });
    if (!d) return;
    const now = await s.now();
    let state =
      result.outcome === 'ACCEPTED'
        ? 'DELIVERED'
        : result.outcome === 'AMBIGUOUS'
          ? 'AMBIGUOUS'
          : result.outcome === 'GONE'
            ? 'SKIPPED'
            : result.outcome === 'RETRY' &&
                d.attempts < 5 &&
                !d.cancelRequestedAt
              ? 'RETRY'
              : 'FAILED';
    const retry = state === 'RETRY' ? retryAt(now, d.attempts) : null;
    if (d.cancelRequestedAt && state === 'RETRY') state = 'CANCELED';
    await s.tx.notificationDelivery.update({
      where: { id },
      data: {
        state,
        reason: result.code,
        lastErrorCode: result.outcome === 'ACCEPTED' ? null : result.code,
        retryAt: retry,
        notBefore: retry ?? d.notBefore,
        sentAt: state === 'DELIVERED' ? now : null,
        leaseToken: null,
        leaseUntil: null,
        revision: { increment: 1 },
      },
    });
    if (state === 'DELIVERED' && d.notificationId)
      await s.tx.notification.updateMany({
        where: s.where({ id: d.notificationId, firstDeliveredAt: null }),
        data: { firstDeliveredAt: now },
      });
    if (result.outcome === 'GONE' && d.subscriptionId)
      await s.tx.pushSubscription.updateMany({
        where: s.where({
          id: d.subscriptionId,
          revision: d.subscriptionRevision!,
        }),
        data: {
          state: 'REVOKED',
          endpoint: null,
          auth: null,
          p256dh: null,
          revokedAt: now,
          revision: { increment: 1 },
        },
      });
  }
  private async fanout(scope: AuthorizedSpace, id: string) {
    const children = await this.run(scope, async (s) => {
      const d = await s.tx.notificationDelivery.findFirst({
        where: s.where({ id }),
      });
      if (!d || !['PENDING', 'RETRY'].includes(d.state)) return [];
      let r = await s.reminder(d.reminderId);
      await s.reconcile(r);
      r = await s.reminder(r.id);
      const current = await s.tx.notificationDelivery.findUniqueOrThrow({
          where: { id },
        }),
        prefs = await s.preferences(),
        now = await s.now();
      if (!['PENDING', 'RETRY'].includes(current.state)) return [];
      if (!prefs.webPush || this.config.PUSH_MODE === 'disabled') {
        await s.tx.notificationDelivery.update({
          where: { id },
          data: {
            state: 'SKIPPED',
            reason: 'CHANNEL_DISABLED',
            revision: { increment: 1 },
          },
        });
        return [];
      }
      if (await s.defer(current, r, prefs, r.timezone, now)) return [];
      if (
        await s.tx.notificationDelivery.findFirst({
          where: s.where({
            reminderId: d.reminderId,
            OR: [
              { kind: 'CHANNEL', id: { not: d.id } },
              { kind: 'ENDPOINT', parentId: { not: d.id } },
            ],
            occurrenceKey: d.occurrenceKey,
            channel: 'WEB_PUSH',
            state: { in: ['DELIVERED', 'AMBIGUOUS', 'PROCESSING'] },
          }),
        })
      ) {
        await s.tx.notificationDelivery.update({
          where: { id },
          data: {
            state: 'SKIPPED',
            reason: 'LOCAL_ALREADY_DELIVERED',
            revision: { increment: 1 },
          },
        });
        return [];
      }
      const old = await s.tx.notificationDelivery.findMany({
        where: s.where({ parentId: id }),
      });
      if (old.length) return old.map((row) => row.id);
      const subscriptions = await s.tx.pushSubscription.findMany({
        where: s.where({ state: 'ACTIVE' }),
        orderBy: { id: 'asc' },
        take: 20,
      });
      if (!subscriptions.length) {
        await s.tx.notificationDelivery.update({
          where: { id },
          data: {
            state: 'SKIPPED',
            reason: 'NO_SUBSCRIPTIONS',
            revision: { increment: 1 },
          },
        });
        return [];
      }
      for (const sub of subscriptions)
        await s.tx.notificationDelivery.create({
          data: {
            ...s.owner(),
            reminderId: d.reminderId,
            kind: 'ENDPOINT',
            parentId: id,
            subscriptionId: sub.id,
            subscriptionRevision: sub.revision,
            sourceNotificationId: d.sourceNotificationId,
            sourceDeliveryId: d.sourceDeliveryId,
            channel: 'WEB_PUSH',
            scheduledAt: d.scheduledAt,
            notBefore: d.notBefore,
            occurrenceKey: d.occurrenceKey,
            ruleVersion: d.ruleVersion,
            timezone: d.timezone,
            localDate: d.localDate,
            localTime: d.localTime,
          },
        });
      return (
        await s.tx.notificationDelivery.findMany({
          where: s.where({ parentId: id }),
        })
      ).map((row) => row.id);
    });
    for (const child of children) await this.dispatch(child);
    await this.run(scope, async (s) => {
      const parent = await s.tx.notificationDelivery.findFirst({
        where: s.where({ id }),
      });
      if (!parent || !['PENDING', 'RETRY'].includes(parent.state)) return;
      const rows = await s.tx.notificationDelivery.findMany({
        where: s.where({ parentId: id }),
      });
      if (!rows.length) return;
      const pending = rows.filter((row) => pendingStates.includes(row.state)),
        state = pending.length
          ? 'RETRY'
          : rows.some((row) => row.state === 'AMBIGUOUS')
            ? 'AMBIGUOUS'
            : rows.some((row) => row.state === 'FAILED')
              ? 'FAILED'
              : rows.some((row) => row.state === 'DELIVERED')
                ? 'DELIVERED'
                : 'SKIPPED';
      const at = pending
        .map((row) => row.notBefore ?? new Date())
        .sort((a, b) => a.getTime() - b.getTime())[0];
      await s.tx.notificationDelivery.update({
        where: { id },
        data: {
          state,
          notBefore: at ?? parent.notBefore,
          attempts: Math.max(...rows.map((row) => row.attempts)),
          notificationId:
            rows.find((row) => row.notificationId)?.notificationId ?? null,
          sentAt: state === 'DELIVERED' ? await s.now() : null,
          revision: { increment: 1 },
        },
      });
    });
  }
}
