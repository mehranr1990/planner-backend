import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import { DatabaseService } from '../../../platform/database/database.service.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { AnalyticsFocus } from '../../focus/public/analytics.js';
import { AnalyticsHabits } from '../../habits/public/index.js';
import { PersonalJournal } from '../../journal/public/index.js';
import { SharedTaskWork } from '../../tasks/public/index.js';
import { MessagingAuthority } from '../../spaces/public/index.js';
import { wallInstant } from '../../calendar/public/index.js';
import { ProductivityTasks } from '../../tasks/public/index.js';
import { estimateAccuracy } from '../domain/estimates.js';
type Query = z.infer<typeof c.InsightPatternQuerySchema>;
type Context = 'personal' | 'projects' | 'teams' | 'companies' | 'other';
const contexts: Context[] = [
  'personal',
  'projects',
  'teams',
  'companies',
  'other',
];
const zero = () => ({
  personal: 0,
  projects: 0,
  teams: 0,
  companies: 0,
  other: 0,
});
const addDays = (d: string, n: number) =>
  new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000)
    .toISOString()
    .slice(0, 10);
const span = (from: string, to: string) =>
  Math.round(
    (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) /
      86400000,
  ) + 1;
const mean = (v: number[]) =>
  v.length
    ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100
    : null;
/**
 * B4 (owner-approved): Personal Insights patterns from recorded data only.
 * Formulas are declared in the contract; below each threshold the response is
 * `collecting`; patterns without source data are `unavailable`. No prediction.
 */
