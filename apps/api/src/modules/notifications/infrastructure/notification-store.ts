import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import * as c from '@mehran/api-contracts';
import type {
  Prisma,
  Reminder,
  NotificationDelivery,
  NotificationPreference,
} from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import type { ReminderTasks, ReminderTask } from '../../tasks/public/index.js';
import type { NotificationIdentity } from '../../account/public/index.js';
import { writeAudit } from '../../../platform/audit/audit.service.js';
import {
  addDays,
  dueOn,
  localParts,
  resolveLocal,
  overdueGraceMs,
  quietUntil,
  countThrough,
} from '../domain/timing.js';
export const pendingStates = ['PENDING', 'RETRY', 'PROCESSING'];
export const dateOnly = (d: string) => new Date(d + 'T00:00:00Z');
export const digest = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function plain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}
export function reminderView(row: Reminder) {
  const { cursorDate: _cursor, sourceStamp: _stamp, ...rest } = row;
  return plain(rest);
}
export function deliveryView(row: NotificationDelivery) {
  const {
    leaseToken: _token,
    jobId: _job,
    queuedAt: _queued,
    retryAt: _retry,
    ...rest
  } = row;
  return {
    ...(plain(rest) as object),
    localDate: row.localDate.toISOString().slice(0, 10),
  };
}
export const usableTask = (task: ReminderTask | null) =>
  !!task &&
  !task.deletedAt &&
  !task.master &&
  ['OPEN', 'IN_PROGRESS'].includes(task.status) &&
  (!task.occurrenceState || task.occurrenceState === 'PENDING');
