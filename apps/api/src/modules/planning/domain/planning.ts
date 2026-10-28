export type Preferences = {
  timezone: string;
  firstDayOfWeek: number;
  revision: number;
  availability: { version: 1; minutesByWeekday: number[] } | null;
};
type Aggregate = {
  id: string;
  spaceId: string;
  createdByUserId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type Day = Aggregate & { localDate: string; timezone: string };
export type Week = Aggregate & {
  weekStartDate: string;
  timezone: string;
  firstDayOfWeek: number;
};
export type Review = Aggregate & {
  localDate: string;
  timezone: string;
  firstDayOfWeek: number;
  kind: 'MORNING' | 'EVENING' | 'WEEKLY';
  reflection: string;
};
export type Item = {
  id: string;
  taskId: string;
  position: number;
  plannedMinutes: number | null;
  selectedTaskRevision: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type ItemWrite = {
  taskId: string;
  plannedMinutes: number | null;
  selectedTaskRevision: number;
};
export type PlanningTask = {
  id: string;
  revision: number;
  title: string | null;
  status: 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELED';
  dueAt: string | null;
  scheduledDate: string | null;
  deleted: boolean;
  isMaster: boolean;
  occurrenceState: 'PENDING' | 'DONE' | 'SKIPPED' | 'CANCELED' | null;
};
export type Disposition =
  | 'READY'
  | 'STALE'
  | 'COMPLETED'
  | 'DELETED'
  | 'SKIPPED'
  | 'CANCELED'
  | 'BLOCKED'
  | 'ALREADY_SELECTED';
export const addDays = (value: string, days: number) =>
  new Date(Date.parse(value + 'T00:00:00Z') + days * 86400000)
    .toISOString()
    .slice(0, 10);
export const weekday = (value: string) =>
  new Date(value + 'T00:00:00Z').getUTCDay();
export function localToday(now: Date, timezone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function disposition(
  task: PlanningTask | undefined,
  selectedRevision?: number,
): Disposition {
  if (!task || task.isMaster) return 'BLOCKED';
  if (task.deleted) return 'DELETED';
  if (task.occurrenceState === 'SKIPPED') return 'SKIPPED';
  if (task.status === 'DONE' || task.occurrenceState === 'DONE')
    return 'COMPLETED';
  if (task.status === 'CANCELED' || task.occurrenceState === 'CANCELED')
    return 'CANCELED';
  if (selectedRevision !== undefined && task.revision !== selectedRevision)
    return 'STALE';
  return 'READY';
}
export const itemWrites = (items: Item[]): ItemWrite[] =>
  items.map((item) => ({
    taskId: item.taskId,
    plannedMinutes: item.plannedMinutes,
    selectedTaskRevision: item.selectedTaskRevision,
  }));
export function allocate(items: Item[], availability: number | null) {
  const knownPlannedMinutes = items.reduce(
      (sum, item) => sum + (item.plannedMinutes ?? 0),
      0,
    ),
    unknownAllocations = items.filter(
      (item) => item.plannedMinutes === null,
    ).length;
  return {
    availableMinutes: availability,
    knownPlannedMinutes,
    unknownAllocations,
    remainingMinutes:
      availability === null || unknownAllocations
        ? null
        : availability - knownPlannedMinutes,
    overCapacity:
      availability === null ? null : knownPlannedMinutes > availability,
  };
}
