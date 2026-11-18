import {
  Injectable,
  Inject,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { socialHash, socialRevision } from './social-context.js';
import type { Tx } from './social-context.js';
import { ActivityRuntime } from './activity-runtime.js';
import { SocialActivitiesService } from './activities.service.js';
import {
  GoalRuleError,
  localDay,
  goalWindow,
  assertWindow,
  percent,
  assertJoin,
  assertSubmission,
  entryTransition,
  goalTransition,
  settleCompletion,
  assertCorrection,
} from '../domain/goals.js';
import type { GoalKind, GoalState, EntryAction } from '../domain/goals.js';
type Page = z.infer<typeof c.SocialPageQuerySchema>;
type GoalRow = Prisma.SocialGoalGetPayload<object>;
type ParticipantRow = Prisma.SocialGoalParticipantGetPayload<object>;
type EntryRow = Prisma.SocialGoalEntryGetPayload<object>;
type Ref = { groupId: string | null; activityId: string | null };
/** The caller's current authority in the goal's single Group or Activity context. */
type Ctx = Ref & {
  /** Users who currently hold content authority in the context. */
  eligible: Set<string>;
  /** Context managers to notify about pending reviews. */
  managers: string[];
  organizer: boolean;
  member: boolean;
  /** The context accepts new goals, joins and submissions. */
  open: boolean;
};
type Stats = {
  participants: ParticipantRow[];
  approved: Map<string, number>;
  pending: Map<string, number>;
  pendingCount: number;
  total: number;
};
const GOAL_LIMIT = 500;
const PARTICIPANT_LIMIT = 5000;
const ENTRY_LIMIT = 1000;
const HISTORY_LIMIT = 1000;
const day = (d: Date) => d.toISOString().slice(0, 10);
const date = (d: string) => new Date(d + 'T00:00:00.000Z');
const iso = (d: Date | null) => d?.toISOString() ?? null;
/**
 * P6-05 Social Goals and Challenges (ADR 0065 D1–D5). Authority is derived on
 * every request from current Group membership or accepted Activity
 * participation; organizers are the existing context managers (Group
 * Owner/Admin, Activity organizer). Every write locks the goal row after the
 * context fence, so joins, submissions, reviews and corrections serialize.
 */
@Injectable()
export class SocialGoalsService {
  constructor(
    @Inject(ActivityRuntime) private readonly rt: ActivityRuntime,
    @Inject(SocialActivitiesService)
    private readonly activities: SocialActivitiesService,
  ) {}
  private rule<T>(work: () => T): T {
    try {
      return work();
    } catch (e) {
      if (!(e instanceof GoalRuleError)) throw e;
      throw e.status === 403
        ? new ForbiddenException({ code: e.code })
        : e.status === 422
          ? new UnprocessableEntityException({ code: e.code })
          : new ConflictException({ code: e.code });
    }
  }
  private async run<T>(
    actor: RequestActor,
    ref: Ref,
    work: (tx: Tx, now: Date, ctx: Ctx) => Promise<T>,
  ) {
    if (ref.activityId) {
      const activityId = ref.activityId;
      const h = await this.rt.hint(activityId);
      return this.rt.run(actor, h.groupId, [], async (tx, now, locked) => {
        const { act, a } = await this.activities.enter(
          tx,
          actor,
          activityId,
          now,
          locked,
        );
        this.activities.require(a);
        const eligible = await this.rt.eligible(tx, act);
        return work(tx, now, {
          groupId: null,
          activityId,
          eligible: new Set(eligible.map((p) => p.userId!)),
          managers: [
            ...eligible
              .filter((p) => p.role === 'ORGANIZER')
              .map((p) => p.userId!),
            ...(act.groupId ? await this.groupAdmins(tx, act.groupId) : []),
          ],
          organizer: a.manage,
          member: a.active,
          open: act.state === 'PLANNED',
        });
      });
    }
    this.rt.kernel.assertEnabled();
    const groupId = ref.groupId!;
    return this.rt.run(actor, groupId, [], async (tx, now, locked) => {
      if (!(await this.rt.can(tx, actor, groupId, 'task.read', locked)))
        throw new NotFoundException();
      return work(tx, now, {
        groupId,
        activityId: null,
        eligible: await this.rt.groupUsers(tx, groupId),
        managers: await this.groupAdmins(tx, groupId),
        organizer: await this.rt.can(
          tx,
          actor,
          groupId,
          'settings.manage',
          locked,
        ),
        member: true,
        open: true,
      });
    });
  }
  /** Current Group Owner/Admin seats (the ADR 0051 approver set). */
  private async groupAdmins(tx: Tx, groupId: string) {
    const custody = await tx.sharedCustody.findUnique({
      where: { spaceId: groupId },
    });
    const seats = await tx.contextAccess.findMany({
      where: {
        spaceId: groupId,
        scopeId: groupId,
        state: 'ACTIVE',
        OR: [
          { memberRole: 'ADMIN' },
          ...(custody?.primaryOwnerAccessId
            ? [{ id: custody.primaryOwnerAccessId }]
            : []),
        ],
      },
      select: { actorId: true },
    });
    const actors = await tx.sharedActor.findMany({
      where: {
        spaceId: groupId,
        id: { in: seats.map((s) => s.actorId) },
        state: 'ACTIVE',
      },
      select: { userId: true },
    });
    return actors.flatMap((a) => (a.userId ? [a.userId] : []));
  }
  private async onGoal<T>(
    actor: RequestActor,
    id: string,
    work: (tx: Tx, now: Date, ctx: Ctx, g: GoalRow) => Promise<T>,
    lock = true,
  ) {
    this.rt.kernel.assertEnabled();
    const hint = await this.rt.db.client.socialGoal.findUnique({
      where: { id },
      select: { groupId: true, activityId: true },
    });
    if (!hint) throw new NotFoundException();
    return this.run(actor, hint, async (tx, now, ctx) => {
      if (lock)
        await tx.$queryRaw`SELECT id FROM "SocialGoal" WHERE id=${id}::uuid FOR UPDATE`;
      const g = await tx.socialGoal.findUnique({ where: { id } });
      if (!g || g.groupId !== ctx.groupId || g.activityId !== ctx.activityId)
        throw new NotFoundException();
      return work(tx, now, ctx, g);
    });
  }
  private visible(ctx: Ctx, p: ParticipantRow) {
    return p.state === 'ACTIVE' && !!p.userId && ctx.eligible.has(p.userId);
  }
  /**
   * D3: individual progress is for organizers (ALL) and current active
   * participants (PEERS). A withdrawn person who still belongs to the context
   * sees only their own record (SELF).
   */
  private viewScope(ctx: Ctx, mine: ParticipantRow | undefined) {
    if (ctx.organizer) return 'ALL' as const;
    if (!mine?.userId || !ctx.member || !ctx.eligible.has(mine.userId))
      throw new ForbiddenException({ code: 'GOAL_PARTICIPATION_REQUIRED' });
    return mine.state === 'ACTIVE' ? ('PEERS' as const) : ('SELF' as const);
  }
  private requireOrganizer(ctx: Ctx) {
    if (!ctx.organizer)
      throw new ForbiddenException({ code: 'ORGANIZER_REQUIRED' });
  }
  private async stats(tx: Tx, goalIds: string[]) {
    const out = new Map<string, Stats>();
    for (const id of goalIds)
      out.set(id, {
        participants: [],
        approved: new Map(),
        pending: new Map(),
        pendingCount: 0,
        total: 0,
      });
    if (!goalIds.length) return out;
    const participants = await tx.socialGoalParticipant.findMany({
      where: { goalId: { in: goalIds } },
      orderBy: { id: 'asc' },
      take: PARTICIPANT_LIMIT * 4 + 1,
    });
    if (participants.length > PARTICIPANT_LIMIT * 4)
      throw new PayloadTooLargeException();
    for (const p of participants) out.get(p.goalId)!.participants.push(p);
    const sums = await tx.socialGoalEntry.groupBy({
      by: ['goalId', 'participantId', 'state'],
      where: {
        goalId: { in: goalIds },
        state: { in: ['APPROVED', 'PENDING'] },
      },
      _sum: { amount: true },
      _count: { _all: true },
    });
    for (const s of sums) {
      const st = out.get(s.goalId)!,
        amount = s._sum.amount ?? 0;
      if (s.state === 'APPROVED') {
        st.approved.set(s.participantId, amount);
        st.total += amount;
      } else {
        st.pending.set(s.participantId, amount);
        st.pendingCount += s._count._all;
      }
    }
    return out;
  }
  private participantView(
    g: GoalRow,
    p: ParticipantRow,
    st: Stats,
    full: boolean,
  ) {
    const total = st.approved.get(p.id) ?? 0;
    return c.SocialGoalParticipantSchema.parse({
      id: p.id,
      goalId: p.goalId,
      userId: p.userId,
      state: p.state,
      joinedAt: p.joinedAt.toISOString(),
      withdrawnAt: iso(p.withdrawnAt),
      approvedTotal: total,
      pendingTotal: full ? (st.pending.get(p.id) ?? 0) : null,
      percent: percent(total, g.target),
      completed: !!p.completedAt,
      badge: p.completedAt
        ? { kind: 'COMPLETION', awardedAt: p.completedAt.toISOString() }
        : null,
      revision: p.revision,
    });
  }
  private goalView(
    actor: RequestActor,
    ctx: Ctx,
    g: GoalRow,
    st: Stats,
    now: Date,
  ) {
    const shown = st.participants.filter((p) => this.visible(ctx, p)),
      completed = shown.filter((p) => p.completedAt).length,
      mine = st.participants.find((p) => p.userId === actor.userId);
    return c.SocialGoalSchema.parse({
      id: g.id,
      kind: g.kind,
      groupId: g.groupId,
      activityId: g.activityId,
      title: g.title,
      description: g.description,
      unit: g.unit,
      target: g.target,
      startsOn: day(g.startsOn),
      endsOn: day(g.endsOn),
      timezone: g.timezone,
      reviewRequired: g.reviewRequired,
      state: g.state,
      window: goalWindow(
        day(g.startsOn),
        day(g.endsOn),
        localDay(now, g.timezone),
      ),
      createdByUserId: g.createdByUserId,
      completedAt: iso(g.completedAt),
      closedAt: iso(g.closedAt),
      aggregate: {
        participantCount: shown.length,
        completedCount: completed,
        approvedTotal: st.total,
        percent:
          g.kind === 'GOAL'
            ? percent(st.total, g.target)
            : percent(completed, shown.length || 1),
        pendingReviewCount: ctx.organizer ? st.pendingCount : null,
      },
      viewer: {
        organizer: ctx.organizer,
        independentReviewerAvailable: ctx.managers.some(
          (u) => u !== actor.userId,
        ),
        participant: mine ? this.participantView(g, mine, st, true) : null,
      },
      revision: g.revision,
      createdAt: g.createdAt.toISOString(),
      updatedAt: g.updatedAt.toISOString(),
    });
  }
  private async view(
    tx: Tx,
    actor: RequestActor,
    ctx: Ctx,
    id: string,
    now: Date,
  ) {
    const g = (await tx.socialGoal.findUnique({ where: { id } }))!;
    return this.goalView(
      actor,
      ctx,
      g,
      (await this.stats(tx, [id])).get(id)!,
      now,
    );
  }
  private entryView(e: EntryRow, p: ParticipantRow) {
    return c.SocialGoalEntrySchema.parse({
      id: e.id,
      goalId: e.goalId,
      participantId: e.participantId,
      participantUserId: p.userId,
      kind: e.kind,
      amount: e.amount,
      occurredOn: e.occurredOn ? day(e.occurredOn) : null,
      note: e.note,
      state: e.state,
      submittedByUserId: e.submittedByUserId,
      submittedAt: e.submittedAt.toISOString(),
      reviewedByUserId: e.reviewedByUserId,
      reviewedAt: iso(e.reviewedAt),
      reviewNote: e.reviewNote,
      correctsEntryId: e.correctsEntryId,
      revision: e.revision,
    });
  }
  /** Append-only goal history plus the existing transactional outbox. */
  private async event(
    tx: Tx,
    actor: RequestActor | null,
    goalId: string,
    action: string,
    e: {
      participantId?: string | null;
      entryId?: string | null;
      from?: string | null;
      to?: string | null;
      amount?: number | null;
    } = {},
  ) {
    await tx.socialGoalEvent.create({
      data: {
        id: randomUUID(),
        goalId,
        participantId: e.participantId ?? null,
        entryId: e.entryId ?? null,
        actorUserId: actor?.userId ?? null,
        action,
        fromState: e.from ?? null,
        toState: e.to ?? null,
        amount: e.amount ?? null,
      },
    });
  }
  private async outbox(tx: Tx, actor: RequestActor, type: string, id: string) {
    const personal = await this.rt.context.owner(tx, actor.userId);
    await tx.outboxEvent.create({
      data: {
        id: randomUUID(),
        type,
        version: 1,
        aggregateId: id,
        spaceId: personal.spaceId,
        payload: {},
        correlationId: actor.correlationId,
      },
    });
  }
  /** Social inbox notices (polled; ADR 0044). Payload is kind + goal id only. */
  private notify(
    tx: Tx,
    exclude: string | null,
    ctx: Ctx,
    users: (string | null)[],
    kind: string,
    goalId: string,
    dedupe: string,
  ) {
    return this.rt.notify(
      tx,
      users.filter((u) => !!u && u !== exclude && ctx.eligible.has(u)),
      {
        activityId: ctx.activityId,
        groupId: ctx.groupId,
        kind,
        resourceId: goalId,
        dedupe,
      },
    );
  }
  /** Recomputes completion from the approved ledger and records every change. */
  private async settle(
    tx: Tx,
    actor: RequestActor,
    ctx: Ctx,
    g: GoalRow,
    now: Date,
  ) {
    const st = (await this.stats(tx, [g.id])).get(g.id)!;
    const r = settleCompletion({
      kind: g.kind as GoalKind,
      target: g.target,
      total: st.total,
      goalCompletedAt: g.completedAt,
      now,
      // Participants who lost context access keep their recorded outcome.
      participants: st.participants.map((p) => ({
        id: p.id,
        state: this.visible(ctx, p) ? 'ACTIVE' : 'WITHDRAWN',
        completedAt: p.completedAt,
        total: st.approved.get(p.id) ?? 0,
      })),
    });
    if (r.goalCompletedAt !== g.completedAt) {
      await tx.socialGoal.update({
        where: { id: g.id },
        data: {
          completedAt: r.goalCompletedAt,
          revision: { increment: 1 },
          updatedAt: now,
        },
      });
      await this.event(
        tx,
        actor,
        g.id,
        r.goalCompletedAt ? 'goal.completed' : 'goal.completion-revoked',
        { amount: st.total },
      );
    }
    const users = new Map(st.participants.map((p) => [p.id, p.userId]));
    for (const id of r.awards) {
      await tx.socialGoalParticipant.update({
        where: { id },
        data: {
          completedAt: r.goalCompletedAt ?? now,
          revision: { increment: 1 },
          updatedAt: now,
        },
      });
      await this.event(tx, actor, g.id, 'badge.awarded', {
        participantId: id,
        amount: st.approved.get(id) ?? 0,
      });
      // The participant is notified even when their own action completed it.
      await this.notify(
        tx,
        null,
        ctx,
        [users.get(id) ?? null],
        'GOAL_COMPLETED',
        g.id,
        `${id}:${now.toISOString()}`,
      );
    }
    for (const id of r.revocations) {
      await tx.socialGoalParticipant.update({
        where: { id },
        data: {
          completedAt: null,
          revision: { increment: 1 },
          updatedAt: now,
        },
      });
      await this.event(tx, actor, g.id, 'badge.revoked', {
        participantId: id,
        amount: st.approved.get(id) ?? 0,
      });
    }
  }
  private page<T extends { id: string; revision: number }>(
    actor: RequestActor,
    context: string,
    q: Page,
    rows: T[],
    extra: unknown = null,
  ) {
    return this.rt.context.page(
      actor,
      context,
      socialHash([extra, rows.map((r) => [r.id, r.revision])]),
      q,
      rows,
    );
  }

  // Goals ----------------------------------------------------------------------
  async list(
    actor: RequestActor,
    q: z.infer<typeof c.SocialGoalListQuerySchema>,
  ) {
    const ref = {
      groupId: q.groupId ?? null,
      activityId: q.activityId ?? null,
    };
    return this.run(actor, ref, async (tx, now, ctx) => {
      const rows = await tx.socialGoal.findMany({
        where: {
          ...(ref.groupId
            ? { groupId: ref.groupId }
            : { activityId: ref.activityId! }),
          ...(q.kind ? { kind: q.kind } : {}),
          ...(q.state ? { state: q.state } : {}),
        },
        orderBy: { id: 'asc' },
        take: GOAL_LIMIT + 1,
      });
      if (rows.length > GOAL_LIMIT) throw new PayloadTooLargeException();
      let selected = rows;
      if (q.participation !== 'ANY') {
        const joined = new Set(
          (
            await tx.socialGoalParticipant.findMany({
              where: {
                userId: actor.userId,
                state: 'ACTIVE',
                goalId: { in: rows.map((r) => r.id) },
              },
              select: { goalId: true },
            })
          ).map((p) => p.goalId),
        );
        selected = rows.filter(
          (r) => joined.has(r.id) === (q.participation === 'JOINED'),
        );
      }
      const p = this.page(
        actor,
        'social.goals:' + (ref.groupId ?? ref.activityId),
        q,
        selected,
        [q.kind, q.state, q.participation],
      );
      const st = await this.stats(
        tx,
        p.items.map((g) => g.id),
      );
      return {
        ...p,
        items: p.items.map((g) =>
          this.goalView(actor, ctx, g, st.get(g.id)!, now),
        ),
      };
    });
  }
  async create(
    actor: RequestActor,
    body: z.infer<typeof c.SocialGoalCreateSchema>,
    key: string | undefined,
  ) {
    const ref = {
      groupId: body.groupId ?? null,
      activityId: body.activityId ?? null,
    };
    return this.run(actor, ref, async (tx, now, ctx) => {
      this.requireOrganizer(ctx);
      if (!ctx.open) throw new ConflictException({ code: 'CONTEXT_NOT_OPEN' });
      return this.rt.once(
        tx,
        actor,
        'social.goal.create',
        key,
        body,
        now,
        async () => {
          if (await tx.socialGoal.findUnique({ where: { id: body.id } }))
            throw new ConflictException({ code: 'GOAL_EXISTS' });
          const count = await tx.socialGoal.count({
            where: ref.groupId
              ? { groupId: ref.groupId }
              : { activityId: ref.activityId! },
          });
          if (count >= GOAL_LIMIT) throw new PayloadTooLargeException();
          this.rule(() =>
            assertWindow(
              body.startsOn,
              body.endsOn,
              localDay(now, body.timezone),
            ),
          );
          await tx.socialGoal.create({
            data: {
              id: body.id,
              kind: body.kind,
              groupId: ref.groupId,
              activityId: ref.activityId,
              title: body.title,
              description: body.description ?? null,
              unit: body.unit,
              target: body.target,
              startsOn: date(body.startsOn),
              endsOn: date(body.endsOn),
              timezone: body.timezone,
              reviewRequired: body.reviewRequired,
              createdByUserId: actor.userId,
              createdAt: now,
              updatedAt: now,
            },
          });
          await this.event(tx, actor, body.id, 'goal.created', {
            to: 'ACTIVE',
          });
          await this.outbox(tx, actor, 'social.goal.created', body.id);
          return {
            resultId: body.id,
            value: await this.view(tx, actor, ctx, body.id, now),
          };
        },
      );
    });
  }
  async read(actor: RequestActor, id: string) {
    return this.onGoal(
      actor,
      id,
      (tx, now, ctx, g) => this.view(tx, actor, ctx, g.id, now),
      false,
    );
  }
  async patch(
    actor: RequestActor,
    id: string,
    body: z.infer<typeof c.SocialGoalPatchSchema>,
    revision: number,
    key: string | undefined,
  ) {
    return this.onGoal(actor, id, async (tx, now, ctx, g) => {
      this.requireOrganizer(ctx);
      return this.rt.once(
        tx,
        actor,
        'social.goal.update',
        key,
        { id, body, revision },
        now,
        async () => {
          socialRevision(revision, g.revision);
          this.rule(() => {
            if (g.state !== 'ACTIVE')
              throw new GoalRuleError('GOAL_NOT_ACTIVE');
            if (body.endsOn)
              assertWindow(
                day(g.startsOn),
                body.endsOn,
                localDay(now, g.timezone),
              );
          });
          const next = await tx.socialGoal.update({
            where: { id },
            data: {
              ...(body.title !== undefined ? { title: body.title } : {}),
              ...(body.description !== undefined
                ? { description: body.description }
                : {}),
              ...(body.target !== undefined ? { target: body.target } : {}),
              ...(body.endsOn !== undefined
                ? { endsOn: date(body.endsOn) }
                : {}),
              ...(body.reviewRequired !== undefined
                ? { reviewRequired: body.reviewRequired }
                : {}),
              revision: { increment: 1 },
              updatedAt: now,
            },
          });
          await this.event(tx, actor, id, 'goal.updated', {
            amount: body.target ?? null,
          });
          if (body.target !== undefined && body.target !== g.target)
            await this.settle(tx, actor, ctx, next, now);
          await this.outbox(tx, actor, 'social.goal.updated', id);
          return {
            resultId: id,
            value: await this.view(tx, actor, ctx, id, now),
          };
        },
      );
    });
  }
  async act(
    actor: RequestActor,
    id: string,
    action: z.infer<typeof c.SocialGoalActionSchema>,
    revision: number,
    key: string | undefined,
  ) {
    return this.onGoal(actor, id, async (tx, now, ctx, g) => {
      this.requireOrganizer(ctx);
      return this.rt.once(
        tx,
        actor,
        'social.goal.' + action,
        key,
        { id, revision },
        now,
        async () => {
          socialRevision(revision, g.revision);
          const to = this.rule(() =>
            goalTransition(action, g.state as GoalState),
          );
          await tx.socialGoal.update({
            where: { id },
            data: {
              state: to,
              closedAt: now,
              revision: { increment: 1 },
              updatedAt: now,
            },
          });
          await this.event(tx, actor, id, 'goal.' + action, {
            from: g.state,
            to,
          });
          const active = await tx.socialGoalParticipant.findMany({
            where: { goalId: id, state: 'ACTIVE' },
            select: { userId: true },
          });
          await this.notify(
            tx,
            actor.userId,
            ctx,
            active.map((p) => p.userId),
            'GOAL_ENDED',
            id,
            `${id}:${to}`,
          );
          await this.outbox(tx, actor, 'social.goal.' + action, id);
          return {
            resultId: id,
            value: await this.view(tx, actor, ctx, id, now),
          };
        },
      );
    });
  }

  // Participation --------------------------------------------------------------
  /** D4: voluntary, explicit opt-in by a current context participant; no approval. */
  async join(actor: RequestActor, id: string, key: string | undefined) {
    return this.onGoal(actor, id, async (tx, now, ctx, g) =>
      this.rt.once(
        tx,
        actor,
        'social.goal.join',
        key,
        { id },
        now,
        async () => {
          if (!ctx.member || !ctx.eligible.has(actor.userId))
            throw new ForbiddenException({
              code: 'CONTEXT_PARTICIPATION_REQUIRED',
            });
          if (!ctx.open)
            throw new ConflictException({ code: 'CONTEXT_NOT_OPEN' });
          this.rule(() =>
            assertJoin({
              state: g.state as GoalState,
              kind: g.kind as GoalKind,
              completedAt: g.completedAt,
              window: goalWindow(
                day(g.startsOn),
                day(g.endsOn),
                localDay(now, g.timezone),
              ),
            }),
          );
          const prior = await tx.socialGoalParticipant.findUnique({
            where: { goalId_userId: { goalId: id, userId: actor.userId } },
          });
          if (prior?.state === 'ACTIVE')
            throw new ConflictException({ code: 'ALREADY_JOINED' });
          let pid = prior?.id;
          if (prior)
            await tx.socialGoalParticipant.update({
              where: { id: prior.id },
              data: {
                state: 'ACTIVE',
                withdrawnAt: null,
                revision: { increment: 1 },
                updatedAt: now,
              },
            });
          else {
            if (
              (await tx.socialGoalParticipant.count({
                where: { goalId: id },
              })) >= PARTICIPANT_LIMIT
            )
              throw new PayloadTooLargeException();
            pid = randomUUID();
            await tx.socialGoalParticipant.create({
              data: {
                id: pid,
                goalId: id,
                userId: actor.userId,
                joinedAt: now,
                createdAt: now,
                updatedAt: now,
              },
            });
          }
          await this.event(tx, actor, id, 'participant.joined', {
            participantId: pid!,
            from: prior?.state ?? null,
            to: 'ACTIVE',
          });
          await this.settle(tx, actor, ctx, g, now);
          await this.outbox(tx, actor, 'social.goal.joined', id);
          return { resultId: pid!, value: await this.mine(tx, g.id, pid!) };
        },
      ),
    );
  }
  private async mine(tx: Tx, goalId: string, participantId: string) {
    const g = (await tx.socialGoal.findUnique({ where: { id: goalId } }))!,
      st = (await this.stats(tx, [goalId])).get(goalId)!;
    return this.participantView(
      g,
      st.participants.find((p) => p.id === participantId)!,
      st,
      true,
    );
  }
  async withdraw(
    actor: RequestActor,
    id: string,
    revision: number,
    key: string | undefined,
  ) {
    return this.onGoal(actor, id, async (tx, now, _ctx, g) =>
      this.rt.once(
        tx,
        actor,
        'social.goal.withdraw',
        key,
        { id, revision },
        now,
        async () => {
          const p = await tx.socialGoalParticipant.findUnique({
            where: { goalId_userId: { goalId: id, userId: actor.userId } },
          });
          if (!p || p.state !== 'ACTIVE')
            throw new ConflictException({ code: 'NOT_PARTICIPATING' });
          socialRevision(revision, p.revision);
          this.rule(() => {
            if (g.state !== 'ACTIVE')
              throw new GoalRuleError('GOAL_NOT_ACTIVE');
          });
          await tx.socialGoalParticipant.update({
            where: { id: p.id },
            data: {
              state: 'WITHDRAWN',
              withdrawnAt: now,
              revision: { increment: 1 },
              updatedAt: now,
            },
          });
          // Withdrawal ends the person's undecided reports; approved progress stays.
          const pending = await tx.socialGoalEntry.findMany({
            where: { goalId: id, participantId: p.id, state: 'PENDING' },
            select: { id: true },
          });
          await tx.socialGoalEntry.updateMany({
            where: { id: { in: pending.map((e) => e.id) } },
            data: {
              state: 'RETRACTED',
              revision: { increment: 1 },
              updatedAt: now,
            },
          });
          for (const e of pending)
            await this.event(tx, actor, id, 'entry.retracted', {
              participantId: p.id,
              entryId: e.id,
              from: 'PENDING',
              to: 'RETRACTED',
            });
          await this.event(tx, actor, id, 'participant.withdrew', {
            participantId: p.id,
            from: 'ACTIVE',
            to: 'WITHDRAWN',
          });
          await this.outbox(tx, actor, 'social.goal.withdrew', id);
          return { resultId: p.id, value: await this.mine(tx, id, p.id) };
        },
      ),
    );
  }
  /** D3: individual progress of current, authorized active participants only. */
  async participants(actor: RequestActor, id: string, q: Page) {
    return this.onGoal(
      actor,
      id,
      async (tx, _now, ctx, g) => {
        const st = (await this.stats(tx, [id])).get(id)!;
        const mine = st.participants.find((p) => p.userId === actor.userId);
        const scope = this.viewScope(ctx, mine);
        const rows = st.participants.filter((p) =>
          scope === 'SELF' ? p.id === mine!.id : this.visible(ctx, p),
        );
        const p = this.page(actor, 'social.goal.participants:' + id, q, rows, [
          ...st.approved,
        ]);
        return {
          ...p,
          items: p.items.map((r) =>
            this.participantView(
              g,
              r,
              st,
              ctx.organizer || r.userId === actor.userId,
            ),
          ),
        };
      },
      false,
    );
  }

  // Progress entries -----------------------------------------------------------
  async entries(
    actor: RequestActor,
    id: string,
    q: z.infer<typeof c.SocialGoalEntryListQuerySchema>,
  ) {
    return this.onGoal(
      actor,
      id,
      async (tx, _now, ctx, g) => {
        const participants = await tx.socialGoalParticipant.findMany({
          where: { goalId: g.id },
          take: PARTICIPANT_LIMIT + 1,
        });
        const mine = participants.find((p) => p.userId === actor.userId);
        const scope = this.viewScope(ctx, mine);
        // Organizers see every state for current context members; active
        // participants see their own entries and others' approved entries only.
        const byId = new Map(participants.map((p) => [p.id, p]));
        const rows = (
          await tx.socialGoalEntry.findMany({
            where: {
              goalId: g.id,
              ...(q.state ? { state: q.state } : {}),
              ...(q.participantId ? { participantId: q.participantId } : {}),
            },
            orderBy: { id: 'asc' },
            take: ENTRY_LIMIT * 10 + 1,
          })
        ).filter((e) => {
          const p = byId.get(e.participantId)!;
          if (p.id === mine?.id) return true;
          if (!p.userId || !ctx.eligible.has(p.userId)) return false;
          return (
            scope === 'ALL' ||
            (scope === 'PEERS' &&
              this.visible(ctx, p) &&
              e.state === 'APPROVED')
          );
        });
        if (rows.length > ENTRY_LIMIT * 10)
          throw new PayloadTooLargeException();
        const p = this.page(actor, 'social.goal.entries:' + id, q, rows, [
          q.state,
          q.participantId,
        ]);
        return {
          ...p,
          items: p.items.map((e) =>
            this.entryView(e, byId.get(e.participantId)!),
          ),
        };
      },
      false,
    );
  }
  /** D2: participants submit only their own progress; retries never count twice. */
  async submit(
    actor: RequestActor,
    id: string,
    body: z.infer<typeof c.SocialGoalEntryCreateSchema>,
    key: string | undefined,
  ) {
    return this.onGoal(actor, id, async (tx, now, ctx, g) =>
      this.rt.once(
        tx,
        actor,
        'social.goal.submit',
        key,
        { id, body },
        now,
        async () => {
          const p = await tx.socialGoalParticipant.findUnique({
            where: { goalId_userId: { goalId: id, userId: actor.userId } },
          });
          if (!p || !ctx.member || !this.visible(ctx, p))
            throw new ForbiddenException({
              code: 'GOAL_PARTICIPATION_REQUIRED',
            });
          if (!ctx.open)
            throw new ConflictException({ code: 'CONTEXT_NOT_OPEN' });
          this.rule(() =>
            assertSubmission(
              {
                state: g.state as GoalState,
                startsOn: day(g.startsOn),
                endsOn: day(g.endsOn),
              },
              body.occurredOn,
              localDay(now, g.timezone),
            ),
          );
          if (await tx.socialGoalEntry.findUnique({ where: { id: body.id } }))
            throw new ConflictException({ code: 'ENTRY_EXISTS' });
          if (
            (await tx.socialGoalEntry.count({
              where: { goalId: id, participantId: p.id },
            })) >= ENTRY_LIMIT
          )
            throw new PayloadTooLargeException();
          const state = g.reviewRequired ? 'PENDING' : 'APPROVED';
          const e = await tx.socialGoalEntry.create({
            data: {
              id: body.id,
              goalId: id,
              participantId: p.id,
              kind: 'SUBMISSION',
              amount: body.amount,
              occurredOn: date(body.occurredOn),
              note: body.note?.trim() || null,
              state,
              submittedByUserId: actor.userId,
              submittedAt: now,
              updatedAt: now,
            },
          });
          await tx.socialGoalParticipant.update({
            where: { id: p.id },
            data: { revision: { increment: 1 }, updatedAt: now },
          });
          await this.event(tx, actor, id, 'entry.submitted', {
            participantId: p.id,
            entryId: e.id,
            to: state,
            amount: e.amount,
          });
          if (state === 'APPROVED') await this.settle(tx, actor, ctx, g, now);
          else
            await this.notify(
              tx,
              actor.userId,
              ctx,
              ctx.managers,
              'GOAL_ENTRY_SUBMITTED',
              id,
              e.id,
            );
          await this.outbox(tx, actor, 'social.goal.entry.submitted', id);
          return { resultId: e.id, value: this.entryView(e, p) };
        },
      ),
    );
  }
  async entryAct(
    actor: RequestActor,
    id: string,
    entryId: string,
    action: EntryAction,
    body: z.infer<typeof c.SocialGoalEntryDecisionSchema>,
    revision: number,
    key: string | undefined,
  ) {
    return this.onGoal(actor, id, async (tx, now, ctx, g) =>
      this.rt.once(
        tx,
        actor,
        'social.goal.entry.' + action,
        key,
        { id, entryId, body, revision },
        now,
        async () => {
          const e = await tx.socialGoalEntry.findUnique({
            where: { goalId_id: { goalId: id, id: entryId } },
          });
          const p = e
            ? await tx.socialGoalParticipant.findUnique({
                where: { id: e.participantId },
              })
            : null;
          const own = p?.userId === actor.userId;
          if (!e || !p || (!own && !ctx.organizer) || (!own && !p.userId))
            throw new NotFoundException();
          if (!this.visible(ctx, p))
            throw new ConflictException({ code: 'PARTICIPANT_INACTIVE' });
          socialRevision(revision, e.revision);
          const to = this.rule(() =>
            entryTransition(
              action,
              {
                kind: e.kind as 'SUBMISSION' | 'CORRECTION',
                state: e.state as 'PENDING',
                submittedByUserId: e.submittedByUserId,
                reviewedAt: e.reviewedAt,
              },
              g.state as GoalState,
              { userId: actor.userId, organizer: ctx.organizer },
            ),
          );
          const review = action !== 'retract';
          const next = await tx.socialGoalEntry.update({
            where: { id: e.id },
            data: {
              state: to,
              ...(review
                ? {
                    reviewedByUserId: actor.userId,
                    reviewedAt: now,
                    reviewNote: body.note?.trim() || null,
                  }
                : {}),
              revision: { increment: 1 },
              updatedAt: now,
            },
          });
          await tx.socialGoalParticipant.update({
            where: { id: p.id },
            data: { revision: { increment: 1 }, updatedAt: now },
          });
          await this.event(
            tx,
            actor,
            id,
            review ? 'entry.reviewed' : 'entry.retracted',
            {
              participantId: p.id,
              entryId: e.id,
              from: e.state,
              to,
              amount: e.amount,
            },
          );
          if (to === 'APPROVED' || e.state === 'APPROVED')
            await this.settle(tx, actor, ctx, g, now);
          if (review)
            await this.notify(
              tx,
              actor.userId,
              ctx,
              [p.userId],
              'GOAL_ENTRY_DECIDED',
              id,
              `${e.id}:${to}`,
            );
          await this.outbox(tx, actor, 'social.goal.entry.' + action, id);
          return { resultId: e.id, value: this.entryView(next, p) };
        },
      ),
    );
  }
  /**
   * D2: an organizer corrects an administrative error with an explicit, signed
   * CORRECTION entry carrying a reason; the participant's own submissions are
   * never rewritten. The participant's revision fences stale corrections.
   */
  async correct(
    actor: RequestActor,
    id: string,
    body: z.infer<typeof c.SocialGoalCorrectionCreateSchema>,
    revision: number,
    key: string | undefined,
  ) {
    return this.onGoal(actor, id, async (tx, now, ctx, g) => {
      this.requireOrganizer(ctx);
      return this.rt.once(
        tx,
        actor,
        'social.goal.correct',
        key,
        { id, body, revision },
        now,
        async () => {
          if (g.state === 'CANCELED')
            throw new ConflictException({ code: 'GOAL_NOT_ACTIVE' });
          const p = await tx.socialGoalParticipant.findUnique({
            where: { goalId_id: { goalId: id, id: body.participantId } },
          });
          if (!p || !p.userId || !ctx.eligible.has(p.userId))
            throw new NotFoundException();
          if (p.state !== 'ACTIVE')
            throw new ConflictException({ code: 'PARTICIPANT_INACTIVE' });
          if (p.userId === actor.userId)
            throw new ForbiddenException({ code: 'SELF_REVIEW_FORBIDDEN' });
          socialRevision(revision, p.revision);
          if (body.correctsEntryId) {
            const target = await tx.socialGoalEntry.findUnique({
              where: { goalId_id: { goalId: id, id: body.correctsEntryId } },
            });
            if (
              target?.participantId !== p.id ||
              target.kind !== 'SUBMISSION' ||
              target.state !== 'APPROVED'
            )
              throw new UnprocessableEntityException({
                code: 'INVALID_CORRECTION_TARGET',
              });
          }
          if (await tx.socialGoalEntry.findUnique({ where: { id: body.id } }))
            throw new ConflictException({ code: 'ENTRY_EXISTS' });
          const current =
            (
              await tx.socialGoalEntry.aggregate({
                where: { goalId: id, participantId: p.id, state: 'APPROVED' },
                _sum: { amount: true },
              })
            )._sum.amount ?? 0;
          this.rule(() => assertCorrection(current, body.delta));
          const e = await tx.socialGoalEntry.create({
            data: {
              id: body.id,
              goalId: id,
              participantId: p.id,
              kind: 'CORRECTION',
              amount: body.delta,
              note: body.reason,
              state: 'APPROVED',
              submittedByUserId: actor.userId,
              submittedAt: now,
              correctsEntryId: body.correctsEntryId ?? null,
              updatedAt: now,
            },
          });
          await tx.socialGoalParticipant.update({
            where: { id: p.id },
            data: { revision: { increment: 1 }, updatedAt: now },
          });
          await this.event(tx, actor, id, 'entry.corrected', {
            participantId: p.id,
            entryId: e.id,
            to: 'APPROVED',
            amount: e.amount,
          });
          await this.settle(tx, actor, ctx, g, now);
          await this.notify(
            tx,
            actor.userId,
            ctx,
            [p.userId],
            'GOAL_CORRECTED',
            id,
            e.id,
          );
          await this.outbox(tx, actor, 'social.goal.corrected', id);
          return { resultId: e.id, value: this.entryView(e, p) };
        },
      );
    });
  }
  /** Authorized revision history; events about hidden participants are omitted. */
  async history(actor: RequestActor, id: string) {
    return this.onGoal(
      actor,
      id,
      async (tx, _now, ctx, g) => {
        const participants = await tx.socialGoalParticipant.findMany({
          where: { goalId: g.id },
          take: PARTICIPANT_LIMIT + 1,
        });
        const mine = participants.find((p) => p.userId === actor.userId);
        const scope = this.viewScope(ctx, mine);
        const shown = new Set(
          participants
            .filter(
              (p) =>
                p.id === mine?.id ||
                (scope !== 'SELF' &&
                  !!p.userId &&
                  ctx.eligible.has(p.userId) &&
                  (ctx.organizer || p.state === 'ACTIVE')),
            )
            .map((p) => p.id),
        );
        const rows = (
          await tx.socialGoalEvent.findMany({
            where: { goalId: g.id },
            orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
            take: HISTORY_LIMIT + 1,
          })
        ).filter((r) => !r.participantId || shown.has(r.participantId));
        return c.SocialGoalHistorySchema.parse({
          truncated: rows.length > HISTORY_LIMIT,
          items: rows
            .slice(0, HISTORY_LIMIT)
            .reverse()
            .map((r) => ({
              id: r.id,
              participantId: r.participantId,
              entryId: r.entryId,
              actorUserId: r.actorUserId,
              action: r.action,
              fromState: r.fromState,
              toState: r.toState,
              amount: r.amount,
              occurredAt: r.occurredAt.toISOString(),
            })),
        });
      },
      false,
    );
  }
}
