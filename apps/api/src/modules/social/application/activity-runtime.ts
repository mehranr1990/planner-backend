import {
  Injectable,
  Inject,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../generated/prisma/client.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { SharedIdentity } from '../../../platform/auth/shared-identity.js';
import { SharedKernel } from '../../spaces/public/index.js';
import type { SharedRequest } from '../../spaces/public/index.js';
import { SocialContext, socialHash, socialKey } from './social-context.js';
import { ConversationSourceGuard } from '../../messaging/public/index.js';
import type { Tx } from './social-context.js';
import { reconcileSeats } from '../domain/seats.js';
export type ActivityRow = Prisma.SocialActivityGetPayload<object>;
export type ParticipantRow = Prisma.SocialActivityParticipantGetPayload<object>;
export type ActivityAccess = {
  participant: ParticipantRow | null;
  /** Explicitly accepted, current participation: the only content authority. */
  active: boolean;
  organizer: boolean;
  groupMember: boolean;
  groupAdmin: boolean;
  manage: boolean;
};
type Work<T> = (tx: Tx, now: Date, locked: string[]) => Promise<T>;
/**
 * ADR 0060: Activities are Social-owned participation contexts. Group
 * Activities run inside the Group custody fence; independent Activities use
 * the existing verified pair/account fence. Every write locks the Activity row.
 */
@Injectable()
export class ActivityRuntime {
  constructor(
    @Inject(DatabaseService) readonly db: DatabaseService,
    @Inject(SharedKernel) readonly kernel: SharedKernel,
    @Inject(SocialContext) readonly context: SocialContext,
    @Inject(SharedIdentity) private readonly identity: SharedIdentity,
  ) {}
  async hint(id: string) {
    this.kernel.assertEnabled();
    const row = await this.db.client.socialActivity.findUnique({
      where: { id },
      select: { id: true, groupId: true },
    });
    if (!row) throw new NotFoundException();
    await this.dispose(id);
    return row;
  }
  /**
   * ADR 0060 decision B: deleted Social content is recoverable for 30 days and
   * then disposed in its own committed transaction, so a later failing request
   * cannot roll disposal back. Financial records, settlements, participants and
   * Social audit evidence are a separate, policy-gated retention class.
   */
  async dispose(id: string) {
    const at = new Date();
    const [act, items] = await Promise.all([
      this.db.client.socialActivity.findUnique({
        where: { id },
        select: { state: true, recoverUntil: true, contentDisposedAt: true },
      }),
      this.db.client.socialActivityItem.count({
        where: { activityId: id, recoverUntil: { lte: at } },
      }),
    ]);
    const due =
      act?.state === 'DELETED' &&
      !act.contentDisposedAt &&
      act.recoverUntil! <= at;
    if (!items && !due) return;
    await this.db.client.$transaction(async (tx) => {
      const now = (
        await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() now`
      )[0]!.now;
      const row = await this.lock(tx, id);
      await tx.socialActivityItem.deleteMany({
        where: { activityId: id, recoverUntil: { lte: now } },
      });
      if (
        row.state !== 'DELETED' ||
        row.contentDisposedAt ||
        row.recoverUntil! > now
      )
        return;
      await tx.socialActivityItem.deleteMany({ where: { activityId: id } });
      await tx.socialActivityPoll.deleteMany({ where: { activityId: id } });
      await tx.socialActivityBusy.deleteMany({ where: { activityId: id } });
      await tx.socialNotice.deleteMany({ where: { activityId: id } });
      // P6-05 goals are Activity content: disposed with it (participants, entries, history).
      await tx.socialGoal.deleteMany({ where: { activityId: id } });
      await tx.socialActivity.update({
        where: { id },
        data: {
          description: null,
          location: null,
          successorParticipantId: null,
          contentDisposedAt: now,
        },
      });
    });
  }
  run<T>(
    actor: RequestActor,
    groupId: string | null,
    users: string[],
    work: Work<T>,
  ) {
    const body: Work<T> = async (tx, now, locked) => {
      await this.context.owner(tx, actor.userId);
      return work(tx, now, locked);
    };
    return groupId
      ? this.kernel.participate(actor, groupId, users, body)
      : this.kernel.contactOperation(actor, users, body);
  }
  async lock(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM "SocialActivity" WHERE id=${id}::uuid FOR UPDATE`;
    const row = await tx.socialActivity.findUnique({ where: { id } });
    if (!row) throw new NotFoundException();
    return row;
  }
  async can(
    tx: Tx,
    actor: RequestActor,
    groupId: string,
    capability: SharedRequest['capability'],
    locked: string[],
  ) {
    try {
      await this.kernel.participantAuthority(
        tx,
        actor,
        actor.userId,
        { spaceId: groupId, scopeId: groupId, capability },
        locked,
      );
      return true;
    } catch (e) {
      if (e instanceof NotFoundException || e instanceof ForbiddenException)
        return false;
      throw e;
    }
  }
  /** Current Group seats, resolved by the owner records Social already reads for Group views. */
  async groupUsers(tx: Tx, groupId: string) {
    const seats = await tx.contextAccess.findMany({
      where: { spaceId: groupId, scopeId: groupId, state: 'ACTIVE' },
      select: { actorId: true },
      take: 5001,
    });
    if (seats.length > 5000)
      throw new ConflictException({ code: 'GROUP_TOO_LARGE' });
    const actors = await tx.sharedActor.findMany({
      where: {
        spaceId: groupId,
        id: { in: seats.map((s) => s.actorId) },
        state: 'ACTIVE',
      },
      select: { userId: true },
    });
    return new Set(actors.flatMap((a) => (a.userId ? [a.userId] : [])));
  }
  async access(
    tx: Tx,
    actor: RequestActor,
    act: ActivityRow,
    locked: string[],
  ): Promise<ActivityAccess> {
    const participant = await tx.socialActivityParticipant.findUnique({
      where: {
        activityId_userId: { activityId: act.id, userId: actor.userId },
      },
    });
    let groupMember = false,
      groupAdmin = false;
    if (act.groupId) {
      groupMember = await this.can(tx, actor, act.groupId, 'task.read', locked);
      groupAdmin =
        groupMember &&
        (await this.can(tx, actor, act.groupId, 'settings.manage', locked));
    }
    // A Group-derived participant loses content access with Group membership;
    // an explicitly invited guest keeps only this Activity (ADR 0051).
    const active =
      participant?.state === 'ACTIVE' &&
      (!act.groupId || participant.guest || groupMember);
    const organizer = active && participant!.role === 'ORGANIZER';
    return {
      participant,
      active,
      organizer,
      groupMember,
      groupAdmin,
      manage: organizer || groupAdmin,
    };
  }
  /** Users who currently hold Activity content authority. */
  async eligible(tx: Tx, act: ActivityRow) {
    const rows = await tx.socialActivityParticipant.findMany({
      where: { activityId: act.id, state: 'ACTIVE', userId: { not: null } },
    });
    const group = act.groupId ? await this.groupUsers(tx, act.groupId) : null;
    return rows.filter((r) => !group || r.guest || group.has(r.userId!));
  }
  async displayName(tx: Tx, userId: string | null) {
    if (!userId) return null;
    try {
      return (await this.identity.display(tx, userId))?.name ?? null;
    } catch {
      return null;
    }
  }
  /** Time-driven offer expiry and FIFO promotion are applied under the Activity lock. */
  async reconcile(tx: Tx, act: ActivityRow, now: Date) {
    const rows = await tx.socialActivityParticipant.findMany({
      where: { activityId: act.id },
    });
    const changes = reconcileSeats(
      act.capacity,
      act.state === 'PLANNED' && act.endsAt > now,
      rows,
      now,
    );
    for (const change of changes) {
      await tx.socialActivityParticipant.update({
        where: { id: change.id },
        data: {
          seat: change.seat,
          waitlistedAt: change.waitlistedAt,
          offerExpiresAt: change.offerExpiresAt,
          revision: { increment: 1 },
          updatedAt: now,
        },
      });
      const row = rows.find((r) => r.id === change.id)!;
      if (change.seat === 'OFFERED' && row.userId)
        await this.notify(tx, [row.userId], {
          activityId: act.id,
          kind: 'SEAT_OFFERED',
          resourceId: row.id,
          dedupe: `${row.id}:${change.offerExpiresAt!.toISOString()}`,
        });
    }
    return changes.length > 0;
  }
  async notify(
    tx: Tx,
    userIds: (string | null)[],
    n: {
      activityId?: string | null;
      groupId?: string | null;
      kind: string;
      resourceId: string;
      dedupe: string;
    },
  ) {
    const recipients = [...new Set(userIds.filter((u): u is string => !!u))];
    if (!recipients.length) return;
    await tx.socialNotice.createMany({
      data: recipients.map((userId) => ({
        id: randomUUID(),
        userId,
        activityId: n.activityId ?? null,
        groupId: n.activityId ? null : (n.groupId ?? null),
        kind: n.kind,
        resourceId: n.resourceId,
        dedupeKey: `${n.kind}:${n.dedupe}`.slice(0, 160),
      })),
      skipDuplicates: true,
    });
  }
  /** Social-owned metadata audit plus the existing transactional outbox. */
  async record(
    tx: Tx,
    actor: RequestActor,
    ctx: { activityId?: string | null; groupId?: string | null },
    action: string,
    resourceId: string,
  ) {
    const personal = await this.context.owner(tx, actor.userId);
    await tx.socialAuditEvent.create({
      data: {
        id: randomUUID(),
        activityId: ctx.activityId ?? null,
        groupId: ctx.activityId ? null : (ctx.groupId ?? null),
        actorUserId: actor.userId,
        action,
        resourceId,
      },
    });
    await tx.outboxEvent.create({
      data: {
        id: randomUUID(),
        type: action,
        version: 1,
        aggregateId: resourceId,
        spaceId: personal.spaceId,
        payload: {},
        correlationId: actor.correlationId,
      },
    });
  }
  /** Scoped idempotency receipt in the caller's Personal namespace; the effect and receipt commit together. */
  async once<T>(
    tx: Tx,
    actor: RequestActor,
    operation: string,
    key: string | undefined,
    body: unknown,
    now: Date,
    work: () => Promise<{ resultId: string; value: T }>,
  ): Promise<T> {
    const keyHash = socialKey(key),
      fingerprint = socialHash(body);
    const personal = await this.context.owner(tx, actor.userId);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'social-receipt:' + actor.userId + ':' + operation + ':' + keyHash},0))::text`;
    const prior = await tx.idempotencyRecord.findUnique({
      where: {
        actorUserId_spaceId_operation_keyHash: {
          actorUserId: actor.userId,
          spaceId: personal.spaceId,
          operation,
          keyHash,
        },
      },
    });
    if (prior && prior.expiresAt > now) {
      if (prior.fingerprint !== fingerprint)
        throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT' });
      return prior.result as T;
    }
    if (prior) await tx.idempotencyRecord.delete({ where: { id: prior.id } });
    const { resultId, value } = await work();
    await tx.idempotencyRecord.create({
      data: {
        id: randomUUID(),
        actorUserId: actor.userId,
        spaceId: personal.spaceId,
        operation,
        keyHash,
        fingerprint,
        resultId,
        statusCode: 200,
        result: JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue,
        expiresAt: new Date(now.getTime() + 86400000),
      },
    });
    return value;
  }
}
/**
 * ADR 0062: current accepted participation is the only Activity chat authority.
 * Messaging calls this on every user operation; the shared row lock serializes
 * it against concurrent removal, leave or erasure.
 */
@Injectable()
export class ActivityConversationGuard extends ConversationSourceGuard {
  constructor(@Inject(ActivityRuntime) private readonly rt: ActivityRuntime) {
    super();
  }
  async assert(tx: Tx, activityId: string, userId: string) {
    await tx.$queryRaw`SELECT id FROM "SocialActivityParticipant" WHERE "activityId"=${activityId}::uuid AND "userId"=${userId}::uuid FOR SHARE`;
    const act = await tx.socialActivity.findUnique({
      where: { id: activityId },
    });
    const p = await tx.socialActivityParticipant.findUnique({
      where: { activityId_userId: { activityId, userId } },
    });
    if (!act || act.state === 'DELETED' || p?.state !== 'ACTIVE')
      throw new NotFoundException();
    if (
      act.groupId &&
      !p.guest &&
      !(await this.rt.groupUsers(tx, act.groupId)).has(userId)
    )
      throw new NotFoundException();
    return p.role === 'ORGANIZER' ? ('ADMIN' as const) : ('MEMBER' as const);
  }
}
