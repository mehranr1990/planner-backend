export const addDays = (date: string, n = 1) =>
  new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000)
    .toISOString()
    .slice(0, 10);
export function localDate(now: Date, zone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return parts.year + '-' + parts.month + '-' + parts.day;
}
/** Earliest day boundary; a skipped local date has the next date's boundary. */
export function dayBoundary(date: string, zone: string): number {
  let lo = Date.parse(date + 'T00:00:00Z') - 36 * 3600000,
    hi = lo + 72 * 3600000;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (localDate(new Date(mid), zone) < date) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
