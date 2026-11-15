export type Span = { start: number; end: number };
export function union(values: Span[]) {
  const result: Span[] = [];
  for (const row of [...values].sort((a, b) => a.start - b.start)) {
    if (row.end <= row.start) continue;
    const last = result.at(-1);
    if (last && row.start <= last.end) last.end = Math.max(last.end, row.end);
    else result.push({ ...row });
  }
  return result;
}
export const minutes = (rows: Span[]) =>
  union(rows).reduce((n, r) => n + (r.end - r.start) / 60000, 0);
export function measureCapacity(available: Span[], busy: Span[]) {
  const a = union(available),
    b = union(busy),
    intersections: Span[] = [];
  for (const x of a)
    for (const y of b) {
      const start = Math.max(x.start, y.start),
        end = Math.min(x.end, y.end);
      if (end > start) intersections.push({ start, end });
    }
  const availableMinutes = minutes(a),
    reservedMinutes = minutes(intersections),
    busyMinutes = minutes(b);
  return {
    availableMinutes,
    reservedMinutes,
    busyMinutes,
    remainingMinutes: Math.max(0, availableMinutes - reservedMinutes),
    overbookedMinutes: Math.max(0, busyMinutes - availableMinutes),
  };
}
