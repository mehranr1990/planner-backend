const categories = ['design', 'admin', 'writing', 'errands'] as const;
type Category = (typeof categories)[number];
export type EstimateSample = {
  taskId: string;
  category: string | null;
  estimatedMinutes: number | null;
  /** Recorded minutes (time-entry union); 0 when none. */
  actualMinutes: number;
};
/** Measured tasks needed overall before any pattern is shown, and per category row. */
export const ESTIMATES_NEED = 5;
export const ESTIMATES_PER_CATEGORY = 3;
const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * B4 estimate accuracy from recorded data only. A task is measured when it has
 * an explicit category, an estimate > 0 and recorded time > 0. Per category:
 * ratio = Σ actual ÷ Σ estimated. Rows need ≥ ESTIMATES_PER_CATEGORY measured
 * tasks; below ESTIMATES_NEED measured tasks overall the result is `collecting`.
 * Suggestion: the top row when its ratio ≥ 1.10, buffer = (ratio − 1) × 100
 * rounded to the nearest 5, clamped to 5–100.
 */
export function estimateAccuracy(samples: EstimateSample[]) {
  const excluded = { uncategorized: 0, unestimated: 0, untracked: 0 };
  const sums = new Map<
    Category,
    { tasks: number; estimatedMinutes: number; actualMinutes: number }
  >();
  let measured = 0;
  for (const s of samples) {
    if (!categories.includes(s.category as Category)) excluded.uncategorized++;
    else if (!s.estimatedMinutes) excluded.unestimated++;
    else if (s.actualMinutes <= 0) excluded.untracked++;
    else {
      measured++;
      const row = sums.get(s.category as Category) ?? {
        tasks: 0,
        estimatedMinutes: 0,
        actualMinutes: 0,
      };
      row.tasks++;
      row.estimatedMinutes += s.estimatedMinutes;
      row.actualMinutes += s.actualMinutes;
      sums.set(s.category as Category, row);
    }
  }
  if (measured < ESTIMATES_NEED)
    return {
      status: 'collecting' as const,
      have: measured,
      need: ESTIMATES_NEED,
    };
  const rows = [...sums]
    .filter(([, r]) => r.tasks >= ESTIMATES_PER_CATEGORY)
    .map(([id, r]) => ({
      id,
      ratio: round2(r.actualMinutes / r.estimatedMinutes),
      ...r,
    }))
    .filter((r) => r.ratio > 0)
    .sort((a, b) => b.ratio - a.ratio || (a.id < b.id ? -1 : 1));
  const top = rows[0];
  return {
    status: 'ready' as const,
    pattern: {
      id: 'estimates' as const,
      categories: rows,
      suggestion:
        top && top.ratio >= 1.1
          ? {
              category: top.id,
              bufferPercent: Math.min(
                100,
                Math.max(5, Math.round(((top.ratio - 1) * 100) / 5) * 5),
              ),
            }
          : null,
      excluded,
    },
  };
}
