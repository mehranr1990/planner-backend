import { withEngagementContext } from '../spaces/public/engagement-availability.js';
import { SharedKernel } from '../spaces/public/index.js';
import { checkedPolicy } from './engagement-core.js';
import {
  Injectable,
  Inject,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  ordinaryEngagementRoutes as userRoutes,
  adminEngagementRoutes as adminRoutes,
} from '@mehran/api-contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import type { RequestActor } from '../../platform/auth/request-actor.js';
import type { AdminCommand } from '../../platform/admin/admin-command.js';
import {
  ticketTransition as pure_ticketTransition,
  ticketSlaDeadline,
  ticketAssigneeEligible,
  publicTicketMessages,
  type TicketState,
} from '../../platform/admin/support-policy.js';
import { permits } from '../../platform/admin/admin-policy.js';
import { engagementContext } from '../spaces/public/engagement-context.js';
import { engagementIdentity } from '../account/public/engagement.js';
import {
  EngagementCore,
  match,
  hash,
  json,
  page,
  paging,
} from './engagement-core.js';
@Injectable()
export class SupportService {
  constructor(
    @Inject(EngagementCore) private readonly core: EngagementCore,
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
  ) {}
  async detail(id: string, userId?: string) {
    return this.core.db.client.$transaction(async (tx) => {
      const row = await this.core.ticket(tx, id, userId);
      const [replies, evidence, history] = await Promise.all([
        tx.supportReply.findMany({
          where: { ticketId: id!, ...(userId ? { internal: false } : {}) },
          orderBy: { createdAt: 'desc' },
          take: 101,
        }),
        tx.p4Evidence.findMany({
          where: { ticketId: id!, state: 'ATTACHED' },
          orderBy: { createdAt: 'asc' },
          take: 101,
        }),
        tx.p4CaseEvent.findMany({
          where: { ticketId: id!, ...(userId ? { public: true } : {}) },
          orderBy: { createdAt: 'desc' },
          take: 101,
        }),
      ]);
      return json({
        ...row,
        replies: userId
          ? publicTicketMessages(replies.slice(0, 100))
          : replies.slice(0, 100),
        evidence: evidence.slice(0, 100),
        history: history.slice(0, 100),
        truncated: [replies, evidence, history].some((r) => r.length > 100),
        ...(!userId
          ? { account: await engagementIdentity(tx, row.ownerUserId) }
          : {}),
      });
    });
  }
  async list(
    q: {
      after?: string | undefined;
      limit: number;
      state?: string | undefined;
      queueId?: string | undefined;
      assigneeAdminId?: string | undefined;
    },
    userId?: string,
  ) {
    return json(
      page(
        await this.core.db.client.supportTicket.findMany({
          where: {
            ...paging(q),
            ...(userId ? { ownerUserId: userId } : {}),
            ...(q.state ? { state: q.state } : {}),
            ...(q.queueId ? { queueId: q.queueId } : {}),
            ...(q.assigneeAdminId
              ? { assigneeAdminId: q.assigneeAdminId }
              : {}),
          },
          orderBy: { id: 'asc' },
          take: q.limit + 1,
        }),
        q.limit,
      ),
    );
  }
  async queues(ordinary = false) {
    return {
      items: await this.core.db.client.supportQueue.findMany({
        where: ordinary ? { active: true } : {},
        orderBy: { name: 'asc' },
        take: 100,
      }),
    };
  }
  async reply(
    tx: Prisma.TransactionClient,
    ticket: Awaited<ReturnType<EngagementCore['ticket']>>,
    body: string,
    actor: { userId?: string; adminId?: string },
    internal = false,
    source = 'IN_APP',
  ) {
    if (ticket.archivedAt || ['CLOSED', 'RESOLVED'].includes(ticket.state))
      throw new ConflictException({ code: 'TICKET_NOT_OPEN' });
    const reply = await tx.supportReply.create({
      data: {
        ticketId: ticket.id,
        body,
        authorUserId: actor.userId ?? null,
        authorAdminId: actor.adminId ?? null,
        internal,
        source,
      },
    });
    const queue = await tx.supportQueue.findUniqueOrThrow({
      where: { id: ticket.queueId },
    });
    if (!internal)
      await tx.supportTicket.update({
        where: { id: ticket.id },
        data: {
          state: actor.userId ? 'WAITING_FOR_SUPPORT' : 'WAITING_FOR_USER',
          revision: { increment: 1 },
          updatedAt: new Date(),
          slaDueAt: ticketSlaDeadline(new Date(), queue.slaMinutes),
          slaAlertedAt: null,
        },
      });
    else
      await tx.supportTicket.update({
        where: { id: ticket.id },
        data: { revision: { increment: 1 }, updatedAt: new Date() },
      });
    await this.core.event(
      tx,
      { ticketId: ticket.id },
      internal ? 'INTERNAL_NOTE' : 'REPLY',
      actor,
      null,
      !internal,
    );
    if (!internal && actor.adminId)
      await this.core.notice(
        tx,
        { userId: ticket.ownerUserId, ticketId: ticket.id },
        'SUPPORT_REPLY',
        'reply:' + reply.id,
      );
    return reply;
  }
  async ordinary(
    route: keyof typeof userRoutes,
    id: string | undefined,
    raw: unknown,
    actor: RequestActor,
    key: string,
  ) {
    if (route === 'GET support/queues') return json(await this.queues(true));
    if (route === 'GET support/tickets')
      return this.list(userRoutes[route].schema.parse(raw), actor.userId);
    if (route === 'GET support/tickets/:id')
      return this.detail(id!, actor.userId);
    if (route === 'POST support/tickets') {
      const b = userRoutes[route].schema.parse(raw);
      const save = (inside?: Prisma.TransactionClient) =>
        this.core.userWork(
          actor,
          route,
          key,
          json(b),
          async (tx) => {
            await this.core.restricted(tx, actor.userId, 'SUPPORT');
            if (
              !(await this.core.rate(tx, [
                {
                  key: 'support-create:' + actor.userId,
                  limit: 10,
                  windowMs: 86400000,
                },
              ]))
            )
              throw new ForbiddenException({ code: 'RATE_LIMITED' });
            const queue = await tx.supportQueue.findFirst({
              where: { id: b.queueId, active: true },
            });
            if (!queue) throw new NotFoundException();
            const context = b.scopeId
              ? await engagementContext(tx, actor, b.scopeId)
              : {};
            const ticket = await tx.supportTicket.create({
              data: {
                ...context,
                ownerUserId: actor.userId,
                queueId: queue.id,
                subject: b.subject,
                category: b.category,
                slaDueAt: ticketSlaDeadline(new Date(), queue.slaMinutes),
              },
            });
            await tx.supportReply.create({
              data: {
                ticketId: ticket.id,
                authorUserId: actor.userId,
                body: b.body,
              },
            });
            await this.core.event(
              tx,
              { ticketId: ticket.id },
              'CREATED',
              { userId: actor.userId },
              null,
              true,
            );
            return { id: ticket.id };
          },
          inside,
        );
      const result = b.scopeId
        ? await withEngagementContext(
            this.core.db.client,
            this.kernel,
            actor,
            b.scopeId,
            save,
          )
        : await save();
      return json(
        await this.core.db.client.supportTicket.findUniqueOrThrow({
          where: { id: (result as { id: string }).id },
        }),
      );
    }
    const b = userRoutes[route].schema.parse(raw);
    let tokenResult: Prisma.InputJsonValue | null = null;
    const result = await this.core.userWork(
      actor,
      route,
      key,
      json({ id, ...b }),
      async (tx) => {
        const ticket = await this.core.ticket(tx, id!, actor.userId);
        await this.core.restricted(tx, actor.userId, 'SUPPORT');
        if ('revision' in b) match(ticket.revision, b.revision);
        if (route === 'POST support/tickets/:id/replies') {
          const body = userRoutes[route].schema.parse(raw);
          if (
            !(await this.core.rate(tx, [
              {
                key: 'support-reply:' + actor.userId,
                limit: 10,
                windowMs: 600000,
              },
            ]))
          )
            throw new ForbiddenException();
          await this.reply(tx, ticket, body.body, { userId: actor.userId });
        } else if (route === 'POST support/tickets/:id/reopen') {
          const policy = await this.core.policy(tx, 'SUPPORT');
          ticketTransition(ticket.state as TicketState, 'REOPENED', {
            now: new Date(),
            resolvedAt: ticket.resolvedAt,
            reopenDays: policy.reopenDays!,
            archived: !!ticket.archivedAt,
          });
          await tx.supportTicket.update({
            where: { id: ticket.id },
            data: {
              state: 'REOPENED',
              revision: { increment: 1 },
              slaAlertedAt: null,
              updatedAt: new Date(),
            },
          });
          await this.core.event(
            tx,
            { ticketId: ticket.id },
            'REOPENED',
            { userId: actor.userId },
            null,
            true,
          );
        } else if (route === 'POST support/tickets/:id/feedback') {
          const body = userRoutes[route].schema.parse(raw);
          if (
            !['RESOLVED', 'CLOSED'].includes(ticket.state) ||
            ticket.feedback !== null
          )
            throw new ConflictException();
          await tx.supportTicket.update({
            where: { id: ticket.id },
            data: {
              feedback: body.rating,
              feedbackText: body.text ?? null,
              updatedAt: new Date(),
              revision: { increment: 1 },
            },
          });
          await this.core.event(
            tx,
            { ticketId: ticket.id },
            'FEEDBACK',
            { userId: actor.userId },
            null,
            true,
          );
        } else if (route === 'POST support/tickets/:id/email-token') {
          const owner = await engagementIdentity(tx, actor.userId);
          if (!owner.emailVerified || ticket.archivedAt)
            throw new ForbiddenException();
          const token = randomBytes(32).toString('base64url'),
            policy = await this.core.policy(tx, 'SUPPORT'),
            expiresAt = new Date(
              Date.now() + policy.inboundTokenDays! * 86400000,
            );
          await tx.supportTicket.update({
            where: { id: ticket.id },
            data: {
              correlationHash: hash(token),
              correlationEmailHash: hash(owner.email.toLowerCase()),
              correlationExpiresAt: expiresAt,
              revision: { increment: 1 },
            },
          });
          await this.core.event(
            tx,
            { ticketId: ticket.id },
            'EMAIL_TOKEN_ROTATED',
            { userId: actor.userId },
          );
          tokenResult = {
            token,
            expiresAt: expiresAt.toISOString(),
            activation: 'DISABLED',
          };
        } else throw new NotFoundException();
        return { id: ticket.id };
      },
    );
    if (route === 'POST support/tickets/:id/email-token') {
      if (!tokenResult)
        throw new ConflictException({
          code: 'TOKEN_ALREADY_ISSUED_ROTATE_WITH_NEW_KEY',
        });
      return tokenResult;
    }
    return json(
      await this.core.db.client.supportTicket.findUniqueOrThrow({
        where: { id: (result as { id: string }).id },
      }),
    );
  }
  async admin(
    route: keyof typeof adminRoutes,
    id: string | undefined,
    raw: unknown,
    command: AdminCommand,
  ) {
    if (route === 'GET support/queues') return json(await this.queues());
    if (route === 'GET support/tickets')
      return this.list(adminRoutes[route].schema.parse(raw));
    if (route === 'GET support/tickets/:id') return this.detail(id!);
    const result = await this.core.adminWork(command, async (tx) => {
      if (route === 'POST support/queues') {
        const b = adminRoutes[route].schema.parse(raw);
        const r = await tx.supportQueue.create({
          data: { name: b.name, slaMinutes: b.slaMinutes },
        });
        return { id: r.id };
      }
      if (route === 'PATCH support/queues/:id') {
        const b = adminRoutes[route].schema.parse(raw);
        const changed = await tx.supportQueue.updateMany({
          where: { id: id!, revision: b.revision },
          data: {
            name: b.name,
            active: b.active,
            slaMinutes: b.slaMinutes,
            revision: { increment: 1 },
          },
        });
        if (changed.count !== 1) throw new ConflictException();
        return { id: id! };
      }
      const ticket = await this.core.ticket(tx, id!);
      const b = adminRoutes[route].schema.parse(raw);
      if ('revision' in b) match(ticket.revision, b.revision);
      if (route === 'POST support/tickets/:id/replies') {
        const body = adminRoutes[route].schema.parse(raw);
        await this.reply(
          tx,
          ticket,
          body.body,
          { adminId: command.adminId },
          body.internal,
        );
      } else if (route === 'POST support/tickets/:id/assign') {
        const body = adminRoutes[route].schema.parse(raw);
        const queue = await tx.supportQueue.findFirst({
          where: { id: body.queueId, active: true },
        });
        if (!queue) throw new NotFoundException();
        if (body.assigneeAdminId) {
          const operator = await tx.adminUser.findUnique({
            where: { id: body.assigneeAdminId },
          });
          if (
            !operator ||
            !ticketAssigneeEligible(
              {
                active: operator.active,
                mfaEnabled: operator.twoFactorEnabled,
                permitted: permits(operator.role, 'admin.support.reply'),
                blockedUntil: operator.signInBlockedUntil,
              },
              new Date(),
            )
          )
            throw new ForbiddenException();
        }
        await tx.supportTicket.update({
          where: { id: ticket.id },
          data: {
            assigneeAdminId: body.assigneeAdminId,
            queueId: body.queueId,
            priority: body.priority,
            category: body.category,
            revision: { increment: 1 },
            slaDueAt: ticketSlaDeadline(new Date(), queue.slaMinutes),
            slaAlertedAt: null,
          },
        });
        await this.core.event(
          tx,
          { ticketId: ticket.id },
          'MANUAL_ASSIGNMENT',
          { adminId: command.adminId },
        );
      } else if (route === 'POST support/tickets/:id/state') {
        const body = adminRoutes[route].schema.parse(raw),
          policy = await this.core.policy(tx, 'SUPPORT');
        ticketTransition(ticket.state as TicketState, body.state, {
          now: new Date(),
          resolvedAt: ticket.resolvedAt,
          reopenDays: policy.reopenDays!,
          archived: !!ticket.archivedAt,
        });
        await tx.supportTicket.update({
          where: { id: ticket.id },
          data: {
            state: body.state,
            revision: { increment: 1 },
            updatedAt: new Date(),
            ...(['RESOLVED', 'CLOSED'].includes(body.state)
              ? { resolvedAt: ticket.resolvedAt ?? new Date() }
              : {}),
            ...(body.state === 'REOPENED' ? { slaAlertedAt: null } : {}),
          },
        });
        await this.core.event(
          tx,
          { ticketId: ticket.id },
          body.state,
          { adminId: command.adminId },
          null,
          true,
        );
      } else if (route === 'POST support/tickets/:id/archive') {
        if (!['RESOLVED', 'CLOSED'].includes(ticket.state))
          throw new ConflictException();
        await tx.supportTicket.update({
          where: { id: ticket.id },
          data: {
            archivedAt: new Date(),
            correlationHash: null,
            revision: { increment: 1 },
          },
        });
        await this.core.event(tx, { ticketId: ticket.id }, 'ARCHIVED', {
          adminId: command.adminId,
        });
      } else throw new NotFoundException();
      return { id: ticket.id };
    });
    return json(
      route.includes('queues')
        ? await this.core.db.client.supportQueue.findUniqueOrThrow({
            where: { id: result.id },
          })
        : await this.core.db.client.supportTicket.findUniqueOrThrow({
            where: { id: result.id },
          }),
    );
  }
  async sweep() {
    return this.core.db.client.$transaction(async (tx) => {
      const policy = await this.core.policy(tx, 'SUPPORT'),
        now = new Date();
      const late = await tx.supportTicket.findMany({
        where: {
          state: { in: ['NEW', 'OPEN', 'WAITING_FOR_SUPPORT', 'REOPENED'] },
          archivedAt: null,
          slaDueAt: { lte: now },
          slaAlertedAt: null,
        },
        take: 25,
      });
      for (const r of late) {
        await this.core.lock(tx, 'p4-ticket:' + r.id);
        const changed = await tx.supportTicket.updateMany({
          where: { id: r.id, slaAlertedAt: null, revision: r.revision },
          data: { slaAlertedAt: now },
        });
        if (changed.count) {
          const operators = r.assigneeAdminId
            ? [{ id: r.assigneeAdminId }]
            : await tx.adminUser.findMany({
                where: {
                  active: true,
                  twoFactorEnabled: true,
                  role: { in: ['SUPER_ADMIN', 'SUPPORT'] },
                },
                select: { id: true },
                take: 100,
              });
          for (const op of operators)
            await this.core.notice(
              tx,
              { adminId: op.id, ticketId: r.id },
              'SUPPORT_SLA_LATE',
              'sla:' + r.id + ':' + r.revision + ':' + op.id,
            );
        }
      }
      await tx.supportTicket.updateMany({
        where: {
          state: { in: ['RESOLVED', 'CLOSED'] },
          archivedAt: null,
          resolvedAt: {
            lt: new Date(now.getTime() - policy.archiveDays! * 86400000),
          },
        },
        data: { archivedAt: now, correlationHash: null },
      });
      const expired = await tx.supportTicket.findMany({
        where: {
          archivedAt: { not: null },
          resolvedAt: {
            lt: new Date(now.getTime() - policy.retentionDays! * 86400000),
          },
        },
        take: 25,
      });
      for (const r of expired)
        await tx.supportTicket.delete({ where: { id: r.id } });
      return late.length > 0 || expired.length > 0;
    });
  }
}

const ticketTransition = (...args: Parameters<typeof pure_ticketTransition>) =>
  checkedPolicy(() => pure_ticketTransition(...args));
