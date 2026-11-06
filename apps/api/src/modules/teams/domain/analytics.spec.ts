import { it, expect } from 'vitest';
import { summarizeWork } from './analytics.js';
it('uses the current stock denominator, exact half-open completion window, known estimates and explicit clipped work logs', () => {
  const from = new Date('2030-01-07T00:00:00Z'),
    to = new Date('2030-01-08T00:00:00Z');
  const common = { estimatedMinutes: null, completedAt: null, dueAt: null };
  const report = summarizeWork(
    [
      { ...common, status: 'OPEN', dueAt: '2030-01-06T00:00:00Z' },
      {
        ...common,
        status: 'DONE',
        estimatedMinutes: 90,
        completedAt: from.toISOString(),
      },
      { ...common, status: 'DONE', completedAt: to.toISOString() },
      { ...common, status: 'CANCELED', estimatedMinutes: 0 },
    ],
    [
      {
        startedAt: new Date('2030-01-06T23:30:00Z'),
        endedAt: new Date('2030-01-07T00:30:00Z'),
        voidedAt: null,
      },
      {
        startedAt: new Date('2030-01-07T00:00:00Z'),
        endedAt: new Date('2030-01-07T01:00:00Z'),
        voidedAt: from,
      },
    ],
    2,
    from,
    to,
    from,
  );
  expect(report).toEqual({
    taskCount: 4,
    statusCounts: { OPEN: 1, IN_PROGRESS: 0, DONE: 2, CANCELED: 1 },
    estimatedMinutes: 90,
    unknownEstimates: 2,
    completedInWindow: 1,
    overdueTaskCount: 1,
    recordedSeconds: 1800,
    workLogCount: 1,
    goalCount: 2,
  });
});
