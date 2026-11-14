import { describe, expect, it } from 'vitest';
import { estimateAccuracy } from './estimates.js';

const s = (
  category: string | null,
  estimatedMinutes: number | null,
  actualMinutes: number,
) => ({
  taskId: crypto.randomUUID(),
  category,
  estimatedMinutes,
  actualMinutes,
});

describe('B4 estimate accuracy', () => {
  it('collects until 5 measured tasks and never counts unmeasured ones', () => {
    expect(
      estimateAccuracy([
        s('design', 60, 90),
        s('design', 60, 90),
        s('design', 60, 90),
        s('design', 60, 90),
        s(null, 60, 90),
        s('admin', null, 90),
        s('admin', 0, 90),
        s('writing', 60, 0),
      ]),
    ).toEqual({ status: 'collecting', have: 4, need: 5 });
  });
  it('reports Σactual ÷ Σestimated per category (≥ 3 tasks), biggest first, with a buffer suggestion', () => {
    const r = estimateAccuracy([
      s('design', 60, 100),
      s('design', 60, 90),
      s('design', 60, 98),
      s('admin', 30, 24),
      s('admin', 30, 24),
      s('admin', 30, 24),
      s('writing', 60, 60),
      s('errands', 60, 0),
      s(null, 10, 10),
    ]);
    expect(r).toEqual({
      status: 'ready',
      pattern: {
        id: 'estimates',
        categories: [
          {
            id: 'design',
            ratio: 1.6,
            tasks: 3,
            estimatedMinutes: 180,
            actualMinutes: 288,
          },
          {
            id: 'admin',
            ratio: 0.8,
            tasks: 3,
            estimatedMinutes: 90,
            actualMinutes: 72,
          },
        ],
        suggestion: { category: 'design', bufferPercent: 60 },
        excluded: { uncategorized: 1, unestimated: 0, untracked: 1 },
      },
    });
  });
  it('suggests nothing when no category overruns by 10%', () => {
    const r = estimateAccuracy(
      Array.from({ length: 5 }, () => s('admin', 60, 63)),
    );
    expect(r.status === 'ready' && r.pattern.suggestion).toBeNull();
  });
});
