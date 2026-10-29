import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { AnalyticsHabits } from '../public/analytics.js';
import { PlanningPreferences } from '../../account/public/index.js';
import { Store } from './habits.repository.js';
import { currentSchedule, localDate, stats } from '../domain/habits.js';
import type { InsightReadModel } from '@mehran/api-contracts';
import type { Schedule, Entry } from '../domain/habits.js';
@Injectable()
export class AnalyticsHabitsRepository extends AnalyticsHabits {
  constructor(
    @Inject(PlanningPreferences) private readonly account: PlanningPreferences,
  ) {
    super();
  }
  async read(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    r: Parameters<AnalyticsHabits['read']>[2],
    now: Date,
  ): Promise<InsightReadModel> {
    const rows = await tx.habit.findMany({
      where: { spaceId: scope.spaceId },
      select: { id: true },
      take: 10001,
    });
    const span = (Date.parse(r.to) - Date.parse(r.from)) / 86400000;
    if (rows.length * span > 100000) throw new BadRequestException();
    const store = new Store(tx, scope, this.account);
    const schedules = await tx.habitSchedule.count({
      where: { spaceId: scope.spaceId },
    });
    if (schedules > 10000) throw new BadRequestException();
    const entries = await store.entriesRange(
      rows.map((h) => h.id),
      r.from,
      r.to,
    );
    if (rows.length + schedules + entries.length > 10000)
      throw new BadRequestException();
    const models: Array<{
      id: string;
      versions: Schedule[];
      timezone: string;
      asOf: string;
      entries: Entry[];
    }> = [];
    for (const row of rows) {
      const versions = await store.schedules(row.id);
      const current = currentSchedule(versions, now) ?? versions.at(-1);
      if (!current) continue;
      models.push({
        id: row.id,
        versions,
        timezone: current.timezone,
        asOf: localDate(now, current.timezone),
        entries: entries.filter((e) => e.habitId === row.id),
      });
    }
    return {
      metrics: (from, to) => {
        const results = models.map((m) => ({
          ...m,
          result: stats(m.id, m.versions, m.entries, from, to, m.asOf),
        }));
        const sum = (key: 'completed' | 'skipped' | 'missed' | 'pending') =>
          results.reduce((n, m) => n + m.result[key], 0);
        return [
          ...(['completed', 'skipped', 'missed', 'pending'] as const).map(
            (key) => ({
              id: 'habits.' + key,
              sourceType: 'HABIT' as const,
              value: String(sum(key)),
              definition: 'CANONICAL_DUE_DAY_OUTCOMES_SAVED_HABIT_LOCAL_DATES',
            }),
          ),
          {
            id: 'habits.consistency',
            sourceType: 'HABIT',
            value: null,
            numerator: sum('completed'),
            denominator: sum('completed') + sum('missed') + sum('pending'),
            definition: 'SUM_ACHIEVED_OVER_NONNEUTRAL_DUE_DAYS',
          },
          ...results.flatMap((m) => [
            {
              id: 'habits.current_streak',
              sourceType: 'HABIT' as const,
              sourceId: m.id,
              sourceTimezone: m.timezone,
              value: String(m.result.currentStreak),
              definition: 'RANGE_SCOPED_NEUTRAL_SKIP_REST_PAUSE',
            },
            {
              id: 'habits.longest_streak',
              sourceType: 'HABIT' as const,
              sourceId: m.id,
              sourceTimezone: m.timezone,
              value: String(m.result.longestStreak),
              definition: 'RANGE_SCOPED_NEUTRAL_SKIP_REST_PAUSE',
            },
          ]),
        ];
      },
    };
  }
}
