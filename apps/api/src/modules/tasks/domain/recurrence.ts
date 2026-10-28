export type RecurrenceRule =
  | { kind: 'DAILY'; interval: number }
  | { kind: 'WEEKLY'; interval: number }
  | { kind: 'WEEKDAYS'; interval: number; weekdays: number[] }
  | { kind: 'MONTHLY_DATE'; interval: number; day: number }
  | { kind: 'MONTHLY_NTH'; interval: number; weekday: number; nth: number }
  | { kind: 'YEARLY'; interval: number; month: number; day: number }
  | {
      kind: 'INTERVAL';
      interval: number;
      unit: 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';
    };
export type RecurrenceDefinition = {
  version: 1;
  startDate: string;
  endDate: string | null;
  localTime: string;
  timezone: string;
  rule: RecurrenceRule;
  exclusionDates: string[];
};
const dayMs = 86400000;
const date = (value: string) => new Date(value + 'T00:00:00Z');
export const nextDate = (value: string, days = 1) =>
  new Date(date(value).getTime() + days * dayMs).toISOString().slice(0, 10);
export function matchesDate(def: RecurrenceDefinition, value: string): boolean {
  if (
    value < def.startDate ||
    (def.endDate !== null && value > def.endDate) ||
    def.exclusionDates.includes(value)
  )
    return false;
  const start = date(def.startDate),
    current = date(value),
    rule = def.rule;
  const days = Math.round((current.getTime() - start.getTime()) / dayMs);
  const months =
    (current.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    current.getUTCMonth() -
    start.getUTCMonth();
  const years = current.getUTCFullYear() - start.getUTCFullYear();
  const weekday = ((current.getUTCDay() + 6) % 7) + 1; // ISO Monday=1
  const startWeekday = ((start.getUTCDay() + 6) % 7) + 1;
  switch (rule.kind) {
    case 'DAILY':
      return days % rule.interval === 0;
    case 'WEEKLY':
      return days % (7 * rule.interval) === 0;
    case 'WEEKDAYS':
      return (
        Math.floor((days + startWeekday - 1) / 7) % rule.interval === 0 &&
        rule.weekdays.includes(weekday)
      );
    case 'MONTHLY_DATE':
      return months % rule.interval === 0 && current.getUTCDate() === rule.day;
    case 'MONTHLY_NTH':
      return (
        months % rule.interval === 0 &&
        weekday === rule.weekday &&
        (rule.nth === -1
          ? date(nextDate(value, 7)).getUTCMonth() !== current.getUTCMonth()
          : Math.floor((current.getUTCDate() - 1) / 7) + 1 === rule.nth)
      );
    case 'YEARLY':
      return (
        years % rule.interval === 0 &&
        current.getUTCMonth() + 1 === rule.month &&
        current.getUTCDate() === rule.day
      );
    case 'INTERVAL':
      switch (rule.unit) {
        case 'DAY':
          return days % rule.interval === 0;
        case 'WEEK':
          return days % (7 * rule.interval) === 0;
        case 'MONTH':
          return (
            months % rule.interval === 0 &&
            current.getUTCDate() === start.getUTCDate()
          );
        case 'YEAR':
          return (
            years % rule.interval === 0 &&
            current.getUTCMonth() === start.getUTCMonth() &&
            current.getUTCDate() === start.getUTCDate()
          );
      }
  }
}
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
  const parts = Object.fromEntries(
    format.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return `${parts.year!.padStart(4, '0')}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}
export function localDateAt(instant: Date, timezone: string) {
  return wallKey(formatter(timezone), instant).slice(0, 10);
}
/** Resolve exact wall time, testing offsets on both sides of a transition.
 * No host-local Date operations. A gap yields null; a fold chooses min UTC. */
export function resolveRecurrenceInstant(
  key: string,
  timezone: string,
): Date | null {
  const format = formatter(timezone),
    naive = Date.parse(key + 'Z'),
    offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 6) {
    const sample = naive + hours * 3600000;
    offsets.add(Date.parse(wallKey(format, new Date(sample)) + 'Z') - sample);
  }
  const candidates = [...offsets]
    .map((offset) => new Date(naive - offset))
    .filter((instant) => wallKey(format, instant) === key)
    .sort((a, b) => a.getTime() - b.getTime());
  return candidates[0] ?? null;
}
export type CatchUpCandidate = {
  key: string;
  localDate: string;
  instant: Date | null;
};
export function recurrenceBatch(
  def: RecurrenceDefinition,
  from: string,
  through: string,
  limit: number,
) {
  const candidates: CatchUpCandidate[] = [];
  let scanned = from,
    count = 0;
  const until = def.endDate && def.endDate < through ? def.endDate : through;
  let current = from < def.startDate ? def.startDate : from;
  while (current <= until && count < 366 && candidates.length < limit) {
    scanned = current;
    if (matchesDate(def, current)) {
      const key = current + 'T' + def.localTime + ':00';
      candidates.push({
        key,
        localDate: current,
        instant: resolveRecurrenceInstant(key, def.timezone),
      });
    }
    count++;
    current = nextDate(current);
  }
  return {
    candidates,
    scannedThrough: count ? scanned : null,
    nextDate: current <= until ? current : null,
  };
}
