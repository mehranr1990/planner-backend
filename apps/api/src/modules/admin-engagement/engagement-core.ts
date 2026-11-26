import { lockEngagementPersonal } from '../spaces/public/engagement-availability.js';
import { invitationChannels } from '../notifications/public/invitation-preferences.js';
import {
  Injectable,
  Inject,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../../platform/database/database.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { RequestActor } from '../../platform/auth/request-actor.js';
import { PrivacyGate } from '../../platform/authorization/privacy-gate.js';
import { AdminCommand } from '../../platform/admin/admin-command.js';
import { engagementIdentity } from '../account/public/engagement.js';
export const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export const json = <T>(value: T): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const match = (actual: number, expected: number) => {
  if (actual !== expected)
    throw new ConflictException({ code: 'STALE_REVISION' });
};
export const paging = (q: { after?: string | undefined; limit: number }) => ({
  ...(q.after ? { id: { gt: q.after } } : {}),
});
export function page<T extends { id: string }>(rows: T[], limit: number) {
  return {
    items: rows.slice(0, limit),
    nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
  };
}
@Injectable()
export class EngagementCore {
  constructor(
    @Inject(DatabaseService) readonly db: DatabaseService,
    @Inject(PrivacyGate) readonly privacy: PrivacyGate,
  ) {}
  assertIdentity(actor: RequestActor) {
    return this.db.client.$transaction((tx) => this.identity(tx, actor));
  }
  requestRate(userId: string) {
    return this.db.client.$transaction((tx) =>
      this.rate(tx, [
        { key: 'p4-http:' + userId, limit: 120, windowMs: 60000 },
      ]),
    );
  }
  async identity(tx: Prisma.TransactionClient, actor: RequestActor) {
    this.privacy.assert();
    await lockEngagementPersonal(tx, actor.userId);
    const user = await engagementIdentity(tx, actor.userId);
    if (!user.active) throw new ForbiddenException();
    if (
      !actor.sessionId ||
      !(await tx.authSession.findFirst({
        where: {
          id: actor.sessionId,
          userId: actor.userId,
          expiresAt: { gt: new Date() },
        },
      }))
    )
      throw new ForbiddenException();
    return user;
  }
  async userWork<T extends Prisma.InputJsonValue>(
    actor: RequestActor,
    operation: string,
    key: string,
    input: Prisma.InputJsonValue,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
    inside?: Prisma.TransactionClient,
  ): Promise<T> {
    if (!/^[!-~]{1,128}$/.test(key))
      throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    const execute = async (tx: Prisma.TransactionClient) => {
      await this.identity(tx, actor);
      const keyHash = hash(key),
        fingerprint = hash(JSON.stringify(input));
      await this.lock(
        tx,
        'p4-user:' + actor.userId + ':' + operation + ':' + keyHash,
      );
      const prior = await tx.p4UserReceipt.findUnique({
        where: {
          userId_operation_keyHash: {
            userId: actor.userId,
            operation,
            keyHash,
          },
        },
      });
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT' });
        return prior.result as T;
      }
      const result = await work(tx);
      await tx.p4UserReceipt.create({
        data: { userId: actor.userId, operation, keyHash, fingerprint, result },
      });
      return result;
    };
    return inside ? execute(inside) : this.db.client.$transaction(execute);
  }
  async adminWork(
    command: AdminCommand,
    work: (
      tx: Prisma.TransactionClient,
    ) => Promise<{ id: string; revision?: number }>,
  ) {
    this.privacy.assert();
    return this.db.client.$transaction((tx) =>
      command.execute(tx, async () => {
        const result = await work(tx);
        const envelope = command.input as {
          input?: { revision?: number; state?: string };
        };
        const revision = envelope.input?.revision;
        await command.recordChange(tx, revision ? { revision } : null, {
          id: result.id,
          ...(revision ? { revision: revision + 1 } : {}),
          ...(envelope.input?.state ? { state: envelope.input.state } : {}),
        });
        return result;
      }),
    );
  }
  lock(tx: Prisma.TransactionClient, key: string) {
    return tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))::text`;
  }
  async policy(tx: Prisma.TransactionClient, section: string) {
    return (await tx.p4Policy.findUniqueOrThrow({ where: { section } }))
      .value as Record<string, number>;
  }
  async rate(
    tx: Prisma.TransactionClient,
    keys: readonly { key: string; limit: number; windowMs: number }[],
    now = new Date(),
  ) {
    const sorted = [...keys].sort((a, b) =>
      (a.key + ':' + a.windowMs).localeCompare(b.key + ':' + b.windowMs),
    );
    for (const k of sorted)
      await this.lock(tx, 'p4-rate:' + k.key + ':' + k.windowMs);
    const buckets = await Promise.all(
      sorted.map((k) =>
        tx.p4RateBucket.findUnique({
          where: { key_windowMs: { key: k.key, windowMs: k.windowMs } },
        }),
      ),
    );
    if (
      sorted.some(
        (k, i) =>
          buckets[i] &&
          buckets[i]!.startAt.getTime() + k.windowMs > now.getTime() &&
          buckets[i]!.count >= k.limit,
      )
    )
      return false;
    for (const [k, i] of sorted.map((k, i) => [k, i] as const)) {
      const previous = buckets[i],
        fresh =
          !previous || previous.startAt.getTime() + k.windowMs <= now.getTime();
      await tx.p4RateBucket.upsert({
        where: { key_windowMs: { key: k.key, windowMs: k.windowMs } },
        create: { key: k.key, windowMs: k.windowMs, startAt: now, count: 1 },
        update: fresh
          ? { startAt: now, count: 1 }
          : { count: { increment: 1 } },
      });
    }
    return true;
  }
  async event(
    tx: Prisma.TransactionClient,
    target: { ticketId?: string; caseId?: string },
    kind: string,
    actor: { userId?: string; adminId?: string },
    text: string | null = null,
    isPublic = false,
  ) {
    await tx.p4CaseEvent.create({
      data: {
        ...target,
        kind,
        actorUserId: actor.userId ?? null,
        actorAdminId: actor.adminId ?? null,
        text,
        public: isPublic,
      },
    });
  }
  async notice(
    tx: Prisma.TransactionClient,
    target: {
      userId?: string;
      adminId?: string;
      ticketId?: string;
      caseId?: string;
    },
    kind: string,
    intent: string,
  ) {
    const channels = target.userId
      ? await invitationChannels(tx, target.userId, 'PERSONAL')
      : null;
    const essential = kind === 'MODERATION_OUTCOME';
    await tx.p4Notice.upsert({
      where: { intent },
      create: {
        ...target,
        kind,
        intent,
        inApp: essential || (channels?.inApp ?? true),
        deliveryState:
          target.adminId || (!essential && !channels?.email)
            ? 'SUPPRESSED'
            : 'PENDING',
      },
      update: {},
    });
  }
  async ticket(tx: Prisma.TransactionClient, id: string, userId?: string) {
    await this.lock(tx, 'p4-ticket:' + id);
    const row = await tx.supportTicket.findFirst({
      where: { id, ...(userId ? { ownerUserId: userId } : {}) },
    });
    if (!row) throw new NotFoundException();
    return row;
  }
  async case(tx: Prisma.TransactionClient, id: string, userId?: string) {
    await this.lock(tx, 'p4-case:' + id);
    const row = await tx.moderationCase.findFirst({
      where: {
        id,
        ...(userId
          ? { OR: [{ reporterUserId: userId }, { targetUserId: userId }] }
          : {}),
      },
    });
    if (!row) throw new NotFoundException();
    return row;
  }
  async restricted(
    tx: Prisma.TransactionClient,
    userId: string,
    kind: 'REPORTING' | 'SUPPORT',
  ) {
    if (
      await tx.moderationCase.findFirst({
        where: {
          targetUserId: userId,
          restrictionKind: kind,
          restrictionUntil: { gt: new Date() },
          state: { not: 'DISMISSED' },
        },
      })
    )
      throw new ForbiddenException({ code: 'CASE_RESTRICTION_ACTIVE' });
  }
}

export function checkedPolicy<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    throw new ConflictException({
      code:
        error instanceof Error ? error.message : 'INVALID_POLICY_TRANSITION',
    });
  }
}