@Injectable()
export class InsightPatternsService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AnalyticsFocus) private readonly focus: AnalyticsFocus,
    @Inject(AnalyticsHabits) private readonly habits: AnalyticsHabits,
    @Inject(PersonalJournal) private readonly journal: PersonalJournal,
    @Inject(SharedTaskWork) private readonly work: SharedTaskWork,
    @Inject(MessagingAuthority) private readonly authority: MessagingAuthority,
    @Inject(ProductivityTasks) private readonly tasks: ProductivityTasks,
  ) {}
  private local(at: Date, timezone: string) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    }).formatToParts(at);
    const get = (t: string) => parts.find((p) => p.type === t)!.value;
    return {
      day: `${get('year')}-${get('month')}-${get('day')}`,
      hour: Number(get('hour')),
      weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
        get('weekday'),
      ),
    };
  }
  /** Splits an interval into local-hour slices (minutes), so cross-hour entries are attributed exactly. */
  private slices(start: Date, end: Date, timezone: string) {
    const out: {
      day: string;
      hour: number;
      weekday: number;
      minutes: number;
    }[] = [];
    let at = start.getTime();
    while (at < end.getTime()) {
      const next = Math.min(
        end.getTime(),
        Math.floor(at / 3600000) * 3600000 + 3600000,
      );
      const l = this.local(new Date(at), timezone);
      out.push({ ...l, minutes: (next - at) / 60000 });
      at = next;
    }
    return out;
  }
  private bounds(q: Query) {
    const start = wallInstant(q.from + 'T00:00', q.timezone),
      end = wallInstant(addDays(q.to, 1) + 'T00:00', q.timezone);
    if (!start || !end || q.to < q.from || span(q.from, q.to) > 366)
      throw new BadRequestException({ code: 'INVALID_RANGE' });
    return { start, end };
  }
  private async focusMinutesByDay(
    tx: Parameters<AnalyticsFocus['entries']>[0],
    scope: AuthorizedSpace,
    q: Query,
  ) {
    const { start, end } = this.bounds(q);
    const entries = await this.focus.entries(tx, scope, start, end);
    const byDay = new Map<string, number>();
    for (const e of entries)
      for (const s of this.slices(
        new Date(Math.max(Date.parse(e.startAt), start.getTime())),
        new Date(Math.min(Date.parse(e.endAt), end.getTime())),
        q.timezone,
      ))
        byDay.set(s.day, (byDay.get(s.day) ?? 0) + s.minutes);
    return { entries, byDay };
  }
  async pattern(scope: AuthorizedSpace, actor: RequestActor, query: Query) {
    const q = c.InsightPatternQuerySchema.parse(query);
    const { start, end } = this.bounds(q);
    return this.db.client.$transaction(async (tx) => {
      await scope.fence(tx);
      if (q.id === 'estimates') {
        // Personal tasks only (scopeId null); actual time is the caller's own recorded entries.
        const done = await this.tasks.completedEstimates(tx, scope, start, end);
        const actual = await this.focus.taskMinutes(
          tx,
          scope,
          done.map((t) => t.taskId),
        );
        return c.InsightPatternResultSchema.parse(
          estimateAccuracy(
            done.map((t) => ({
              ...t,
              actualMinutes: actual.get(t.taskId) ?? 0,
            })),
          ),
        );
      }
      if (q.id === 'focus') {
        const entries = await this.focus.entries(tx, scope, start, end);
        if (entries.length < 5)
          return c.InsightPatternResultSchema.parse({
            status: 'collecting',
            have: entries.length,
            need: 5,
          });
        const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
        for (const e of entries)
          for (const s of this.slices(
            new Date(Math.max(Date.parse(e.startAt), start.getTime())),
            new Date(Math.min(Date.parse(e.endAt), end.getTime())),
            q.timezone,
          ))
            grid[s.weekday]![s.hour]! += s.minutes;
        const byHour = Array.from({ length: 24 }, (_, h) =>
          grid.reduce((n, r) => n + r[h]!, 0),
        );
        const total = byHour.reduce((a, b) => a + b, 0);
        let best = -1,
          bestMinutes = 0;
        for (let h = 0; h < 23; h++)
          if (byHour[h]! + byHour[h + 1]! > bestMinutes) {
            best = h;
            bestMinutes = byHour[h]! + byHour[h + 1]!;
          }
        return c.InsightPatternResultSchema.parse({
          status: 'ready',
          pattern: {
            id: 'focus',
            minutesByWeekdayHour: grid.map((r) => r.map((v) => Math.round(v))),
            totalMinutes: Math.round(total),
            entries: entries.length,
            trackedEntries: entries.filter((e) => e.kind === 'TRACKED').length,
            bestWindow: best >= 0 ? [best, best + 2] : null,
            bestShare:
              best >= 0 && total
                ? Math.round((bestMinutes * 10000) / total)
                : null,
          },
        });
      }
      if (q.id === 'time') {
        const actors = await this.authority.actors(actor);
        const kinds = new Map<string, Context>();
        const tally = async (from: Date, to: Date) => {
          const days = Array.from({ length: 7 }, (_, weekday) => ({
            weekday,
            minutes: zero(),
          }));
          const totals = zero();
          const add = (context: Context, a: Date, b: Date) => {
            for (const s of this.slices(a, b, q.timezone)) {
              days[s.weekday]!.minutes[context] += s.minutes;
              totals[context] += s.minutes;
            }
          };
          for (const e of await this.focus.entries(tx, scope, from, to))
            add(
              'personal',
              new Date(Math.max(Date.parse(e.startAt), from.getTime())),
              new Date(Math.min(Date.parse(e.endAt), to.getTime())),
            );
          for (const l of await this.work.actorEffort(tx, actors, from, to)) {
            if (!kinds.has(l.scopeId)) {
              const scopeKind = await this.authority
                .scope(tx, l.scopeId)
                .then((v) => v.kind)
                .catch(() => null);
              kinds.set(
                l.scopeId,
                scopeKind === 'PROJECT'
                  ? 'projects'
                  : scopeKind === 'TEAM'
                    ? 'teams'
                    : scopeKind === 'COMPANY'
                      ? 'companies'
                      : 'other',
              );
            }
            add(
              kinds.get(l.scopeId)!,
              new Date(Math.max(l.startedAt.getTime(), from.getTime())),
              new Date(Math.min(l.endedAt.getTime(), to.getTime())),
            );
          }
          const round = (m: ReturnType<typeof zero>) =>
            Object.fromEntries(
              contexts.map((k) => [k, Math.round(m[k])]),
            ) as ReturnType<typeof zero>;
          return {
            days: days.map((d) => ({ ...d, minutes: round(d.minutes) })),
            totals: round(totals),
          };
        };
        const current = await tally(start, end);
        const length = end.getTime() - start.getTime();
        const previous = await tally(new Date(start.getTime() - length), start);
        const prevTotal = contexts.reduce((n, k) => n + previous.totals[k], 0);
        const total = contexts.reduce((n, k) => n + current.totals[k], 0);
        if (total === 0)
          return c.InsightPatternResultSchema.parse({
            status: 'collecting',
            have: 0,
            need: 1,
          });
        return c.InsightPatternResultSchema.parse({
          status: 'ready',
          pattern: {
            id: 'time',
            days: current.days,
            totals: current.totals,
            previousShare: prevTotal
              ? Object.fromEntries(
                  contexts.map((k) => [
                    k,
                    Math.round((previous.totals[k] * 10000) / prevTotal),
                  ]),
                )
              : null,
          },
        });
      }
      const moods = await this.journal.moods(tx, scope, q.from, q.to);
      const moodByDay = new Map(moods.map((m) => [m.localDate, m]));
      if (q.id === 'signals') {
        if (moodByDay.size < 7)
          return c.InsightPatternResultSchema.parse({
            status: 'collecting',
            have: moodByDay.size,
            need: 7,
          });
        const { byDay } = await this.focusMinutesByDay(tx, scope, q);
        const days = [];
        for (let d = q.from; d <= q.to; d = addDays(d, 1))
          days.push({
            day: d,
            mood: moodByDay.get(d)?.mood ?? null,
            energy: moodByDay.get(d)?.energy ?? null,
            focusMinutes: Math.round(byDay.get(d) ?? 0),
          });
        const withMood = days.filter((d) => d.mood !== null);
        return c.InsightPatternResultSchema.parse({
          status: 'ready',
          pattern: {
            id: 'signals',
            days,
            moodWithFocus: mean(
              withMood.filter((d) => d.focusMinutes >= 120).map((d) => d.mood!),
            ),
            moodWithoutFocus: mean(
              withMood.filter((d) => d.focusMinutes < 120).map((d) => d.mood!),
            ),
          },
        });
      }
      // habits
      const done = await this.habits.entries(tx, scope, q.from, q.to);
      const habits = new Map<string, { title: string; days: Set<string> }>();
      for (const e of done) {
        const h = habits.get(e.habitId) ?? {
          title: e.title,
          days: new Set<string>(),
        };
        h.days.add(e.localDate);
        habits.set(e.habitId, h);
      }
      if (moodByDay.size < 10)
        return c.InsightPatternResultSchema.parse({
          status: 'collecting',
          have: moodByDay.size,
          need: 10,
        });
      const rows = [...habits.entries()].map(([habitId, h]) => {
        const doneMood = [...moodByDay.values()]
            .filter((m) => h.days.has(m.localDate))
            .map((m) => m.mood),
          notDoneMood = [...moodByDay.values()]
            .filter((m) => !h.days.has(m.localDate))
            .map((m) => m.mood);
        return {
          habitId,
          title: h.title,
          doneMood: mean(doneMood),
          notDoneMood: mean(notDoneMood),
          days: doneMood.length,
        };
      });
      return c.InsightPatternResultSchema.parse({
        status: 'ready',
        pattern: { id: 'habits', rows },
      });
    });
  }
}
