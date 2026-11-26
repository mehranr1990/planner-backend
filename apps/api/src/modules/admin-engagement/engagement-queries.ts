import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import {
  adminEngagementRoutes as adminRoutes,
  ordinaryEngagementRoutes as userRoutes,
  P4Page,
} from '@mehran/api-contracts';
import type { RequestActor } from '../../platform/auth/request-actor.js';
import type { AdminCommand } from '../../platform/admin/admin-command.js';
import { EngagementCore, json, page, paging } from './engagement-core.js';
import { EngagementPolicies } from './engagement-policies.js';
@Injectable()
export class EngagementQueries {
  constructor(
    @Inject(EngagementCore) private readonly core: EngagementCore,
    @Inject(EngagementPolicies) private readonly policies: EngagementPolicies,
  ) {}
  async admin(
    route: keyof typeof adminRoutes,
    id: string | undefined,
    input: unknown,
    command: AdminCommand,
  ) {
    if (
      route === 'GET support/notices' ||
      route === 'GET moderation/escalations'
    ) {
      const q = P4Page.parse(input);
      return json(
        page(
          await this.core.db.client.p4Notice.findMany({
            where: {
              ...paging(q),
              adminId: command.adminId,
              ...(route === 'GET moderation/escalations'
                ? { kind: 'MODERATION_SECURITY_ESCALATION' }
                : {}),
            },
            orderBy: { id: 'asc' },
            take: q.limit + 1,
          }),
          q.limit,
        ),
      );
    }
    if (
      route === 'POST support/notices/:id/read' ||
      route === 'POST moderation/escalations/:id/read'
    ) {
      const result = await this.core.adminWork(command, async (tx) => {
        const notice = await tx.p4Notice.findFirst({
          where: {
            id: id!,
            adminId: command.adminId,
            ...(route === 'POST moderation/escalations/:id/read'
              ? { kind: 'MODERATION_SECURITY_ESCALATION' }
              : {}),
          },
        });
        if (!notice) throw new NotFoundException();
        await tx.p4Notice.update({
          where: { id: id! },
          data: { readAt: notice.readAt ?? new Date() },
        });
        return { id: id! };
      });
      const notice = await this.core.db.client.p4Notice.findUniqueOrThrow({
        where: { id: result.id },
      });
      return { id: notice.id, readAt: notice.readAt!.toISOString() };
    }
    if (route === 'GET engagement/policies')
      return {
        items: await this.core.db.client.p4Policy.findMany({
          orderBy: { section: 'asc' },
        }),
      };
    if (
      route === 'PATCH engagement/policies/:id' ||
      route === 'POST engagement/policies/:id/preview'
    )
      return this.policies.run(route, id!, input, command);
    throw new NotFoundException();
  }
  async user(
    route: keyof typeof userRoutes,
    id: string | undefined,
    input: unknown,
    actor: RequestActor,
    key: string,
  ) {
    if (route === 'GET communications/preferences') {
      const existing =
        await this.core.db.client.p4CommunicationPreference.findMany({
          where: { userId: actor.userId },
        });
      return {
        items: ['SYSTEM', 'DIRECT', 'GROUP', 'GLOBAL'].map(
          (kind) =>
            existing.find((r) => r.kind === kind) ?? {
              kind,
              inApp: true,
              email: true,
              webPush: true,
              revision: 1,
            },
        ),
      };
    }
    if (route === 'PATCH communications/preferences') {
      const b = userRoutes[route].schema.parse(input);
      return this.core.userWork(actor, route, key, json(b), async (tx) => {
        await this.core.lock(tx, 'p4-pref:' + actor.userId + ':' + b.kind);
        const prior = await tx.p4CommunicationPreference.findUnique({
          where: { userId_kind: { userId: actor.userId, kind: b.kind } },
        });
        if ((prior?.revision ?? 1) !== b.revision)
          throw new ConflictException();
        return json(
          await tx.p4CommunicationPreference.upsert({
            where: { userId_kind: { userId: actor.userId, kind: b.kind } },
            create: {
              userId: actor.userId,
              kind: b.kind,
              inApp: b.inApp,
              email: b.email,
              webPush: b.webPush,
              revision: 2,
            },
            update: {
              inApp: b.inApp,
              email: b.email,
              webPush: b.webPush,
              revision: { increment: 1 },
            },
          }),
        );
      });
    }
    if (route === 'GET moderation/reports') {
      const q = P4Page.parse(input);
      return json(
        page(
          await this.core.db.client.moderationCase.findMany({
            where: {
              ...paging(q),
              OR: [
                { reporterUserId: actor.userId },
                { targetUserId: actor.userId },
              ],
            },
            orderBy: { id: 'asc' },
            take: q.limit + 1,
          }),
          q.limit,
        ),
      );
    }
    if (route === 'GET communications/inbox') {
      const q = P4Page.parse(input);
      return json(
        page(
          await this.core.db.client.adminCommunicationRecipient.findMany({
            where: {
              ...paging(q),
              userId: actor.userId,
              channel: 'IN_APP',
              state: 'SENT',
            },
            orderBy: { id: 'asc' },
            take: q.limit + 1,
          }),
          q.limit,
        ),
      );
    }
    if (route === 'POST communications/inbox/:id/read')
      return this.core.userWork(actor, route, key, json({ id }), async (tx) => {
        const row = await tx.adminCommunicationRecipient.findFirst({
          where: {
            id: id!,
            userId: actor.userId,
            channel: 'IN_APP',
            state: 'SENT',
          },
        });
        if (!row) throw new NotFoundException();
        const result = await tx.adminCommunicationRecipient.update({
          where: { id: id! },
          data: { readAt: row.readAt ?? new Date() },
        });
        return { id: result.id, readAt: result.readAt!.toISOString() };
      });
    if (route === 'GET support/notices') {
      const q = P4Page.parse(input);
      return json(
        page(
          await this.core.db.client.p4Notice.findMany({
            where: { ...paging(q), userId: actor.userId, inApp: true },
            orderBy: { id: 'asc' },
            take: q.limit + 1,
          }),
          q.limit,
        ),
      );
    }
    if (route === 'POST support/notices/:id/read')
      return this.core.userWork(actor, route, key, json({ id }), async (tx) => {
        const row = await tx.p4Notice.findFirst({
          where: { id: id!, userId: actor.userId, inApp: true },
        });
        if (!row) throw new NotFoundException();
        const result = await tx.p4Notice.update({
          where: { id: id! },
          data: { readAt: row.readAt ?? new Date() },
        });
        return { id: result.id, readAt: result.readAt!.toISOString() };
      });
    throw new NotFoundException();
  }
}
