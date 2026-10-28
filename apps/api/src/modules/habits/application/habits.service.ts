import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import type * as c from '@mehran/api-contracts';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { HABITS_REPOSITORY } from './habits.port.js';
import type {
  HabitsPort,
  HabitsTransaction,
  PageQuery,
} from './habits.port.js';
import {
  localDate,
  currentSchedule,
  scheduleAt,
  due,
  units,
  decimal,
  sum,
  stats,
  addDays,
} from '../domain/habits.js';
import type { Habit, Schedule, Entry, Routine } from '../domain/habits.js';
function invalid(code: string): never {
  throw new BadRequestException({
    code: 'VALIDATION_ERROR',
    details: [{ path: 'habit', code }],
  });
}
@Injectable()
export class HabitsService {
  constructor(@Inject(HABITS_REPOSITORY) private readonly repo: HabitsPort) {}
  private revision(value: { revision: number }, expected: number) {
    if (value.revision !== expected) throw new ConflictException();
  }
  private async view(tx: HabitsTransaction, h: Habit) {
    const versions = await tx.schedules(h.id);
    return {
      ...h,
      currentSchedule: currentSchedule(versions, new Date()),
      latestSchedule: versions.at(-1)!,
    };
  }
  private value(h: Habit, value: string) {
    if (h.type === 'CHECKBOX' && !['0', '1'].includes(value))
      invalid('CHECKBOX_VALUE');
    if (h.type === 'DURATION' && value.includes('.'))
      invalid('DURATION_SECONDS_REQUIRED');
  }
  private target(h: Habit, value: string) {
    this.value(h, value);
    if (value === '0' || (h.type === 'CHECKBOX' && value !== '1'))
      invalid('INVALID_TARGET');
  }
  create(
    scope: AuthorizedSpace,
    key: string | undefined,
    input: c.HabitCreate,
  ) {
    if (!key) throw new BadRequestException();
    return this.repo.once(scope, 'post.habits', key, input, async (tx) => {
      const prefs = await tx.preferences(),
        h = await tx.createHabit({
          title: input.title,
          type: input.type,
          unit: input.unit,
          purpose: input.purpose,
        });
      await tx.createSchedule(h, {
        effectiveFrom: input.schedule.startDate,
        timezone: input.timezone ?? prefs.timezone,
        target: input.target,
        status: 'ACTIVE',
        schedule: input.schedule,
      });
      await tx.audit('HABIT_CREATE', h.id);
      return this.view(tx, h);
    });
  }
  get(scope: AuthorizedSpace, id: string) {
    return this.repo.run(scope, async (tx) =>
      this.view(tx, await tx.habit(id)),
    );
  }
  list(scope: AuthorizedSpace, query: PageQuery) {
    return this.repo.run(scope, async (tx) => {
      const page = await tx.habits(query);
      return {
        ...page,
        items: await Promise.all(page.items.map((h) => this.view(tx, h))),
      };
    });
  }
  patch(
    scope: AuthorizedSpace,
    id: string,
    revision: number,
    input: c.HabitPatch,
  ) {
    return this.repo.run(scope, async (tx) => {
      const h = await tx.habit(id);
      this.revision(h, revision);
      const versions = await tx.schedules(id),
        now = new Date(),
        active = currentSchedule(versions, now) ?? versions.at(-1)!;
      const configuration =
        input.target !== undefined ||
        input.timezone !== undefined ||
        input.schedule !== undefined ||
        input.status !== undefined;
      let next:
        Omit<Schedule, 'id' | 'habitId' | 'revision' | 'createdAt'> | undefined;
      if (configuration) {
        if (versions.length >= 1000) invalid('SCHEDULE_VERSION_LIMIT');
        const effectiveFrom =
          input.effectiveFrom ?? localDate(now, active.timezone);
        if (
          effectiveFrom < localDate(now, active.timezone) &&
          input.confirmHistoricalChange !== true
        )
          invalid('HISTORICAL_CONFIRMATION_REQUIRED');
        const base = scheduleAt(versions, effectiveFrom) ?? active;
        const target = input.target ?? base.target;
        this.target(h, target);
        next = {
          effectiveFrom,
          timezone: input.timezone ?? base.timezone,
          target,
          status: input.status ?? base.status,
          schedule: input.schedule ?? base.schedule,
        };
      }
      const updated = await tx.updateHabit(h, input.title);
      if (next) await tx.createSchedule(updated, next);
      await tx.audit('HABIT_UPDATE', id);
      return this.view(tx, updated);
    });
  }
  schedules(scope: AuthorizedSpace, id: string, query: PageQuery) {
    return this.repo.run(scope, async (tx) => {
      await tx.habit(id);
      return tx.schedulePage(id, query);
    });
  }
  entries(scope: AuthorizedSpace, id: string, query: c.HabitEntriesQuery) {
    return this.repo.run(scope, async (tx) => {
      await tx.habit(id);
      return tx.entriesPage(id, query);
    });
  }
  entry(scope: AuthorizedSpace, id: string, entryId: string) {
    return this.repo.run(scope, async (tx) => {
      await tx.habit(id);
      return tx.entry(id, entryId);
    });
  }
  history(
    scope: AuthorizedSpace,
    id: string,
    entryId: string,
    query: PageQuery,
  ) {
    return this.repo.run(scope, async (tx) => {
      await tx.habit(id);
      return tx.history(id, entryId, query);
    });
  }
  private async entryChecks(
    tx: HabitsTransaction,
    h: Habit,
    versions: Schedule[],
    date: string,
    kind: Entry['kind'],
    value: string | null,
    excludedId?: string,
  ) {
    const v = scheduleAt(versions, date);
    if (!v) invalid('DATE_BEFORE_START');
    if (date > localDate(new Date(), v.timezone)) invalid('FUTURE_ENTRY');
    const entries = (await tx.entriesRange([h.id], date, addDays(date))).filter(
      (e) => e.id !== excludedId && e.state === 'RECORDED',
    );
    if (kind === 'SKIP') {
      if (v.status !== 'ACTIVE' || !due(v.schedule, date))
        invalid('NOT_A_DUE_DATE');
      if (entries.some((e) => e.kind === 'SKIP')) throw new ConflictException();
      if (sum(entries) >= units(v.target)) invalid('DATE_ALREADY_COMPLETED');
    } else {
      this.value(h, value!);
      if (entries.some((e) => e.kind === 'SKIP')) invalid('CLEAR_SKIP_FIRST');
      if (kind === 'CHECKBOX' && entries.some((e) => e.kind === 'CHECKBOX'))
        throw new ConflictException();
    }
    return v;
  }
  record(
    scope: AuthorizedSpace,
    id: string,
    key: string | undefined,
    input: c.HabitEntryCreate,
  ) {
    if (!key) throw new BadRequestException();
    return this.repo.once(
      scope,
      'post.habits.entries',
      key,
      { habitId: id, input },
      async (tx) => {
        const h = await tx.habit(id);
        this.revision(h, input.habitRevision);
        const versions = await tx.schedules(id),
          now = new Date(),
          active = currentSchedule(versions, now);
        if (!active) invalid('HABIT_NOT_STARTED');
        if (active.status === 'ARCHIVED') invalid('HABIT_ARCHIVED');
        const date = input.localDate ?? localDate(now, active.timezone),
          kind = input.action === 'SKIP' ? 'SKIP' : h.type,
          value =
            kind === 'SKIP'
              ? null
              : (input.value ??
                (kind === 'CHECKBOX' ? '1' : invalid('VALUE_REQUIRED')));
        const v = await this.entryChecks(tx, h, versions, date, kind, value),
          prefs = await tx.preferences();
        const entry = await tx.appendEntry({
          habitId: id,
          scheduleId: v.id,
          kind,
          state: 'RECORDED',
          localDate: date,
          value,
          timezone: v.timezone,
          recordedTimezone: prefs.timezone,
        });
        await tx.audit('HABIT_ENTRY_RECORD', entry.id);
        await tx.event('habit.entry_recorded', id);
        return entry;
      },
    );
  }
  correct(
    scope: AuthorizedSpace,
    id: string,
    entryId: string,
    revision: number,
    input: c.HabitEntryPatch,
  ) {
    return this.repo.run(scope, async (tx) => {
      const h = await tx.habit(id);
      this.revision(h, input.habitRevision);
      const before = await tx.entry(id, entryId);
      this.revision(before, revision);
      const value = input.value ?? before.value,
        state =
          input.void === undefined
            ? before.state
            : input.void
              ? 'VOID'
              : 'RECORDED';
      if (before.kind === 'SKIP' && input.value !== undefined)
        invalid('SKIP_HAS_NO_VALUE');
      if (before.kind !== 'SKIP') this.value(h, value!);
      if (state === 'RECORDED')
        await this.entryChecks(
          tx,
          h,
          await tx.schedules(id),
          before.localDate,
          before.kind,
          value,
          before.id,
        );
      const prefs = await tx.preferences(),
        entry = await tx.appendEntry(
          {
            habitId: id,
            scheduleId: before.scheduleId,
            kind: before.kind,
            state,
            localDate: before.localDate,
            value,
            timezone: before.timezone,
            recordedTimezone: prefs.timezone,
          },
          before,
        );
      await tx.audit('HABIT_ENTRY_CORRECT', entry.id);
      await tx.event('habit.entry_corrected', id);
      return entry;
    });
  }
  stats(scope: AuthorizedSpace, id: string, query: c.HabitStatsQuery) {
    return this.repo.run(scope, async (tx) => {
      await tx.habit(id);
      const versions = await tx.schedules(id),
        active = currentSchedule(versions, new Date()) ?? versions.at(-1)!,
        today = localDate(new Date(), active.timezone),
        asOf = query.asOfDate ?? today;
      if (asOf > today) invalid('FUTURE_AS_OF_DATE');
      return stats(
        id,
        versions,
        await tx.entriesRange([id], query.from, query.to),
        query.from,
        query.to,
        asOf,
      );
    });
  }
  private async routineView(tx: HabitsTransaction, r: Routine) {
    const { habitIds, ...rest } = r;
    return {
      ...rest,
      habits: await Promise.all(
        habitIds.map(async (habitId, position) => {
          const h = await tx.habit(habitId),
            versions = await tx.schedules(habitId);
          return {
            habitId,
            position,
            title: h.title,
            status: currentSchedule(versions, new Date())?.status ?? null,
          };
        }),
      ),
    };
  }
  createRoutine(
    scope: AuthorizedSpace,
    key: string | undefined,
    input: c.RoutineCreate,
  ) {
    if (!key) throw new BadRequestException();
    return this.repo.once(scope, 'post.routines', key, input, async (tx) => {
      for (const id of input.habitIds) await tx.habit(id);
      const r = await tx.createRoutine(input.title, input.habitIds);
      await tx.audit('ROUTINE_CREATE', r.id);
      return this.routineView(tx, r);
    });
  }
  routine(scope: AuthorizedSpace, id: string) {
    return this.repo.run(scope, async (tx) =>
      this.routineView(tx, await tx.routine(id)),
    );
  }
  routines(scope: AuthorizedSpace, q: PageQuery) {
    return this.repo.run(scope, async (tx) => {
      const page = await tx.routines(q);
      return {
        ...page,
        items: await Promise.all(
          page.items.map((r) => this.routineView(tx, r)),
        ),
      };
    });
  }
  patchRoutine(
    scope: AuthorizedSpace,
    id: string,
    revision: number,
    input: c.RoutinePatch,
  ) {
    return this.repo.run(scope, async (tx) => {
      const before = await tx.routine(id);
      this.revision(before, revision);
      const ids = input.habitIds ?? before.habitIds;
      for (const habitId of ids) await tx.habit(habitId);
      const r = await tx.updateRoutine(
        before,
        input.title ?? before.title,
        input.status ?? before.status,
        ids,
      );
      await tx.audit('ROUTINE_UPDATE', id);
      return this.routineView(tx, r);
    });
  }
  water(scope: AuthorizedSpace, query: c.WaterSummaryQuery) {
    return this.repo.run(scope, async (tx) => {
      const habits = await tx.waterHabits(query.habitId),
        entries = await tx.entriesRange(
          habits.map((h) => h.id),
          query.from,
          query.to,
        );
      let versionCount = 0;
      const items = await Promise.all(
        habits.map(async (h) => {
          const targets = await tx.schedules(h.id);
          versionCount += targets.length;
          if (versionCount > 10000) invalid('RANGE_TOO_DENSE');
          return {
            habitId: h.id,
            title: h.title,
            totalML: decimal(sum(entries.filter((e) => e.habitId === h.id))),
            targets,
          };
        }),
      );
      const days: Array<{ localDate: string; totalML: string }> = [];
      for (let date = query.from; date < query.to; date = addDays(date))
        days.push({ localDate: date, totalML: decimal(sum(entries, date)) });
      return {
        from: query.from,
        to: query.to,
        unit: 'ML' as const,
        totalML: decimal(sum(entries)),
        days,
        habits: items,
      };
    });
  }
}
