import { it, expect } from 'vitest';
import { unionedWorkSeconds, cycleTime } from './project-analytics.js';
const from = new Date('2026-11-15T00:00:00Z'),
  to = new Date('2026-11-16T00:00:00Z');
it('unions overlapping shared logs per admission and clips the selected window', () => {
  const rows = [
    {
      accessId: 'a',
      generation: 1,
      startedAt: new Date('2026-11-14T23:30:00Z'),
      endedAt: new Date('2026-11-15T01:00:00Z'),
    },
    {
      accessId: 'a',
      generation: 1,
      startedAt: new Date('2026-11-15T00:30:00Z'),
      endedAt: new Date('2026-11-15T02:00:00Z'),
    },
  ];
  expect(unionedWorkSeconds(rows, from, to)).toBe(7200);
  expect(
    unionedWorkSeconds([...rows, { ...rows[0]!, accessId: 'b' }], from, to),
  ).toBe(10800);
});
it('keeps missing or invalid start evidence unknown and measures through the current completion', () => {
  expect(
    cycleTime(
      [
        { taskId: 'a', completedAt: '2026-11-15T02:00:00Z' },
        { taskId: 'b', completedAt: '2026-11-15T01:00:00Z' },
      ],
      new Map([['a', from]]),
    ),
  ).toEqual({
    knownCompletedTasks: 1,
    unknownCompletedTasks: 1,
    medianSeconds: 7200,
  });
  expect(cycleTime([], new Map()).medianSeconds).toBeNull();
});
