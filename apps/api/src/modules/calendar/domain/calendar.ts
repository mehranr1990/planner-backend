export type ScheduleInput =
  | { kind: 'ALL_DAY'; timezone: string; startDate: string; endDate: string }
  | { kind: 'TIMED'; timezone: string; localStart: string; localEnd: string };
export type Schedule = ScheduleInput & {
  startAt: string | null;
  endAt: string | null;
};
export class CalendarRuleError extends Error {
  constructor(readonly reason: 'DST_GAP' | 'INVALID_INTERVAL') {
    super(reason);
  }
}
export const addDates = (value: string, days: number) =>
  new Date(Date.parse(value + 'T00:00:00Z') + days * 86400000)
    .toISOString()
    .slice(0, 10);
function formatter(timezone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
}
function wallKey(format: Intl.DateTimeFormat, instant: Date) {
  const p = Object.fromEntries(
    format.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return `${p.year!.padStart(4, '0')}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}
export function localKey(instant: Date, timezone: string) {
  return wallKey(formatter(timezone), instant);
}
/** Exact round-trip validation detects gaps; sorting chooses the earlier fold. */
export function wallInstant(local: string, timezone: string): Date | null {
  const key = local.length === 16 ? local + ':00' : local,
    format = formatter(timezone),
    naive = Date.parse(key + 'Z'),
    offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 6) {
    const sample = naive + hours * 3600000;
    offsets.add(Date.parse(wallKey(format, new Date(sample)) + 'Z') - sample);
  }
  return (
    [...offsets]
      .map((offset) => new Date(naive - offset))
      .filter((instant) => wallKey(format, instant) === key)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null
  );
}
export function normalizeSchedule(input: ScheduleInput): Schedule {
  if (input.kind === 'ALL_DAY') return { ...input, startAt: null, endAt: null };
  const start = wallInstant(input.localStart, input.timezone),
    end = wallInstant(input.localEnd, input.timezone);
  if (!start || !end) throw new CalendarRuleError('DST_GAP');
  if (end <= start || end.getTime() - start.getTime() > 366 * 86400000)
    throw new CalendarRuleError('INVALID_INTERVAL');
  return { ...input, startAt: start.toISOString(), endAt: end.toISOString() };
}
/** Half-open intervals: adjacent endpoints do not conflict. */
export function overlaps(
  a: { start: number; end: number },
  b: { start: number; end: number },
) {
  return (
    a.start < a.end && b.start < b.end && a.start < b.end && b.start < a.end
  );
}
/** Resolve a civil day boundary, including zones whose midnight is skipped.
 * This is a range boundary, never a shifted event schedule. Whole missing dates
 * share the next date's boundary and therefore have zero elapsed occupancy. */
export function dayBoundary(date: string, timezone: string): number {
  for (let minutes = 0; minutes <= 1440; minutes++) {
    const day = minutes === 1440 ? addDates(date, 1) : date,
      minute = minutes % 1440,
      local =
        day +
        'T' +
        String(Math.floor(minute / 60)).padStart(2, '0') +
        ':' +
        String(minute % 60).padStart(2, '0');
    const instant = wallInstant(local, timezone);
    if (instant) return instant.getTime();
  }
  throw new CalendarRuleError('INVALID_INTERVAL');
}
