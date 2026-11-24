import { BadRequestException } from '@nestjs/common';
export function effectiveSuspension(
  row: { suspendedAt: Date | null; suspensionExpiresAt: Date | null },
  now = new Date(),
) {
  return (
    row.suspendedAt !== null &&
    (row.suspensionExpiresAt === null || row.suspensionExpiresAt > now)
  );
}
export function dashboardRange(
  q: { range: string; from?: string | undefined; until?: string | undefined },
  now = new Date(),
) {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  let from: Date, until: Date;
  if (q.range === 'custom') {
    if (!q.from || !q.until) throw new BadRequestException();
    from = new Date(q.from);
    until = new Date(q.until);
  } else {
    if (q.from || q.until) throw new BadRequestException();
    const days = q.range === 'today' ? 1 : Number(q.range.slice(0, -1));
    from = new Date(start.getTime() - (days - 1) * 86400000);
    until = new Date(start.getTime() + 86400000);
  }
  if (
    !Number.isFinite(+from) ||
    !Number.isFinite(+until) ||
    until <= from ||
    +until - +from > 90 * 86400000 ||
    +until > +now + 86400000
  )
    throw new BadRequestException();
  return { from, until };
}
export function csvCell(value: unknown) {
  let cell = String(value ?? '');
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(cell) || /^[\t\r\n]/.test(cell))
    cell = "'" + cell;
  return '"' + cell.replaceAll('"', '""') + '"';
}
