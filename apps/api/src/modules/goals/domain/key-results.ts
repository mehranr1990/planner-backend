/** Reproducible goal key-result formulas (Team GL, Company OD-2). All results are basis points (0–10000). */
const clamp = (v: number) =>
  Math.min(10000, Math.max(0, Math.round(v * 10000)));
/** clamp((current − start) ÷ (target − start), 0, 1); null without a recorded current value. */
export function keyResultProgress(
  start: string,
  target: string,
  current: string | null,
) {
  if (current === null) return null;
  const span = Number(target) - Number(start);
  if (span === 0) return null;
  return clamp((Number(current) - Number(start)) / span);
}
/** Unweighted mean of key-result progress; unknown when any input is unknown or none exist. */
export function goalProgress(values: (number | null)[]) {
  if (!values.length || values.some((v) => v === null)) return null;
  return Math.round(
    (values as number[]).reduce((sum, v) => sum + v, 0) / values.length,
  );
}
const days = (from: string, to: string) =>
  Math.round(
    (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) /
      86400000,
  );
/** Elapsed share of an inclusive date period at `today` (the Goal time zone's local date). */
export function periodProgress(start: string, target: string, today: string) {
  return clamp((days(start, today) + 1) / (days(start, target) + 1));
}
