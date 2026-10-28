export function suggestions(raw: string, today: string) {
  const text = raw.trim(),
    match = text.match(/^(.*?)\s+(today|tomorrow|on (\d{4}-\d{2}-\d{2}))$/i);
  if (!match || !match[1]!.trim())
    return { rawText: raw, title: raw, scheduledDate: null, recognized: false };
  let date: string;
  if (match[3]) date = match[3];
  else
    date = new Date(
      Date.parse(today + 'T00:00:00Z') +
        (match[2]!.toLowerCase() === 'tomorrow' ? 86400000 : 0),
    )
      .toISOString()
      .slice(0, 10);
  const epoch = Date.parse(date + 'T00:00:00Z');
  if (
    !Number.isFinite(epoch) ||
    date < '1900-01-01' ||
    date > '9998-12-31' ||
    new Date(epoch).toISOString().slice(0, 10) !== date
  )
    return { rawText: raw, title: raw, scheduledDate: null, recognized: false };
  return {
    rawText: raw,
    title: match[1]!.trim(),
    scheduledDate: date,
    recognized: true,
  };
}
export function localDate(now: Date, zone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return p.year + '-' + p.month + '-' + p.day;
}
