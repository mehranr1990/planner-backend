import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import * as c from '@mehran/api-contracts';
import type { Prisma } from '../../../generated/prisma/client.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import { scopedWhere } from '../../../platform/database/scoped-where.js';
import {
  cursorPosition,
  cursorPage,
  afterCursor,
} from '../../../platform/database/cursor-pagination.js';
import { idempotent } from '../../../platform/database/idempotency.js';
import type { MutationReceipt } from '../../../platform/database/idempotency.js';
import { writeAudit } from '../../../platform/audit/audit.service.js';
import { appendOutbox } from '../../../platform/outbox/outbox.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { PlanningTasks } from '../../tasks/public/index.js';
import { GoalHabits } from '../../habits/public/index.js';
import { PlanningPreferences } from '../../account/public/index.js';
import type {
  GoalsPort,
  GoalsTransaction,
  Area,
  Kind,
  PageQuery,
  GoalQuery,
  ReviewQuery,
} from '../application/goals.port.js';
const date = (v: string | null) =>
  v === null ? null : new Date(v + 'T00:00:00Z');
const iso = (v: Date | null) => v?.toISOString().slice(0, 10) ?? null;
const areaView = (r: Prisma.LifeAreaGetPayload<object>) =>
  c.LifeAreaSchema.parse({
    ...r,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  });
