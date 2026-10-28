export type Interval = { start: number; end: number };

/** Half-open UTC intervals. An endpoint touching another interval has no overlap. */
export function clip(value: Interval, range: Interval): Interval | null {
  const start = Math.max(value.start, range.start);
  const end = Math.min(value.end, range.end);
  return end > start ? { start, end } : null;
}

export function unionMilliseconds(values: Interval[]): number {
  const ordered = values
    .filter((v) => v.end > v.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const first = ordered[0];
  if (!first) return 0;
  let total = 0,
    start = first.start,
    end = first.end;
  for (const value of ordered.slice(1)) {
    if (value.start > end) {
      total += end - start;
      start = value.start;
      end = value.end;
    } else if (value.end > end) end = value.end;
  }
  return total + end - start;
}
