const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string) {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
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
    formatters.set(zone, f);
  }
  return f;
}
export function localParts(now: Date, zone: string) {
  const p = Object.fromEntries(
    formatter(zone)
      .formatToParts(now)
      .map((v) => [v.type, v.value]),
  );
  return {
    date: p.year + '-' + p.month + '-' + p.day,
    time: p.hour + ':' + p.minute,
    seconds: p.second!,
  };
}
export function addDays(date: string, count: number) {
  return new Date(Date.parse(date + 'T12:00:00Z') + count * 86400000)
    .toISOString()
    .slice(0, 10);
}
function offsets(naive: number, zone: string) {
  const values = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 6) {
    const t = naive + hours * 3600000,
      p = localParts(new Date(t), zone);
    values.add(
      Date.parse(p.date + 'T' + p.time + ':' + p.seconds + 'Z') -
        Math.floor(t / 1000) * 1000,
    );
  }
  return [...values];
}
function candidates(
  date: string,
  time: string,
  zone: string,
  possible?: number[],
) {
  const naive = Date.parse(date + 'T' + time + ':00Z');
  return (possible ?? offsets(naive, zone))
    .map((o) => new Date(naive - o))
    .filter((d) => {
      const p = localParts(d, zone);
      return p.date === date && p.time === time;
    })
    .sort((a, b) => a.getTime() - b.getTime());
}
export function resolveLocal(date: string, time: string, zone: string) {
  const found = candidates(date, time, zone);
  return { instant: found[0] ?? null, ambiguous: found.length > 1 };
}
export function firstValidLocal(date: string, time: string, zone: string) {
  const naive = Date.parse(date + 'T' + time + ':00Z'),
    possible = offsets(naive, zone);
  for (let minutes = 0; minutes <= 2880; minutes++) {
    const local = new Date(naive + minutes * 60000).toISOString(),
      found = candidates(
        local.slice(0, 10),
        local.slice(11, 16),
        zone,
        possible,
      );
    if (found[0]) return found[0];
  }
  throw new RangeError('LOCAL_TIME_UNRESOLVABLE');
}
export function quietUntil(
  now: Date,
  zone: string,
  start: string | null,
  end: string | null,
  urgent: boolean,
) {
  if (urgent || !start || !end) return now;
  if (start === end) throw new RangeError('INVALID_QUIET_HOURS');
  const p = localParts(now, zone);
  const inside =
    start < end
      ? p.time >= start && p.time < end
      : p.time >= start || p.time < end;
  if (!inside) return now;
  const endDate = start > end && p.time >= start ? addDays(p.date, 1) : p.date;
  return new Date(
    Math.max(now.getTime(), firstValidLocal(endDate, end, zone).getTime()),
  );
}
export function retryAt(now: Date, attempts: number) {
  const delays = [60, 300, 900, 3600];
  if (attempts < 1 || attempts > 4) return null;
  return new Date(now.getTime() + delays[attempts - 1]! * 1000);
}
export const overdueGraceMs = 7 * 86400000;
export type ReminderSchedule = {
  version: 1;
  frequency:
    | 'DAILY'
    | 'WEEKLY'
    | 'SELECTED_WEEKDAYS'
    | 'MONTHLY'
    | 'YEARLY'
    | 'INTERVAL';
  interval: number;
  weekdays: number[];
  until: string | null;
  count: number | null;
  exclusions: string[];
};
function basic(date: string, anchor: string, s: ReminderSchedule): boolean {
  if (date < anchor || (s.until && date > s.until)) return false;
  const days = Math.round((Date.parse(date) - Date.parse(anchor)) / 86400000),
    a = new Date(anchor + 'T12:00:00Z'),
    d = new Date(date + 'T12:00:00Z');
  switch (s.frequency) {
    case 'DAILY':
    case 'INTERVAL':
      return days % s.interval === 0;
    case 'WEEKLY':
      return days % (7 * s.interval) === 0;
    case 'SELECTED_WEEKDAYS':
      return (
        Math.floor(days / 7) % s.interval === 0 &&
        s.weekdays.includes(d.getUTCDay())
      );
    case 'MONTHLY':
      return (
        d.getUTCDate() === a.getUTCDate() &&
        ((d.getUTCFullYear() - a.getUTCFullYear()) * 12 +
          d.getUTCMonth() -
          a.getUTCMonth()) %
          s.interval ===
          0
      );
    case 'YEARLY':
      return (
        d.getUTCDate() === a.getUTCDate() &&
        d.getUTCMonth() === a.getUTCMonth() &&
        (d.getUTCFullYear() - a.getUTCFullYear()) % s.interval === 0
      );
  }
}
export function dueOn(
  date: string,
  anchor: string,
  s: ReminderSchedule | null,
): boolean {
  if (!s) return date === anchor;
  if (!basic(date, anchor, s) || s.exclusions.includes(date)) return false;
  if (s.count === null) return true;
  return countThrough(date, anchor, s) <= s.count;
}
export function countThrough(
  date: string,
  anchor: string,
  s: ReminderSchedule,
): number {
  if (date < anchor) return 0;
  const span = Math.round((Date.parse(date) - Date.parse(anchor)) / 86400000),
    a = new Date(anchor + 'T12:00:00Z'),
    d = new Date(date + 'T12:00:00Z');
  let n = 0;
  switch (s.frequency) {
    case 'DAILY':
    case 'INTERVAL':
      n = Math.floor(span / s.interval) + 1;
      break;
    case 'WEEKLY':
      n = Math.floor(span / (7 * s.interval)) + 1;
      break;
    case 'SELECTED_WEEKDAYS': {
      n = Math.floor(span / (7 * s.interval)) * s.weekdays.length;
      const rest = Math.min(span % (7 * s.interval), 6);
      for (let k = 0; k <= rest; k++)
        if (s.weekdays.includes((a.getUTCDay() + k) % 7)) n++;
      break;
    }
    case 'MONTHLY': {
      const months =
        (d.getUTCFullYear() - a.getUTCFullYear()) * 12 +
        d.getUTCMonth() -
        a.getUTCMonth() -
        (d.getUTCDate() < a.getUTCDate() ? 1 : 0);
      for (let m = 0; m <= months; m += s.interval) {
        const year =
            a.getUTCFullYear() + Math.floor((a.getUTCMonth() + m) / 12),
          month = (a.getUTCMonth() + m) % 12;
        if (
          new Date(Date.UTC(year, month + 1, 0)).getUTCDate() >= a.getUTCDate()
        )
          n++;
      }
      break;
    }
    case 'YEARLY':
      for (
        let y = a.getUTCFullYear();
        y <=
        d.getUTCFullYear() -
          (d.getUTCMonth() < a.getUTCMonth() ||
          (d.getUTCMonth() === a.getUTCMonth() &&
            d.getUTCDate() < a.getUTCDate())
            ? 1
            : 0);
        y += s.interval
      )
        if (
          new Date(Date.UTC(y, a.getUTCMonth() + 1, 0)).getUTCDate() >=
          a.getUTCDate()
        )
          n++;
      break;
  }
  for (const excluded of s.exclusions)
    if (excluded >= anchor && excluded <= date && basic(excluded, anchor, s))
      n--;
  return n;
}
