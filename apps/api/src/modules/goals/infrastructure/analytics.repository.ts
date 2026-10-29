import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { AnalyticsGoals } from '../public/analytics.js';
import { PlanningPreferences } from '../../account/public/index.js';
import { PlanningTasks } from '../../tasks/public/index.js';
import { GoalHabits } from '../../habits/public/index.js';
import { GoalsService } from '../application/goals.service.js';
import { Store } from './goals.repository.js';
import { calculate } from '../domain/progress.js';
import { GoalProgressSchema } from '@mehran/api-contracts';
import type { InsightReadModel, GoalProgress } from '@mehran/api-contracts';
const local = (d: Date, z: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: z,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    calendar: 'gregory',
    numberingSystem: 'latn',
  }).format(d);
@Injectable()
export class AnalyticsGoalsRepository extends AnalyticsGoals {
  constructor(
    @Inject(PlanningPreferences) private readonly account: PlanningPreferences,
    @Inject(PlanningTasks) private readonly tasks: PlanningTasks,
    @Inject(GoalHabits) private readonly habits: GoalHabits,
    @Inject(GoalsService) private readonly service: GoalsService,
  ) {
    super();
  }
  async read(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    r: Parameters<AnalyticsGoals['read']>[2],
    now: Date,
  ): Promise<InsightReadModel> {
    const rows = await tx.goal.findMany({
      where: { spaceId: scope.spaceId },
      select: {
        id: true,
        status: true,
        timezone: true,
        revision: true,
        progressMode: true,
        manualProgress: true,
      },
      take: 10001,
    });
    const reviews = await tx.goalReview.findMany({
      where: {
        spaceId: scope.spaceId,
        createdAt: {
          gte: new Date(Date.parse(r.from) - 2 * 86400000),
          lt: new Date(Date.parse(r.to) + 2 * 86400000),
        },
      },
      select: { goalId: true, createdAt: true, snapshot: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 10001,
    });
    const counts = await tx.$queryRaw<
      Array<{ count: number }>
    >`SELECT count(*)::int AS count FROM (SELECT id FROM (SELECT id FROM "GoalMilestone" WHERE "spaceId"=${scope.spaceId}::uuid UNION ALL SELECT id FROM "GoalMetric" WHERE "spaceId"=${scope.spaceId}::uuid UNION ALL SELECT id FROM "GoalTaskLink" WHERE "spaceId"=${scope.spaceId}::uuid UNION ALL SELECT id FROM "GoalHabitLink" WHERE "spaceId"=${scope.spaceId}::uuid) sources LIMIT 10001) bounded`;
    let evidence = rows.length + reviews.length + counts[0]!.count;
    if (evidence > 10000) throw new BadRequestException();
    const store = new Store(tx, scope, this.tasks, this.habits, this.account),
      current: Array<{ row: (typeof rows)[number]; progress: GoalProgress }> =
        [];
    for (const row of rows) {
      const progress =
        row.progressMode === 'MANUAL'
          ? GoalProgressSchema.parse({
              ruleVersion: 1,
              goalId: row.id,
              goalRevision: row.revision,
              mode: 'MANUAL',
              timezone: row.timezone,
              computedAt: now.toISOString(),
              ...calculate('MANUAL', row.manualProgress.toString(), []),
              sources: [],
            })
          : await this.service.compute(store, await store.goal(row.id), now);
      evidence += progress.sources.reduce(
        (n, s) =>
          n +
          s.entries.length +
          s.scheduleIds.length +
          (s.kind === 'TASK' ? 1 : 0),
        0,
      );
      if (evidence > 10000) throw new BadRequestException();
      current.push({ row, progress });
    }
    const observed = new Map<
      string,
      Array<{ localDate: string; percentage: string }>
    >();
    for (const review of reviews) {
      const values = observed.get(review.goalId) ?? [];
      values.push({
        localDate: local(review.createdAt, r.timezone),
        percentage: GoalProgressSchema.parse(review.snapshot).percentage,
      });
      observed.set(review.goalId, values);
    }
    return {
      metrics: (from, to) => [
        ...['PLANNED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ABANDONED'].map(
          (status) => ({
            id: 'goals.status.' + status.toLowerCase(),
            sourceType: 'GOAL' as const,
            value: String(rows.filter((g) => g.status === status).length),
            definition: 'CURRENT_STATUS_NOT_HISTORICAL_AS_OF',
          }),
        ),
        ...current.flatMap(({ row, progress }) => {
          const review = observed
            .get(row.id)
            ?.find((v) => v.localDate >= from && v.localDate < to);
          return [
            {
              id: 'goals.current_progress',
              sourceType: 'GOAL' as const,
              sourceId: row.id,
              sourceTimezone: row.timezone,
              value: progress.percentage,
              definition: 'CURRENT_CANONICAL_PROGRESS_NOT_PERIOD_HISTORY',
            },
            {
              id: 'goals.observed_progress',
              sourceType: 'GOAL_REVIEW' as const,
              sourceId: row.id,
              sourceTimezone: row.timezone,
              value: review ? review.percentage : null,
              reason: review ? null : ('NO_OBSERVATION' as const),
              definition: 'LATEST_ACTUAL_IMMUTABLE_SNAPSHOT_IN_PERIOD',
            },
          ];
        }),
      ],
    };
  }
}