export class NotificationStore {
  private audit(
    resourceId: string,
    action: 'REMINDER_CHANGE' | 'NOTIFICATION_CHANGE' = 'REMINDER_CHANGE',
  ) {
    return writeAudit(this.tx, {
      action,
      outcome: 'SUCCEEDED',
      actorUserId: this.scope.actor.userId,
      requestId: this.scope.actor.requestId,
      correlationId: this.scope.actor.correlationId,
      resourceId,
    });
  }
  constructor(
    readonly tx: Prisma.TransactionClient,
    readonly scope: AuthorizedSpace,
    readonly tasks: ReminderTasks,
    readonly account: NotificationIdentity,
  ) {}
  owner() {
    return {
      spaceId: this.scope.spaceId,
      ownerUserId: this.scope.actor.userId,
      createdByUserId: this.scope.actor.userId,
    };
  }
  where<T extends object>(value: T) {
    return { ...value, spaceId: this.scope.spaceId };
  }
  async lock() {
    await this.tasks.lock(this.tx, this.scope);
    await this.tx
      .$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`notifications:${this.scope.spaceId}`},0))::text`;
  }
  async now() {
    const [r] = await this.tx.$queryRaw<
      Array<{ now: Date }>
    >`SELECT clock_timestamp() AS now`;
    return r!.now;
  }
  async identity() {
    const identity = await this.account.read(this.tx, this.scope);
    if (!identity) throw new NotFoundException();
    return identity;
  }
  async preferences() {
    return this.tx.notificationPreference.upsert({
      where: { spaceId: this.scope.spaceId },
      create: this.owner(),
      update: {},
    });
  }
  async reminder(id: string) {
    const r = await this.tx.reminder.findFirst({ where: this.where({ id }) });
    if (!r) throw new NotFoundException();
    return r;
  }
  async notification(id: string) {
    const r = await this.tx.notification.findFirst({
      where: this.where({ id }),
    });
    if (!r) throw new NotFoundException();
    return r;
  }
  async cancelPending(reminderId: string, reason: string) {
    const now = await this.now();
    await this.tx.notificationDelivery.updateMany({
      where: this.where({
        reminderId,
        OR: [
          { state: { in: ['PENDING', 'RETRY'] } },
          { state: 'PROCESSING', networkStartedAt: null },
        ],
      }),
      data: {
        state: 'CANCELED',
        reason,
        canceledAt: now,
        leaseToken: null,
        leaseUntil: null,
        revision: { increment: 1 },
      },
    });
    await this.tx.notificationDelivery.updateMany({
      where: this.where({
        reminderId,
        state: 'PROCESSING',
        networkStartedAt: { not: null },
      }),
      data: { cancelRequestedAt: now, revision: { increment: 1 } },
    });
  }
  enabled(channel: string, p: NotificationPreference) {
    return channel === 'IN_APP'
      ? p.inApp
      : channel === 'EMAIL'
        ? p.email
        : p.webPush;
  }
  async validateTask(id: string | null, revision: number | null) {
    if (!id) return null;
    const task = await this.tasks.read(this.tx, this.scope, id);
    if (!task || task.deletedAt) throw new NotFoundException();
    if (task.revision !== revision) throw new ConflictException();
    if (!usableTask(task)) throw new BadRequestException();
    return task;
  }
  async insert(
    r: Reminder,
    instant: Date | null,
    key: string,
    localDate: string,
    time: string,
    zone: string,
    reason?: string,
  ) {
    const now = await this.now(),
      p = await this.preferences();
    for (const channel of r.channels) {
      const exists = await this.tx.notificationDelivery.findFirst({
        where: this.where({
          reminderId: r.id,
          kind: 'CHANNEL',
          ...(instant
            ? { scheduledAt: instant, channel }
            : {
                scheduledAt: null,
                occurrenceKey: key,
                ruleVersion: r.ruleVersion,
                channel,
              }),
        }),
      });
      if (exists) {
        if (
          exists.state === 'CANCELED' &&
          instant &&
          instant > now &&
          !exists.networkStartedAt &&
          !exists.sentAt &&
          this.enabled(channel, p)
        ) {
          await this.tx.notificationDelivery.update({
            where: { id: exists.id },
            data: {
              state: 'PENDING',
              reason: null,
              notBefore: instant,
              reactivatedAt: now,
              occurrenceKey: key,
              timezone: zone,
              localDate: dateOnly(localDate),
              localTime: time,
              ruleVersion: r.ruleVersion,
              cancelRequestedAt: null,
              leaseToken: null,
              leaseUntil: null,
              revision: { increment: 1 },
            },
          });
          await this.audit(exists.id, 'NOTIFICATION_CHANGE');
        }
        continue;
      }
      const deliveredLocal = await this.tx.notificationDelivery.findFirst({
        where: this.where({
          reminderId: r.id,
          occurrenceKey: key,
          channel,
          state: { in: ['DELIVERED', 'AMBIGUOUS', 'PROCESSING'] },
        }),
      });
      const state = reason
        ? 'SKIPPED'
        : deliveredLocal
          ? 'SKIPPED'
          : instant && instant.getTime() < now.getTime() - overdueGraceMs
            ? 'EXPIRED'
            : !this.enabled(channel, p)
              ? 'SKIPPED'
              : 'PENDING';
      await this.tx.notificationDelivery.create({
        data: {
          ...this.owner(),
          reminderId: r.id,
          channel,
          scheduledAt: instant,
          notBefore: instant,
          occurrenceKey: key,
          ruleVersion: r.ruleVersion,
          timezone: zone,
          localDate: dateOnly(localDate),
          localTime: time,
          state,
          reason:
            reason ??
            (deliveredLocal
              ? 'LOCAL_ALREADY_DELIVERED'
              : state === 'EXPIRED'
                ? 'MISSED'
                : state === 'SKIPPED'
                  ? 'CHANNEL_DISABLED'
                  : null),
        },
      });
    }
  }
  async reconcile(input: Reminder, mode: 'NORMAL' | 'RESUME' = 'NORMAL') {
    let r = input;
    const identity = await this.identity(),
      p = await this.preferences(),
      now = await this.now(),
      task = r.taskId
        ? await this.tasks.read(this.tx, this.scope, r.taskId)
        : null;
    if (r.state === 'CANCELED' && r.reason === 'USER') return;
    if (r.state === 'PAUSED') return;
    if (r.taskId && !usableTask(task)) {
      await this.cancelPending(r.id, 'TASK_INACTIVE');
      if (r.state !== 'CANCELED' || r.reason !== 'TASK_INACTIVE') {
        await this.tx.reminder.update({
          where: { id: r.id },
          data: {
            state: 'CANCELED',
            reason: 'TASK_INACTIVE',
            canceledAt: now,
            nextAt: null,
            revision: { increment: 1 },
          },
        });
        await this.audit(r.id);
      }
      return;
    }
    if (
      r.state === 'CANCELED' &&
      r.reason === 'TASK_INACTIVE' &&
      p.reactivateOnReopen &&
      task
    ) {
      const candidate = c.ReminderRuleSchema.parse(r.rule),
        zone = r.timezoneMode === 'ACCOUNT' ? identity.timezone : r.timezone;
      let future: Date | null = null;
      if (candidate.kind === 'ABSOLUTE') future = new Date(candidate.at);
      else if (candidate.kind === 'LOCAL')
        future = resolveLocal(
          candidate.startDate,
          candidate.time,
          zone,
        ).instant;
      else {
        future =
          candidate.field === 'DUE_AT'
            ? task.dueAt
            : candidate.field === 'PLANNED_START_AT'
              ? task.plannedStartAt
              : task.scheduledDate
                ? resolveLocal(
                    task.scheduledDate.toISOString().slice(0, 10),
                    candidate.localTime!,
                    zone,
                  ).instant
                : null;
        if (future)
          future = new Date(future.getTime() + candidate.offsetMinutes * 60000);
      }
      if (!future || future <= now) return;
      if (
        (await this.tx.reminder.count({
          where: this.where({ state: 'ACTIVE' }),
        })) >= 1000
      )
        return;
      r = await this.tx.reminder.update({
        where: { id: r.id },
        data: {
          state: 'ACTIVE',
          reason: null,
          canceledAt: null,
          sourceStamp: null,
          cursorDate: null,
          exhausted: false,
          revision: { increment: 1 },
        },
      });
      await this.audit(r.id);
      mode = 'RESUME';
    }
    if (r.state !== 'ACTIVE') return;
    const rule = c.ReminderRuleSchema.parse(r.rule),
      zone = r.timezoneMode === 'ACCOUNT' ? identity.timezone : r.timezone,
      stamp = digest({
        rule,
        zone,
        channels: r.channels,
        task:
          rule.kind === 'TASK'
            ? {
                dueAt: task?.dueAt,
                plannedStartAt: task?.plannedStartAt,
                scheduledDate: task?.scheduledDate,
              }
            : null,
      });
    if (r.sourceStamp !== stamp) {
      if (r.sourceStamp) {
        await this.cancelPending(r.id, 'RESCHEDULED');
        await this.audit(r.id);
        mode = 'RESUME';
      }
      r = await this.tx.reminder.update({
        where: { id: r.id },
        data: {
          timezone: zone,
          sourceStamp: stamp,
          cursorDate: null,
          exhausted: false,
          ruleVersion: r.sourceStamp ? { increment: 1 } : r.ruleVersion,
          revision: r.sourceStamp ? { increment: 1 } : r.revision,
        },
      });
    }
    if (r.exhausted) return;
    if (rule.kind === 'ABSOLUTE' || rule.kind === 'TASK') {
      let at: Date | null = null;
      let gap = false;
      let local = localParts(now, zone);
      if (rule.kind === 'ABSOLUTE') at = new Date(rule.at);
      else if (task) {
        if (rule.field === 'SCHEDULED_DATE' && task.scheduledDate) {
          const date = task.scheduledDate.toISOString().slice(0, 10);
          local = { date, time: rule.localTime!, seconds: '00' };
          at = resolveLocal(date, rule.localTime!, zone).instant;
          gap = at === null;
        } else at = rule.field === 'DUE_AT' ? task.dueAt : task.plannedStartAt;
        if (at) at = new Date(at.getTime() + rule.offsetMinutes * 60000);
      }
      if (at) local = localParts(at, zone);
      if (at || gap) {
        if (mode !== 'RESUME' || !at || at > now)
          await this.insert(
            r,
            at,
            (rule.kind === 'ABSOLUTE' ? 'utc:' : 'task:') +
              (at?.toISOString() ?? local.date + 'T' + local.time),
            local.date,
            local.time,
            zone,
            gap ? 'DST_GAP' : undefined,
          );
      }
      await this.tx.reminder.update({
        where: { id: r.id },
        data: {
          nextAt: at && at > now ? at : null,
          exhausted: true,
          reason: at || gap ? null : 'MISSING_SOURCE_DATE',
        },
      });
      return;
    }
    let date = r.cursorDate?.toISOString().slice(0, 10) ?? rule.startDate;
    if (mode === 'RESUME' && date < localParts(now, zone).date)
      date = localParts(now, zone).date;
    const end = addDays(localParts(now, zone).date, 7);
    let examined = 0,
      exhausted = false;
    for (; date <= end && examined < 100; date = addDays(date, 1), examined++) {
      if (
        date > '9998-12-31' ||
        (!rule.recurrence && date > rule.startDate) ||
        (rule.recurrence?.count !== null &&
          rule.recurrence?.count !== undefined &&
          countThrough(addDays(date, -1), rule.startDate, rule.recurrence) >=
            rule.recurrence.count) ||
        (rule.recurrence?.until && date > rule.recurrence.until)
      ) {
        exhausted = true;
        break;
      }
      if (!dueOn(date, rule.startDate, rule.recurrence)) continue;
      const at = resolveLocal(date, rule.time, zone).instant;
      if (mode === 'RESUME' && at && at <= now) continue;
      await this.insert(
        r,
        at,
        'local:' + date + 'T' + rule.time,
        date,
        rule.time,
        zone,
        at ? undefined : 'DST_GAP',
      );
    }
    const next = await this.tx.notificationDelivery.findFirst({
      where: this.where({
        reminderId: r.id,
        kind: 'CHANNEL',
        state: { in: ['PENDING', 'RETRY'] },
        scheduledAt: { gt: now },
      }),
      orderBy: { scheduledAt: 'asc' },
    });
    await this.tx.reminder.update({
      where: { id: r.id },
      data: {
        cursorDate: dateOnly(date),
        exhausted,
        nextAt: next?.scheduledAt ?? null,
      },
    });
  }
  async defer(
    d: NotificationDelivery,
    r: Reminder,
    p: NotificationPreference,
    zone: string,
    now: Date,
  ) {
    if (!d.scheduledAt) return null;
    const at = quietUntil(
      new Date(
        Math.max(
          now.getTime(),
          d.scheduledAt.getTime(),
          d.retryAt?.getTime() ?? 0,
        ),
      ),
      zone,
      p.quietStart,
      p.quietEnd,
      r.urgent,
    );
    if (at > now) {
      await this.tx.notificationDelivery.update({
        where: { id: d.id },
        data: {
          notBefore: at,
          state: d.state === 'PROCESSING' ? 'RETRY' : d.state,
          leaseToken: null,
          leaseUntil: null,
          revision: { increment: 1 },
        },
      });
      return at;
    }
    return null;
  }
}
