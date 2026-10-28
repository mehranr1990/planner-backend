import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import type { Habit, Schedule, Entry, Routine } from '../domain/habits.js';
export const HABITS_REPOSITORY = Symbol('HABITS_REPOSITORY');
export type PageQuery = {
  limit?: string | undefined;
  cursor?: string | undefined;
};
export type Page<T> = { items: T[]; nextCursor: string | null };
export type EntryWrite = Pick<
  Entry,
  | 'habitId'
  | 'scheduleId'
  | 'kind'
  | 'state'
  | 'localDate'
  | 'value'
  | 'timezone'
  | 'recordedTimezone'
>;
export type ScheduleWrite = Pick<
  Schedule,
  'effectiveFrom' | 'timezone' | 'target' | 'status' | 'schedule'
>;
export interface HabitsTransaction {
  preferences(): Promise<{ timezone: string }>;
  habit(id: string): Promise<Habit>;
  habits(query: PageQuery): Promise<Page<Habit>>;
  waterHabits(id?: string): Promise<Habit[]>;
  createHabit(
    input: Pick<Habit, 'title' | 'type' | 'unit' | 'purpose'>,
  ): Promise<Habit>;
  updateHabit(before: Habit, title?: string): Promise<Habit>;
  schedules(id: string): Promise<Schedule[]>;
  schedulePage(id: string, query: PageQuery): Promise<Page<Schedule>>;
  createSchedule(habit: Habit, input: ScheduleWrite): Promise<void>;
  entriesRange(habitIds: string[], from: string, to: string): Promise<Entry[]>;
  entriesPage(
    id: string,
    query: PageQuery & { from?: string | undefined; to?: string | undefined },
  ): Promise<Page<Entry>>;
  entry(habitId: string, logicalId: string): Promise<Entry>;
  history(
    habitId: string,
    logicalId: string,
    query: PageQuery,
  ): Promise<Page<Entry>>;
  appendEntry(input: EntryWrite, before?: Entry): Promise<Entry>;
  routine(id: string): Promise<Routine>;
  routines(query: PageQuery): Promise<Page<Routine>>;
  createRoutine(title: string, habitIds: string[]): Promise<Routine>;
  updateRoutine(
    before: Routine,
    title: string,
    status: Routine['status'],
    habitIds: string[],
  ): Promise<Routine>;
  audit(
    action:
      | 'HABIT_CREATE'
      | 'HABIT_UPDATE'
      | 'HABIT_ENTRY_RECORD'
      | 'HABIT_ENTRY_CORRECT'
      | 'ROUTINE_CREATE'
      | 'ROUTINE_UPDATE',
    id: string,
  ): Promise<void>;
  event(
    type: 'habit.entry_recorded' | 'habit.entry_corrected',
    habitId: string,
  ): Promise<void>;
}
export interface HabitsPort {
  run<T>(
    scope: AuthorizedSpace,
    work: (tx: HabitsTransaction) => Promise<T>,
  ): Promise<T>;
  once<T extends { id: string }>(
    scope: AuthorizedSpace,
    operation: string,
    key: string,
    request: unknown,
    work: (tx: HabitsTransaction) => Promise<T>,
  ): Promise<T>;
}
