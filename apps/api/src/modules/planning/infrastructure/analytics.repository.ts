import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { scopedWhere } from '../../../platform/database/scoped-where.js';
import { AnalyticsPlanning } from '../public/analytics.js';
import { PlanningTasks } from '../../tasks/public/index.js';
import type { InsightReadModel } from '@mehran/api-contracts';
@Injectable()
export class AnalyticsPlanningRepository extends AnalyticsPlanning {
  constructor(@Inject(PlanningTasks) private readonly tasks: PlanningTasks) {
    super();
  }
  async read(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    r: Parameters<AnalyticsPlanning['read']>[2],
  ): Promise<InsightReadModel> {
    const rows = await tx.dailyPlanItem.findMany({
      where: scopedWhere(scope, {
        localDate: { gte: new Date(r.from), lt: new Date(r.to) },
      }),
      select: {
        localDate: true,
        taskId: true,
        plannedMinutes: true,
        plan: { select: { timezone: true } },
      },
      take: 10001,
    });
    if (rows.length > 10000) throw new BadRequestException();
    const tasks = new Map(
      (
        await this.tasks.describe(tx, scope, [
          ...new Set(rows.map((i) => i.taskId)),
        ])
      ).map((t) => [t.id, t]),
    );
    return {
      metrics: (from, to) => {
        const selected = rows.filter((i) => {
          const d = i.localDate.toISOString().slice(0, 10);
          return d >= from && d < to && !tasks.get(i.taskId)?.isMaster;
        });
        const completed = selected.filter((i) => {
          const t = tasks.get(i.taskId);
          return (
            t?.status === 'DONE' &&
            !t.deleted &&
            (!t.occurrenceState || t.occurrenceState === 'DONE')
          );
        }).length;
        const count = (id: string, value: number) => ({
          id,
          sourceType: 'DAILY_PLAN' as const,
          value: String(value),
          definition: 'EXPLICIT_DAILY_SELECTIONS_ORIGINAL_LOCAL_DATE_CONTEXT',
        });
        return [
          count('planning.selections', selected.length),
          count(
            'planning.distinct_tasks',
            new Set(selected.map((i) => i.taskId)).size,
          ),
          count(
            'planning.planned_minutes',
            selected.reduce((n, i) => n + (i.plannedMinutes ?? 0), 0),
          ),
          count(
            'planning.unknown_allocations',
            selected.filter((i) => i.plannedMinutes === null).length,
          ),
          {
            id: 'planning.completion_rate',
            sourceType: 'DAILY_PLAN',
            value: null,
            numerator: completed,
            denominator: selected.length,
            definition:
              'DONE_ELIGIBLE_SELECTIONS_OVER_ALL_NONMASTER_SELECTIONS',
          },
        ];
      },
    };
  }
}
