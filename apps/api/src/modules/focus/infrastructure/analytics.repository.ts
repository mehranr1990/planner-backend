import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { AnalyticsFocus } from '../public/analytics.js';
import { PlanningTasks, ProductivityTasks } from '../../tasks/public/index.js';
import { PlanningPreferences } from '../../account/public/index.js';
import { Store } from './focus.repository.js';
import { clip, unionMilliseconds } from '../domain/intervals.js';
import type { Interval } from '../domain/intervals.js';
import { dayBoundary } from '../domain/dates.js';
import { workSpans } from '../domain/focus.js';
import type { InsightReadModel } from '@mehran/api-contracts';
@Injectable()
export class AnalyticsFocusRepository extends AnalyticsFocus {
  constructor(
    @Inject(PlanningTasks) private readonly tasks: PlanningTasks,
    @Inject(ProductivityTasks) private readonly stats: ProductivityTasks,
    @Inject(PlanningPreferences) private readonly account: PlanningPreferences,
  ) {
    super();
  }
  async read(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    r: Parameters<AnalyticsFocus['read']>[2],
    now: Date,
  ): Promise<InsightReadModel> {
    const store = new Store(tx, scope, this.tasks, this.stats, this.account),
      data = await store.range(
        new Date(dayBoundary(r.from, r.timezone)),
        new Date(dayBoundary(r.to, r.timezone)),
      ),
      reserved = await store.reserved();
    const live = reserved
      ? workSpans(await store.versions(reserved.id), now)
      : [];
    return {
      metrics: (from, to) => {
        const range = {
          start: dayBoundary(from, r.timezone),
          end: dayBoundary(to, r.timezone),
        };
        const rows = data.entries
          .map((e) => ({
            kind: e.kind,
            span: clip(
              { start: Date.parse(e.startAt), end: Date.parse(e.endAt) },
              range,
            ),
          }))
          .filter(
            (e): e is { kind: 'MANUAL' | 'TRACKED'; span: Interval } =>
              e.span !== null,
          );
        const total = rows.reduce((n, e) => n + e.span.end - e.span.start, 0),
          distinct = unionMilliseconds(rows.map((e) => e.span));
        const metric = (id: string, value: number) => ({
          id,
          sourceType: 'TIME_ENTRY' as const,
          value: String(value),
          definition:
            'CURRENT_NONVOID_CLIPPED_ENTRIES_DISTINCT_IS_INTERVAL_UNION',
        });
        return [
          metric('time.recorded_ms', total),
          metric('time.distinct_work_ms', distinct),
          metric('time.overlap_ms', total - distinct),
          metric(
            'time.manual_ms',
            rows
              .filter((e) => e.kind === 'MANUAL')
              .reduce((n, e) => n + e.span.end - e.span.start, 0),
          ),
          metric(
            'time.tracked_ms',
            rows
              .filter((e) => e.kind === 'TRACKED')
              .reduce((n, e) => n + e.span.end - e.span.start, 0),
          ),
          {
            id: 'time.uncommitted_ms',
            sourceType: 'FOCUS_SESSION',
            value: String(
              unionMilliseconds(
                live
                  .map((i) => clip(i, range))
                  .filter((i): i is Interval => i !== null),
              ),
            ),
            definition: 'LIVE_WORK_SEPARATE_FROM_RECORDED_ENTRIES',
          },
        ];
      },
    };
  }
}
