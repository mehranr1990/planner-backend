export function localDate(now: Date, timezone: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(now)
      .map((v) => [v.type, v.value]),
  );
  return p.year + '-' + p.month + '-' + p.day;
}
export function addDays(date: string, count: number): string {
  return new Date(Date.parse(date + 'T12:00:00Z') + count * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function midnight(date: string, timezone: string): Date {
  const utc = Date.parse(date + 'T00:00:00Z');
  let lo = utc - 3 * 86400000,
    hi = utc + 3 * 86400000;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (localDate(new Date(mid), timezone) < date) lo = mid;
    else hi = mid;
  }
  return new Date(hi);
}
export function validRange(from: string, to: string, max = 366) {
  const days = (Date.parse(to) - Date.parse(from)) / 86400000;
  if (!Number.isInteger(days) || days < 1 || days > max)
    throw new RangeError('INVALID_RANGE');
  return days;
}
function monthId(date: string, calendar: 'GREGORIAN' | 'JALALI'): string {
  const p = new Intl.DateTimeFormat('en', {
    calendar: calendar === 'JALALI' ? 'persian' : 'gregory',
    timeZone: 'UTC',
    year: 'numeric',
    month: 'numeric',
    numberingSystem: 'latn',
  }).formatToParts(new Date(date + 'T12:00:00Z'));
  return p
    .filter((v) => v.type === 'year' || v.type === 'month')
    .map((v) => v.value)
    .join('/');
}
export function periodDates(
  date: string,
  kind: 'WEEKLY' | 'MONTHLY' | 'CUSTOM',
  calendar: 'GREGORIAN' | 'JALALI',
  firstDay: number,
  end?: string,
) {
  if (kind === 'CUSTOM') {
    if (!end) throw new RangeError('END_REQUIRED');
    validRange(date, end);
    return { startDate: date, endDate: end };
  }
  if (kind === 'WEEKLY') {
    const day = new Date(date + 'T12:00:00Z').getUTCDay(),
      startDate = addDays(date, -((day - firstDay + 7) % 7));
    return { startDate, endDate: addDays(startDate, 7) };
  }
  let startDate = date,
    endDate = addDays(date, 1);
  const id = monthId(date, calendar);
  for (
    let i = 0;
    i < 32 && monthId(addDays(startDate, -1), calendar) === id;
    i++
  )
    startDate = addDays(startDate, -1);
  for (let i = 0; i < 32 && monthId(endDate, calendar) === id; i++)
    endDate = addDays(endDate, 1);
  return { startDate, endDate };
}
export type DateSchedule = {
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
function basic(date: string, anchor: string, s: DateSchedule): boolean {
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
  s: DateSchedule | null,
): boolean {
  if (!s) return date === anchor;
  if (!basic(date, anchor, s) || s.exclusions.includes(date)) return false;
  if (s.count === null) return true;
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
        a.getUTCMonth();
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
      for (let y = a.getUTCFullYear(); y <= d.getUTCFullYear(); y += s.interval)
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
  return n <= s.count;
}
