export type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELED';
export type BoardState =
  'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'BLOCKED' | 'DONE' | 'CANCELED';
export type Overlay = { state: string; taskStatus: string } | null | undefined;
export type CheckinSchedule =
  | {
      cadence: 'WEEKLY';
      opensDay: number;
      opensTime: string;
      closesDay: number;
      closesTime: string;
      timezone: string;
    }
  | {
      cadence: 'DAILY';
      opensTime: string;
      closesTime: string;
      timezone: string;
    };
export class CollaborationRuleError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
/** A Review/Blocked overlay applies only while the Task keeps the status it was set on. */
export function boardState(status: TaskStatus, overlay: Overlay): BoardState {
  if (status === 'DONE' || status === 'CANCELED') return status;
  if (overlay && overlay.taskStatus === status)
    return overlay.state as BoardState;
  return status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'TODO';
}
/** Engine status written for a board target; Blocked keeps an open status. */
export function engineStatus(target: BoardState, current: TaskStatus) {
  if (target === 'TODO') return 'OPEN' as const;
  if (target === 'IN_PROGRESS' || target === 'REVIEW')
    return 'IN_PROGRESS' as const;
  if (target === 'DONE') return 'DONE' as const;
  if (target === 'BLOCKED')
    return current === 'IN_PROGRESS' ? ('IN_PROGRESS' as const) : 'OPEN';
  throw new CollaborationRuleError('INVALID_BOARD_STATE');
}
export const addDays = (date: string, days: number) =>
  new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000)
    .toISOString()
    .slice(0, 10);
export const weekdayOf = (date: string) =>
  new Date(date + 'T00:00:00Z').getUTCDay();
/** Wall time to instant; a skipped (DST gap) minute resolves to the next valid one. */
function instant(
  wall: (local: string, timezone: string) => Date | null,
  date: string,
  time: string,
  timezone: string,
) {
  const [h, m] = time.split(':').map(Number) as [number, number];
  for (let step = 0; step <= 180; step++) {
    const total = h * 60 + m + step,
      day = addDays(date, Math.floor(total / 1440)),
      minute = total % 1440;
    const at = wall(
      day +
        'T' +
        String(Math.floor(minute / 60)).padStart(2, '0') +
        ':' +
        String(minute % 60).padStart(2, '0'),
      timezone,
    );
    if (at) return at;
  }
  throw new CollaborationRuleError('INVALID_SCHEDULE');
}
/** Late replies are allowed for 24h after closing: weekly (design T12) and daily (owner decision 2026-11-13). */
export const LATE_WINDOW_MS = 24 * 3600000;
export function checkinWindow(
  wall: (local: string, timezone: string) => Date | null,
  week: string,
  s: CheckinSchedule,
) {
  let offset: number;
  if (s.cadence === 'WEEKLY') {
    if (weekdayOf(week) !== s.opensDay)
      throw new CollaborationRuleError('PERIOD_NOT_ON_OPENING_DAY');
    offset = (s.closesDay - s.opensDay + 7) % 7;
    if (offset === 0 && s.closesTime <= s.opensTime) offset = 7;
  } else offset = s.closesTime > s.opensTime ? 0 : 1;
  const opensAt = instant(wall, week, s.opensTime, s.timezone),
    closesAt = instant(wall, addDays(week, offset), s.closesTime, s.timezone);
  return {
    opensAt,
    closesAt,
    lateUntil: new Date(closesAt.getTime() + LATE_WINDOW_MS),
  };
}
export function checkinStatus(
  w: ReturnType<typeof checkinWindow>,
  now: Date,
): 'UPCOMING' | 'OPEN' | 'LATE' | 'CLOSED' {
  if (now < w.opensAt) return 'UPCOMING';
  if (now < w.closesAt) return 'OPEN';
  if (now < w.lateUntil) return 'LATE';
  return 'CLOSED';
}
/** Upper bounds for client-computed clear times; the server never infers a status. */
const clearBounds = {
  HOUR: 3600000 + 60000,
  TODAY: 25 * 3600000,
  WEEK: 8 * 86400000,
} as const;
export function validClearTime(
  clearAfter: 'HOUR' | 'TODAY' | 'WEEK' | 'NEVER',
  until: Date | null,
  now: Date,
) {
  if (clearAfter === 'NEVER') return until === null;
  return (
    until !== null &&
    until > now &&
    until.getTime() - now.getTime() <= clearBounds[clearAfter]
  );
}
export const presenceActive = (
  row: { status: string | null; until: Date | null },
  now: Date,
) => row.status !== null && (row.until === null || row.until > now);
