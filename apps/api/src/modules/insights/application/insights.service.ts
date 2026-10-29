import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import * as c from '@mehran/api-contracts';
import { DatabaseService } from '../../../platform/database/database.service.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { PlanningPreferences } from '../../account/public/index.js';
import { AnalyticsTasks } from '../../tasks/public/index.js';
import { AnalyticsPlanning } from '../../planning/public/index.js';
import { AnalyticsHabits } from '../../habits/public/index.js';
import { AnalyticsGoals } from '../../goals/public/index.js';
import { AnalyticsFocus } from '../../focus/public/index.js';
import { AnalyticsFinance } from '../../finance/public/index.js';
import { addDates, rounded, comparison, buckets } from '../domain/metrics.js';
@Injectable()
export class InsightsService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(PlanningPreferences) private readonly account: PlanningPreferences,
    @Inject(AnalyticsTasks) private readonly tasks: AnalyticsTasks,
    @Inject(AnalyticsPlanning) private readonly planning: AnalyticsPlanning,
    @Inject(AnalyticsHabits) private readonly habits: AnalyticsHabits,
    @Inject(AnalyticsGoals) private readonly goals: AnalyticsGoals,
    @Inject(AnalyticsFocus) private readonly focus: AnalyticsFocus,
    @Inject(AnalyticsFinance) private readonly finance: AnalyticsFinance,
  ) {}
  query(scope: AuthorizedSpace, family: c.InsightFamily, q: c.InsightQuery) {
    return this.db.client.$transaction(
      async (tx) => {
        const context = await this.account.read(tx, scope),
          timezone = q.timezone ?? context.timezone;
        const clock = await tx.$queryRaw<
          Array<{ now: Date }>
        >`SELECT transaction_timestamp() AS now`;
        const now = clock[0]!.now;
        const length = (Date.parse(q.to) - Date.parse(q.from)) / 86400000,
          previousFrom = addDates(q.from, -length),
          range = { from: previousFrom, to: q.to, timezone, cohort: q.cohort };
        const sources =
          family === 'overview'
            ? [
                this.tasks,
                this.planning,
                this.habits,
                this.goals,
                this.focus,
                ...(q.includeFinance === 'true' ? [this.finance] : []),
              ]
            : family === 'tasks'
              ? [this.tasks, this.planning]
              : [
                  family === 'habits'
                    ? this.habits
                    : family === 'goals'
                      ? this.goals
                      : family === 'time'
                        ? this.focus
                        : this.finance,
                ];
        const models: c.InsightReadModel[] = [];
        for (const source of sources)
          models.push(await source.read(tx, scope, range, now));
        const metrics = (from: string, to: string) =>
          models
            .flatMap((model) => model.metrics(from, to))
            .map((m) => {
              const numerator = m.numerator ?? null,
                denominator = m.denominator ?? null;
              return c.InsightMetricSchema.parse({
                sourceId: null,
                currency: null,
                sourceTimezone: null,
                numerator: null,
                denominator: null,
                reason: null,
                ...m,
                ...(denominator !== null && numerator !== null
                  ? {
                      value:
                        denominator === 0
                          ? null
                          : rounded(
                              BigInt(numerator) * 100n,
                              BigInt(denominator),
                            ),
                      reason: denominator === 0 ? 'NO_DENOMINATOR' : null,
                    }
                  : {}),
              });
            });
        const current = metrics(q.from, q.to),
          previous = metrics(previousFrom, q.from),
          key = (m: c.InsightMetric) =>
            [m.id, m.sourceId, m.currency].join(':');
        // An absent currency bucket means no posting, not a missing observation.
        for (const m of [...current, ...previous]) {
          if (!m.currency) continue;
          for (const period of [current, previous])
            if (!period.some((p) => key(p) === key(m)))
              period.push({ ...m, value: '0' });
        }
        const periodBuckets = buckets(
          q.from,
          q.to,
          q.grouping,
          context.firstDayOfWeek,
        );
        if (current.length * periodBuckets.length > 100000)
          throw new BadRequestException({
            code: 'VALIDATION_ERROR',
            details: [{ path: 'range', code: 'RANGE_TOO_DENSE' }],
          });
        const comparisons = current
          .filter(
            (m) =>
              !m.id.startsWith('goals.status.') &&
              m.id !== 'goals.current_progress' &&
              m.id !== 'time.uncommitted_ms',
          )
          .map((m) => ({
            metricId: m.id,
            sourceId: m.sourceId,
            currency: m.currency,
            ...comparison(
              m.value,
              previous.find((p) => key(p) === key(m))?.value ??
                (m.currency ? '0' : null),
            ),
          }));
        const explanations = comparisons
          .filter(
            (x) =>
              [
                'tasks.completion_rate',
                'habits.consistency',
                'time.distinct_work_ms',
              ].includes(x.metricId) &&
              x.reason === null &&
              x.absoluteChange !== null,
          )
          .map((x) => ({
            metricId: x.metricId,
            direction: x.absoluteChange!.startsWith('-')
              ? 'DECREASED'
              : Number(x.absoluteChange) === 0
                ? 'UNCHANGED'
                : 'INCREASED',
            from: q.from,
            to: q.to,
            ruleVersion: 1,
          }));
        return c.InsightResponseSchema.parse({
          ruleVersion: 1,
          family,
          computedAt: now!.toISOString(),
          timezone,
          firstDayOfWeek: context.firstDayOfWeek,
          grouping: q.grouping,
          cohort: q.cohort,
          freshness: 'CURRENT_SOURCE_STATE_CONSISTENT_SNAPSHOT',
          current: {
            from: q.from,
            to: q.to,
            metrics: current,
            buckets: periodBuckets.map((b) => ({
              ...b,
              metrics: metrics(b.from, b.to),
            })),
          },
          previous: { from: previousFrom, to: q.from, metrics: previous },
          comparisons,
          explanations,
        });
      },
      { isolationLevel: 'RepeatableRead', timeout: 30000 },
    );
  }
}
