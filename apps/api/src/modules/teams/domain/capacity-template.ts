export type CapacityTemplate = {
  timezone: string;
  effectiveFrom: string;
  weekdays: (number | null)[];
};

/** Dated Team exceptions override the weekly template, including explicit zero. */
export function capacityMinutes(
  date: string,
  timezone: string,
  dated: number | null | undefined,
  template: CapacityTemplate | null,
): number | null {
  if (dated !== undefined) return dated;
  if (
    !template ||
    template.timezone !== timezone ||
    date < template.effectiveFrom
  )
    return null;
  return template.weekdays[new Date(date + 'T00:00:00Z').getUTCDay()] ?? null;
}

export function forecastPeriod(
  capacity: number | null,
  workload: number,
  unknownEstimates: number,
) {
  const known = capacity !== null && unknownEstimates === 0;
  return {
    knownWorkloadMinutes: workload,
    unknownEstimates,
    remainingMinutes: known ? capacity - workload : null,
    // A lower bound can prove over-allocation even with missing estimates.
    overallocatedMinutes:
      capacity === null ? null : Math.max(0, workload - capacity),
    state: known ? ('KNOWN' as const) : ('UNKNOWN' as const),
  };
}

export function observedMinutes(
  logs: { startedAt: Date; endedAt: Date }[],
  from: number,
  to: number,
) {
  const intervals = logs
    .map(
      (l) => [Math.max(from, +l.startedAt), Math.min(to, +l.endedAt)] as const,
    )
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  let total = 0,
    start = 0,
    end = 0;
  for (const [a, b] of intervals) {
    if (a > end) {
      total += end - start;
      start = a;
      end = b;
    } else end = Math.max(end, b);
  }
  return Math.round((total + end - start) / 60000);
}
