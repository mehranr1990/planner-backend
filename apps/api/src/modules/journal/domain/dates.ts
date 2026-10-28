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
