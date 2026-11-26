import { SharedKernel } from '../spaces/public/index.js';
import { lockEngagementPersonal } from '../spaces/public/engagement-availability.js';
import { engagementPersonalOpen } from '../spaces/public/engagement-availability.js';
import { checkedPolicy } from './engagement-core.js';
import {
  Injectable,
  Inject,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  adminEngagementRoutes as routes,
  P4Audience,
} from '@mehran/api-contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import type { AdminCommand } from '../../platform/admin/admin-command.js';
import { AdminCommand as Command } from '../../platform/admin/admin-command.js';
import { IdentityMailService } from '../../platform/auth/mail.service.js';
import { APP_CONFIG } from '../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../bootstrap/environment.js';
import {
  communicationEligibility,
  communicationNeedsApproval,
  renderCommunication as pure_renderCommunication,
  validateTemplate as pure_validateTemplate,
  type CommunicationType,
  type LocalizedTemplate,
} from '../../platform/admin/communications-policy.js';
import {
  engagementIdentity,
  engagementAudience,
} from '../account/public/engagement.js';
import { engagementWorkspaceAudience } from '../spaces/public/engagement-context.js';
import { EngagementDelivery } from '../notifications/public/engagement-delivery.js';
import {
  EngagementCore,
  json,
  match,
  page,
  paging,
} from './engagement-core.js';
@Injectable()
export class CommunicationsService {
  constructor(
    @Inject(EngagementCore) private readonly core: EngagementCore,
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
    @Inject(EngagementDelivery) private readonly delivery: EngagementDelivery,
    @Inject(IdentityMailService) private readonly mail: IdentityMailService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
  async audience(tx: Prisma.TransactionClient, raw: unknown) {
    const a = P4Audience.parse(raw);
    const ids =
      a.kind === 'WORKSPACE'
        ? await engagementWorkspaceAudience(tx, a.scopeId, this.kernel)
        : (
            await engagementAudience(
              tx,
              a.kind === 'USERS'
                ? { userIds: a.userIds }
                : a.kind === 'FILTER'
                  ? a
                  : {},
            )
          ).map((r) => r.id);
    if (ids.length > 1000)
      throw new ConflictException({ code: 'AUDIENCE_TOO_LARGE' });
    if (
      !ids.length ||
      (a.kind === 'USERS' && ids.length !== new Set(a.userIds).size)
    )
      throw new NotFoundException();
    return ids.sort();
  }
  async row(tx: Prisma.TransactionClient, id: string) {
    await this.core.lock(tx, 'p4-communication:' + id);
    const row = await tx.adminCommunication.findUnique({ where: { id: id! } });
    if (!row) throw new NotFoundException();
    return row;
  }
  async handle(
    route: keyof typeof routes,
    id: string | undefined,
    raw: unknown,
    command: AdminCommand,
  ) {
    if (route === 'GET communications/:id/targets') {
      const q = routes[route].schema.parse(raw);
      if (
        !(await this.core.db.client.adminCommunication.findUnique({
          where: { id: id! },
          select: { id: true },
        }))
      )
        throw new NotFoundException();
      const targets =
        await this.core.db.client.adminCommunicationTarget.findMany({
          where: {
            communicationId: id!,
            ...(q.after ? { userId: { gt: q.after } } : {}),
          },
          orderBy: { userId: 'asc' },
          take: q.limit + 1,
        });
      return {
        items: targets.slice(0, q.limit),
        nextCursor:
          targets.length > q.limit ? targets[q.limit - 1]!.userId : null,
      };
    }
    if (route === 'GET communications/templates') {
      const q = routes[route].schema.parse(raw);
      return json(
        page(
          await this.core.db.client.adminCommunicationTemplate.findMany({
            where: paging(q),
            orderBy: { id: 'asc' },
            take: q.limit + 1,
          }),
          q.limit,
        ),
      );
    }
    if (route === 'GET communications') {
      const q = routes[route].schema.parse(raw);
      return json(
        page(
          await this.core.db.client.adminCommunication.findMany({
            where: paging(q),
            orderBy: { id: 'asc' },
            take: q.limit + 1,
          }),
          q.limit,
        ),
      );
    }
    if (route === 'GET communications/:id') {
      const q = routes[route].schema.parse(raw),
        row = await this.core.db.client.adminCommunication.findUnique({
          where: { id: id! },
        });
      if (!row) throw new NotFoundException();
      const deliveries = page(
        await this.core.db.client.adminCommunicationRecipient.findMany({
          where: { communicationId: id!, ...paging(q) },
          orderBy: { id: 'asc' },
          take: q.limit + 1,
        }),
        q.limit,
      );
      const counts =
        await this.core.db.client.adminCommunicationRecipient.groupBy({
          by: ['state'],
          where: { communicationId: id! },
          _count: true,
        });
      return json({
        ...row,
        deliveries: deliveries.items,
        nextCursor: deliveries.nextCursor,
        counts: counts.map((r) => ({ state: r.state, count: r._count })),
      });
    }
    let rendered: { locale: string; subject: string; body: string } | null =
      null;
    const result = await this.core.adminWork(command, async (tx) => {
      if (route === 'POST communications/templates') {
        const b = routes[route].schema.parse(raw);
        for (const t of b.translations) validateTemplate(t);
        renderCommunication(
          b.translations,
          b.fallbackLocale,
          b.fallbackLocale,
          {
            recipientName: 'Preview',
            workspaceName: 'Preview',
            publicReason: 'Preview',
          },
        );
        const r = await tx.adminCommunicationTemplate.create({
          data: {
            name: b.name,
            version: b.version,
            fallbackLocale: b.fallbackLocale,
            translations: json(b.translations),
            createdByAdminId: command.adminId,
          },
        });
        return { id: r.id };
      }
      if (
        route === 'POST communications/templates/:id/approve' ||
        route === 'POST communications/templates/:id/archive'
      ) {
        const row = await tx.adminCommunicationTemplate.findUniqueOrThrow({
          where: { id: id! },
        });
        if (route.endsWith('/approve') && row.state !== 'DRAFT')
          throw new ConflictException();
        await tx.adminCommunicationTemplate.update({
          where: { id: id! },
          data: route.endsWith('/approve')
            ? { state: 'APPROVED', approvedByAdminId: command.adminId }
            : { state: 'ARCHIVED' },
        });
        return { id: id! };
      }
      if (route === 'POST communications/preview') {
        const b = routes[route].schema.parse(raw);
        if (
          b.audience.kind === 'GLOBAL' &&
          b.kind !== 'GLOBAL' &&
          b.kind !== 'SECURITY'
        )
          throw new ConflictException({
            code: 'GLOBAL_CLASSIFICATION_REQUIRED',
          });
        if (b.kind === 'DIRECT' && b.audience.kind !== 'USERS')
          throw new ConflictException();
        const template = await tx.adminCommunicationTemplate.findFirst({
          where: { id: b.templateId, state: 'APPROVED' },
        });
        if (!template) throw new NotFoundException();
        const ids = await this.audience(tx, b.audience),
          now = new Date(),
          scheduledAt = b.scheduledAt ? new Date(b.scheduledAt) : now;
        if (
          scheduledAt.getTime() < now.getTime() - 60000 ||
          scheduledAt.getTime() > now.getTime() + 90 * 86400000
        )
          throw new ConflictException();
        const row = await tx.adminCommunication.create({
          data: {
            templateId: b.templateId,
            kind: b.kind,
            audience: json(b.audience),
            variables: json(b.variables),
            channels: json([...new Set(b.channels)]),
            createdByAdminId: command.adminId,
            expiresAt: new Date(now.getTime() + 15 * 60000),
            scheduledAt,
          },
        });
        const targetRows: Prisma.AdminCommunicationTargetCreateManyInput[] = [],
          recipientRows: Prisma.AdminCommunicationRecipientCreateManyInput[] =
            [];
        for (const userId of ids) {
          const subs = b.channels.includes('WEB_PUSH')
            ? await this.delivery.subscriptions(tx, userId)
            : [];
          targetRows.push({
            communicationId: row.id,
            userId,
            pushState: !b.channels.includes('WEB_PUSH')
              ? 'NOT_REQUESTED'
              : subs.length
                ? 'AVAILABLE'
                : 'NO_VALID_DEVICE',
          });
          for (const channel of [...new Set(b.channels)])
            for (const sub of channel === 'WEB_PUSH' ? subs : [null])
              recipientRows.push({
                communicationId: row.id,
                userId,
                channel,
                subscriptionId: sub?.id ?? null,
                subscriptionRevision: sub?.revision ?? null,
                intent:
                  row.id + ':' + userId + ':' + channel + ':' + (sub?.id ?? ''),
                nextAt: scheduledAt,
              });
        }
        await tx.adminCommunicationTarget.createMany({ data: targetRows });
        if (recipientRows.length)
          await tx.adminCommunicationRecipient.createMany({
            data: recipientRows,
          });
        return { id: row.id };
      }
      const row = await this.row(tx, id!);
      const b = routes[route].schema.parse(raw);
      if ('revision' in b) match(row.revision, b.revision);
      if (route === 'POST communications/:id/cancel') {
        if (!['PREVIEW', 'SCHEDULED'].includes(row.state))
          throw new ConflictException();
        await tx.adminCommunication.update({
          where: { id: id! },
          data: { state: 'CANCELED', revision: { increment: 1 } },
        });
        await tx.adminCommunicationRecipient.updateMany({
          where: { communicationId: id!, state: 'PENDING' },
          data: { state: 'CANCELED' },
        });
        await tx.adminCommunicationRecipient.updateMany({
          where: { communicationId: id!, state: 'SENDING' },
          data: {
            state: 'AMBIGUOUS',
            lastCode: 'CANCELED_UNCERTAIN_ATTEMPT',
            leaseUntil: null,
          },
        });
        return { id: id! };
      }
      if (row.state !== 'PREVIEW' || row.expiresAt <= new Date())
        throw new ConflictException({ code: 'PREVIEW_EXPIRED_OR_SENT' });
      const template = await tx.adminCommunicationTemplate.findFirst({
        where: { id: row.templateId, state: 'APPROVED' },
      });
      if (!template) throw new ConflictException();
      if (route === 'POST communications/:id/test') {
        const actor = await tx.adminUser.findUniqueOrThrow({
          where: { id: command.adminId },
        });
        rendered = renderCommunication(
          template.translations as LocalizedTemplate[],
          'en',
          template.fallbackLocale,
          { ...(row.variables as object), recipientName: actor.name },
        );
        await this.mail.send({
          to: actor.email,
          kind: 'administrative',
          url: this.config.BETTER_AUTH_URL,
          message: rendered.subject + '\n' + rendered.body,
        });
        await tx.adminCommunication.update({
          where: { id: id! },
          data: { testedAt: new Date(), revision: { increment: 1 } },
        });
        return { id: id! };
      }
      if (route === 'POST communications/:id/approve') {
        if (row.createdByAdminId === command.adminId)
          throw new ForbiddenException({ code: 'SECOND_OPERATOR_REQUIRED' });
        await tx.adminCommunication.update({
          where: { id: id! },
          data: {
            approvedByAdminId: command.adminId,
            revision: { increment: 1 },
          },
        });
        return { id: id! };
      }
      if (route === 'POST communications/:id/send') {
        if (!row.testedAt)
          throw new ConflictException({ code: 'TEST_SEND_REQUIRED' });
        if (communicationNeedsApproval(row.kind as CommunicationType)) {
          if (
            !row.approvedByAdminId ||
            row.approvedByAdminId === row.createdByAdminId
          )
            throw new ForbiddenException();
          await Command.requireInitiator(
            tx,
            row.approvedByAdminId,
            'admin.communications.approve',
          );
        }
        await Command.requireInitiator(
          tx,
          row.createdByAdminId,
          'admin.communications.send',
        );
        const ids = await this.audience(tx, row.audience);
        const snapshot = await tx.adminCommunicationTarget.findMany({
          where: { communicationId: id! },
          select: { userId: true },
        });
        if (
          ids.join(',') !==
          [...new Set(snapshot.map((r) => r.userId))].sort().join(',')
        )
          throw new ConflictException({
            code: 'AUDIENCE_CHANGED_PREVIEW_AGAIN',
          });
        await tx.adminCommunication.update({
          where: { id: id! },
          data: { state: 'SCHEDULED', revision: { increment: 1 } },
        });
        return { id: id! };
      }
      throw new NotFoundException();
    });
    if (route === 'POST communications/:id/test') {
      if (!rendered) {
        const row =
            await this.core.db.client.adminCommunication.findUniqueOrThrow({
              where: { id: result.id },
            }),
          t =
            await this.core.db.client.adminCommunicationTemplate.findUniqueOrThrow(
              { where: { id: row.templateId } },
            );
        rendered = renderCommunication(
          t.translations as LocalizedTemplate[],
          'en',
          t.fallbackLocale,
          { ...(row.variables as object), recipientName: 'Preview' },
        );
      }
      return { tested: true, ...rendered };
    }
    if (route.includes('templates'))
      return json(
        await this.core.db.client.adminCommunicationTemplate.findUniqueOrThrow({
          where: { id: result.id },
        }),
      );
    const row = await this.core.db.client.adminCommunication.findUniqueOrThrow({
      where: { id: result.id },
    });
    if (route === 'POST communications/preview') {
      const ids = await this.core.db.client.adminCommunicationTarget.findMany({
          where: { communicationId: row.id },
          select: { userId: true },
        }),
        targetUserIds = [...new Set(ids.map((r) => r.userId))];
      return json({ ...row, recipients: targetUserIds.length, targetUserIds });
    }
    return json(row);
  }
  async consume() {
    this.core.privacy.assert();
    const claim = await this.core.db.client.$transaction(async (tx) => {
      const [candidate] = await tx.$queryRaw<
        { id: string }[]
      >`SELECT r.id FROM "AdminCommunicationRecipient" r JOIN "AdminCommunication" c ON c.id=r."communicationId" WHERE c.state='SCHEDULED' AND c."scheduledAt"<=clock_timestamp() AND ((r.state='PENDING' AND r."nextAt"<=clock_timestamp()) OR (r.state='SENDING' AND r."leaseUntil"<=clock_timestamp())) ORDER BY r."nextAt",r.id LIMIT 1 FOR UPDATE OF r SKIP LOCKED`;
      if (!candidate) return null;
      const row = await tx.adminCommunicationRecipient.findUniqueOrThrow({
        where: { id: candidate.id },
      });
      const retryPolicy = await this.core.policy(tx, 'COMMUNICATIONS');
      if (row.attempts >= retryPolicy.maxAttempts! && row.state === 'PENDING') {
        await tx.adminCommunicationRecipient.update({
          where: { id: row.id },
          data: { state: 'FAILED', lastCode: 'ATTEMPT_LIMIT' },
        });
        return { done: true as const };
      }
      if (row.state === 'SENDING' && row.networkStartedAt) {
        await tx.adminCommunicationRecipient.update({
          where: { id: row.id },
          data: {
            state: 'AMBIGUOUS',
            lastCode: 'WORKER_ACCEPTANCE_UNKNOWN',
            leaseUntil: null,
          },
        });
        return { done: true as const };
      }
      const token = randomUUID();
      await tx.adminCommunicationRecipient.update({
        where: { id: row.id },
        data: {
          state: 'SENDING',
          attempts: { increment: 1 },
          leaseToken: token,
          leaseUntil: new Date(Date.now() + 60000),
          networkStartedAt: row.channel === 'IN_APP' ? null : new Date(),
        },
      });
      return {
        done: false as const,
        id: row.id,
        communicationId: row.communicationId,
        userId: row.userId,
        token,
      };
    });
    if (!claim) return false;
    if (claim.done) return true;
    return this.core.db.client.$transaction(
      async (tx) => {
        const recipientOpen = await lockEngagementPersonal(
          tx,
          claim.userId,
          false,
        );
        const campaign = await this.row(tx, claim.communicationId);
        await tx.$queryRaw`SELECT id FROM "AdminCommunicationRecipient" WHERE id=${claim.id}::uuid FOR UPDATE`;
        const row = await tx.adminCommunicationRecipient.findUniqueOrThrow({
          where: { id: claim.id },
        });
        if (
          row.state !== 'SENDING' ||
          row.leaseToken !== claim.token ||
          !row.leaseUntil ||
          row.leaseUntil <= new Date()
        )
          return true;
        const template = await tx.adminCommunicationTemplate.findUniqueOrThrow({
          where: { id: campaign.templateId },
        });
        const finish = async (state: string, code: string) => {
          await tx.adminCommunicationRecipient.update({
            where: { id: row.id },
            data: { state, lastCode: code, leaseUntil: null, leaseToken: null },
          });
        };
        if (!recipientOpen) {
          await finish('SUPPRESSED', 'ACCOUNT_CLOSED');
          return true;
        }
        if (campaign.state !== 'SCHEDULED') {
          await finish('CANCELED', 'CAMPAIGN_CANCELED');
          return true;
        }
        try {
          await Command.requireInitiator(
            tx,
            campaign.createdByAdminId,
            'admin.communications.send',
          );
          if (communicationNeedsApproval(campaign.kind as CommunicationType))
            await Command.requireInitiator(
              tx,
              campaign.approvedByAdminId!,
              'admin.communications.approve',
            );
        } catch {
          await finish('SUPPRESSED', 'OPERATOR_AUTHORITY_CHANGED');
          return true;
        }
        if (template.state !== 'APPROVED') {
          await finish('SUPPRESSED', 'TEMPLATE_ARCHIVED');
          return true;
        }
        let selected = false;
        try {
          const a = P4Audience.parse(campaign.audience);
          selected =
            a.kind === 'GLOBAL' ||
            (a.kind === 'USERS' && a.userIds.includes(row.userId)) ||
            (a.kind === 'FILTER' &&
              (await engagementAudience(tx, { ...a, userIds: [row.userId] }))
                .length > 0) ||
            (a.kind === 'WORKSPACE' &&
              (
                await engagementWorkspaceAudience(
                  tx,
                  a.scopeId,
                  this.kernel,
                  row.userId,
                )
              ).includes(row.userId));
        } catch {
          selected = false;
        }
        if (!selected) {
          await finish('SUPPRESSED', 'AUDIENCE_CHANGED');
          return true;
        }
        let user;
        try {
          user = await engagementIdentity(tx, row.userId);
        } catch {
          await finish('SUPPRESSED', 'RECIPIENT_UNAVAILABLE');
          return true;
        }
        const policy = await this.delivery.policy(tx, row.userId, new Date());
        const preference =
          campaign.kind === 'SECURITY'
            ? null
            : await tx.p4CommunicationPreference.findUnique({
                where: {
                  userId_kind: { userId: row.userId, kind: campaign.kind },
                },
              });
        if (preference) {
          policy.channels.IN_APP &&= preference.inApp;
          policy.channels.EMAIL &&= preference.email;
          policy.channels.WEB_PUSH &&= preference.webPush;
        }
        const eligible = communicationEligibility(
          campaign.kind as CommunicationType,
          row.channel as 'EMAIL' | 'WEB_PUSH' | 'IN_APP',
          {
            active:
              user.active && (await engagementPersonalOpen(tx, row.userId)),
            verifiedEmail: user.emailVerified,
            pushAvailable: row.channel !== 'WEB_PUSH' || !!row.subscriptionId,
            ...policy,
          },
          new Date(),
        );
        if (eligible.state === 'SUPPRESSED') {
          await finish('SUPPRESSED', 'PREFERENCE_OR_RECIPIENT');
          return true;
        }
        if (eligible.state === 'DEFERRED') {
          await tx.adminCommunicationRecipient.update({
            where: { id: row.id },
            data: {
              state: 'PENDING',
              nextAt: eligible.notBefore!,
              networkStartedAt: null,
              leaseUntil: null,
              attempts: { decrement: 1 },
            },
          });
          return false;
        }
        let rendered: ReturnType<typeof renderCommunication>;
        try {
          rendered = renderCommunication(
            template.translations as LocalizedTemplate[],
            user.locale,
            template.fallbackLocale,
            {
              ...(campaign.variables as object),
              recipientName: user.name.replace(/[\r\n\0]/g, ' ').slice(0, 500),
            },
          );
        } catch {
          await finish('FAILED', 'TEMPLATE_RENDER_FAILED');
          return true;
        }
        const config = await this.core.policy(tx, 'COMMUNICATIONS');
        if (row.attempts > config.maxAttempts!) {
          await finish('FAILED', 'ATTEMPT_LIMIT');
          return true;
        }

        // Bounded adapter call while holding the recipient/campaign locks. Cancellation
        // commits before a send or waits for its outcome; it cannot race a new network call.
        const result =
          row.channel === 'IN_APP'
            ? { outcome: 'ACCEPTED', code: 'INBOX_PUBLISHED' }
            : await this.delivery.send(tx, {
                ...row,
                email: user.email,
                subject: rendered.subject,
                body: rendered.body,
              });
        if (result.outcome === 'RETRY')
          await tx.adminCommunicationRecipient.update({
            where: { id: row.id },
            data: {
              state: 'PENDING',
              nextAt: new Date(
                Date.now() + Math.min(3600000, 30000 * 2 ** row.attempts),
              ),
              networkStartedAt: null,
              leaseUntil: null,
              lastCode: result.code,
            },
          });
        else {
          await tx.adminCommunicationRecipient.update({
            where: { id: row.id },
            data: {
              state:
                result.outcome === 'ACCEPTED'
                  ? 'SENT'
                  : result.outcome === 'AMBIGUOUS'
                    ? 'AMBIGUOUS'
                    : 'FAILED',
              lastCode: result.code,
              leaseUntil: null,
              locale: rendered.locale,
              subject: rendered.subject,
              body: rendered.body,
            },
          });
        }
        return true;
      },
      { timeout: 30000 },
    );
  }
  async sweep() {
    const completed = await this.core.db.client.adminCommunication.findMany({
      where: { state: 'SCHEDULED' },
      select: { id: true },
      take: 25,
    });
    for (const r of completed) {
      if (
        !(await this.core.db.client.adminCommunicationRecipient.count({
          where: {
            communicationId: r.id,
            state: { in: ['PENDING', 'SENDING'] },
          },
        }))
      )
        await this.core.db.client.adminCommunication.updateMany({
          where: { id: r.id, state: 'SCHEDULED' },
          data: { state: 'COMPLETE' },
        });
    }
    const policy = await this.core.policy(
      this.core.db.client,
      'COMMUNICATIONS',
    );
    await this.core.db.client.adminCommunication.deleteMany({
      where: {
        state: { in: ['CANCELED', 'COMPLETE'] },
        createdAt: {
          lt: new Date(Date.now() - policy.retentionDays! * 86400000),
        },
      },
    });
  }
}

const renderCommunication = (
  ...args: Parameters<typeof pure_renderCommunication>
) => checkedPolicy(() => pure_renderCommunication(...args));

const validateTemplate = (...args: Parameters<typeof pure_validateTemplate>) =>
  checkedPolicy(() => pure_validateTemplate(...args));