const goalView = (r: Prisma.GoalGetPayload<object>) =>
  c.GoalSchema.parse({
    ...r,
    startDate: iso(r.startDate),
    targetDate: iso(r.targetDate),
    manualProgress: r.manualProgress.toString(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  });
const reviewView = (r: Prisma.GoalReviewGetPayload<object>) =>
  c.GoalReviewSchema.parse({
    id: r.id,
    goalId: r.goalId,
    kind: r.kind,
    reflection: r.reflection,
    snapshot: r.snapshot,
    createdAt: r.createdAt.toISOString(),
  });
class Store implements GoalsTransaction {
  constructor(
    private readonly tx: Prisma.TransactionClient,
    private readonly scope: AuthorizedSpace,
    private readonly tasks: PlanningTasks,
    private readonly habits: GoalHabits,
    private readonly account: PlanningPreferences,
  ) {}
  private where<T extends object>(q: T) {
    return scopedWhere(this.scope, q);
  }
  private owner() {
    return {
      spaceId: this.scope.spaceId,
      createdByUserId: this.scope.actor.userId,
    };
  }
  private context(prefix: string, v: unknown) {
    return (
      prefix + createHash('sha256').update(JSON.stringify(v)).digest('hex')
    );
  }
  private pagination(ctx: string, q: PageQuery) {
    return {
      where: afterCursor(cursorPosition(this.scope, ctx, q.cursor)),
      take: Number(q.limit ?? 25) + 1,
      limit: Number(q.limit ?? 25),
    };
  }
  async timezone() {
    return (await this.account.read(this.tx, this.scope)).timezone;
  }
  async area(id: string) {
    const r = await this.tx.lifeArea.findFirst({ where: this.where({ id }) });
    if (!r) throw new NotFoundException();
    return areaView(r);
  }
  async areas(q: PageQuery) {
    const ctx = 'life-areas',
      p = this.pagination(ctx, q),
      rows = await this.tx.lifeArea.findMany({
        where: this.where(p.where),
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: p.take,
      }),
      page = cursorPage(this.scope, ctx, p.limit, rows);
    return { ...page, items: page.items.map(areaView) };
  }
  async createArea(input: c.LifeAreaCreate) {
    return areaView(
      await this.tx.lifeArea.create({ data: { ...this.owner(), ...input } }),
    );
  }
  async updateArea(before: Area, input: c.LifeAreaPatch) {
    const r = await this.tx.lifeArea.updateMany({
      where: this.where({ id: before.id, revision: before.revision }),
      data: {
        title: input.title ?? before.title,
        position: input.position ?? before.position,
        status: input.status ?? before.status,
        revision: { increment: 1 },
      },
    });
    if (r.count !== 1) throw new ConflictException();
    return this.area(before.id);
  }
  async goal(id: string) {
    const r = await this.tx.goal.findFirst({ where: this.where({ id }) });
    if (!r) throw new NotFoundException();
    return goalView(r);
  }
  async goals(q: GoalQuery) {
    if (q.lifeAreaId) await this.area(q.lifeAreaId);
    if (q.parentGoalId) await this.goal(q.parentGoalId);
    const { cursor, limit, ...filters } = q,
      ctx = this.context('goals:', filters),
      p = this.pagination(ctx, { cursor, limit }),
      rows = await this.tx.goal.findMany({
        where: this.where({
          ...p.where,
          ...(q.status ? { status: q.status } : {}),
          ...(q.lifeAreaId ? { lifeAreaId: q.lifeAreaId } : {}),
          ...(q.parentGoalId ? { parentGoalId: q.parentGoalId } : {}),
          ...(q.horizon ? { horizon: q.horizon } : {}),
        }),
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: p.take,
      }),
      page = cursorPage(this.scope, ctx, p.limit, rows);
    return { ...page, items: page.items.map(goalView) };
  }
  async hierarchy() {
    const rows = await this.tx.goal.findMany({
      where: this.where({}),
      select: { id: true, parentGoalId: true },
      take: 10001,
    });
    if (rows.length > 10000) throw new BadRequestException();
    return rows;
  }
  async createGoal(input: c.GoalCreate, timezone: string) {
    return goalView(
      await this.tx.goal.create({
        data: {
          ...this.owner(),
          ...input,
          timezone,
          startDate: date(input.startDate),
          targetDate: date(input.targetDate),
        },
      }),
    );
  }
  async updateGoal(before: c.Goal, input: c.GoalPatch) {
    const next = c.GoalSchema.parse({ ...before, ...input });
    const {
      title,
      description,
      horizon,
      status,
      lifeAreaId,
      parentGoalId,
      progressMode,
      manualProgress,
      metricId,
    } = next;
    const r = await this.tx.goal.updateMany({
      where: this.where({ id: before.id, revision: before.revision }),
      data: {
        title,
        description,
        horizon,
        status,
        lifeAreaId,
        parentGoalId,
        progressMode,
        manualProgress,
        metricId,
        startDate: date(next.startDate),
        targetDate: date(next.targetDate),
        revision: { increment: 1 },
      },
    });
    if (r.count !== 1) throw new ConflictException();
    return this.goal(before.id);
  }
  async children(goalId: string) {
    const [ms, mt, ts, hs] = await Promise.all([
      this.tx.goalMilestone.findMany({
        where: this.where({ goalId }),
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        take: 101,
      }),
      this.tx.goalMetric.findMany({
        where: this.where({ goalId }),
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 101,
      }),
      this.tx.goalTaskLink.findMany({
        where: this.where({ goalId }),
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 101,
      }),
      this.tx.goalHabitLink.findMany({
        where: this.where({ goalId }),
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 101,
      }),
    ]);
    if ([ms, mt, ts, hs].some((a) => a.length > 100))
      throw new BadRequestException();
    const base = (r: {
      id: string;
      goalId: string;
      createdAt: Date;
      updatedAt: Date;
    }) => ({
      id: r.id,
      goalId: r.goalId,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    });
    return {
      milestones: ms.map((r) =>
        c.GoalMilestoneSchema.parse({
          ...base(r),
          title: r.title,
          position: r.position,
          targetDate: iso(r.targetDate),
          status: r.status,
          completedAt: r.completedAt?.toISOString() ?? null,
          contributes: r.contributes,
          weight: r.weight.toString(),
        }),
      ),
      metrics: mt.map((r) =>
        c.GoalMetricSchema.parse({
          ...base(r),
          title: r.title,
          unit: r.unit,
          baseline: r.baseline.toString(),
          target: r.target.toString(),
          current: r.current.toString(),
          weight: r.weight.toString(),
          contributes: r.contributes,
        }),
      ),
      tasks: ts.map((r) =>
        c.GoalTaskLinkSchema.parse({
          ...base(r),
          taskId: r.taskId,
          selectedSourceRevision: r.selectedSourceRevision,
          contributes: r.contributes,
          weight: r.weight.toString(),
        }),
      ),
      habits: hs.map((r) =>
        c.GoalHabitLinkSchema.parse({
          ...base(r),
          habitId: r.habitId,
          selectedSourceRevision: r.selectedSourceRevision,
          from: iso(r.from),
          to: iso(r.to),
          contributes: r.contributes,
          weight: r.weight.toString(),
        }),
      ),
    };
  }
  async writeChild(goalId: string, kind: Kind, data: object, childId?: string) {
    const owner = { spaceId: this.scope.spaceId, goalId },
      where = this.where({ ...(childId ? { id: childId } : {}), goalId });
    switch (kind) {
      case 'milestones': {
        const v = c.GoalMilestoneCreateSchema.parse(data);
        const values = {
          ...v,
          targetDate: date(v.targetDate),
          completedAt: v.status === 'COMPLETED' ? new Date() : null,
        };
        if (childId) {
          const prior = await this.tx.goalMilestone.findFirst({ where });
          if (!prior) throw new NotFoundException();
          if (prior.status === 'COMPLETED' && v.status === 'COMPLETED')
            values.completedAt = prior.completedAt;
          await this.tx.goalMilestone.updateMany({ where, data: values });
        } else
          await this.tx.goalMilestone.create({ data: { ...owner, ...values } });
        break;
      }
      case 'metrics': {
        const v = c.GoalMetricCreateSchema.parse(data);
        if (childId) await this.tx.goalMetric.updateMany({ where, data: v });
        else await this.tx.goalMetric.create({ data: { ...owner, ...v } });
        break;
      }
      case 'tasks': {
        const v = c.GoalTaskLinkCreateSchema.parse(data),
          { sourceRevision, ...rest } = v;
        const values = { ...rest, selectedSourceRevision: sourceRevision };
        if (childId)
          await this.tx.goalTaskLink.updateMany({ where, data: values });
        else
          await this.tx.goalTaskLink.create({ data: { ...owner, ...values } });
        break;
      }
      case 'habits': {
        const v = c.GoalHabitLinkCreateSchema.parse(data),
          { sourceRevision, from, to, ...rest } = v;
        const values = {
          ...rest,
          selectedSourceRevision: sourceRevision,
          from: date(from)!,
          to: date(to)!,
        };
        if (childId)
          await this.tx.goalHabitLink.updateMany({ where, data: values });
        else
          await this.tx.goalHabitLink.create({ data: { ...owner, ...values } });
        break;
      }
    }
  }
  async removeChild(goalId: string, kind: Kind, childId: string) {
    const where = this.where({ goalId, id: childId });
    switch (kind) {
      case 'milestones':
        await this.tx.goalMilestone.deleteMany({ where });
        break;
      case 'metrics':
        await this.tx.goalMetric.deleteMany({ where });
        break;
      case 'tasks':
        await this.tx.goalTaskLink.deleteMany({ where });
        break;
      case 'habits':
        await this.tx.goalHabitLink.deleteMany({ where });
        break;
    }
  }
  async task(id: string) {
    const rows = await this.tasks.describe(this.tx, this.scope, [id]);
    if (!rows[0]) throw new NotFoundException();
    return rows[0];
  }
  habit(id: string, range: { from: string; to: string }, now: Date) {
    return this.habits.describe(this.tx, this.scope, id, range, now);
  }
  async review(
    goalId: string,
    kind: 'SNAPSHOT' | 'REVIEW',
    reflection: string | null,
    snapshot: c.GoalProgress,
  ) {
    return reviewView(
      await this.tx.goalReview.create({
        data: {
          spaceId: this.scope.spaceId,
          goalId,
          kind,
          reflection,
          snapshot: c.GoalProgressSchema.parse(
            snapshot,
          ) as Prisma.InputJsonValue,
        },
      }),
    );
  }
  async reviews(goalId: string, q: ReviewQuery) {
    const ctx = this.context('goal-reviews:', [goalId, q.kind ?? null]),
      p = this.pagination(ctx, q),
      rows = await this.tx.goalReview.findMany({
        where: this.where({
          goalId,
          ...(q.kind ? { kind: q.kind } : {}),
          ...p.where,
        }),
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: p.take,
      }),
      page = cursorPage(this.scope, ctx, p.limit, rows);
    return { ...page, items: page.items.map(reviewView) };
  }
  async audit(action: Parameters<GoalsTransaction['audit']>[0], id: string) {
    await writeAudit(this.tx, {
      action,
      outcome: 'SUCCEEDED',
      actorUserId: this.scope.actor.userId,
      resourceId: id,
      requestId: this.scope.actor.requestId,
      correlationId: this.scope.actor.correlationId,
    });
  }
  async event(goalId: string) {
    await appendOutbox(this.tx, this.scope, {
      type: 'goal.progress_changed',
      version: 1,
      aggregateId: goalId,
      payload: {},
    });
  }
}
@Injectable()
export class GoalsRepository implements GoalsPort {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(PlanningTasks) private readonly tasks: PlanningTasks,
    @Inject(GoalHabits) private readonly habits: GoalHabits,
    @Inject(PlanningPreferences) private readonly account: PlanningPreferences,
  ) {}
  private async store(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    // Always Task -> Habit -> Goals. Source writers never acquire the Goals lock.
    await this.tasks.lock(tx, scope);
    await this.habits.lock(tx, scope);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`goals:${scope.spaceId}`},0))::text`;
    return new Store(tx, scope, this.tasks, this.habits, this.account);
  }
  run<T>(scope: AuthorizedSpace, work: (tx: GoalsTransaction) => Promise<T>) {
    return this.db.client.$transaction(
      async (tx) => work(await this.store(tx, scope)),
      { timeout: 30000 },
    );
  }
  async once<T extends { id: string }>(
    scope: AuthorizedSpace,
    operation: string,
    key: string,
    request: unknown,
    work: (tx: GoalsTransaction) => Promise<T>,
  ) {
    const r = await idempotent(
      this.db.client,
      scope,
      operation,
      key,
      request,
      async (tx) => {
        const result = await work(await this.store(tx, scope));
        return {
          resultId: result.id,
          statusCode: 201,
          result: JSON.parse(JSON.stringify(result)) as NonNullable<
            MutationReceipt['result']
          >,
        };
      },
    );
    return r.result as T;
  }
}
