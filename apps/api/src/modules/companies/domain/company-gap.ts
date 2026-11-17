/** Union half-open observed intervals before computing occupancy. */
export function observedMilliseconds(
  intervals: readonly { from: number; to: number }[],
  from: number,
  to: number,
) {
  const sorted = intervals
    .map((r) => ({ from: Math.max(from, r.from), to: Math.min(to, r.to) }))
    .filter((r) => r.to > r.from)
    .sort((a, b) => a.from - b.from);
  let total = 0,
    end = from;
  for (const r of sorted) {
    total += Math.max(0, r.to - Math.max(end, r.from));
    end = Math.max(end, r.to);
  }
  return total;
}
export function activeWindow(
  row: { validFrom: Date; expiresAt: Date; revokedAt: Date | null },
  now: Date,
) {
  return !row.revokedAt && row.validFrom <= now && now < row.expiresAt;
}
/** Tags are explicit identifiers; preserve spelling/case, normalize whitespace only. */
export function normalizedAssetTag(value: string) {
  return value.trim().normalize('NFC');
}
