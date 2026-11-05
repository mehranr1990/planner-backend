import { it, expect } from 'vitest';
import { recordedSeconds, taskReport } from './work-reports.js';
const from = new Date('2030-01-01T00:00Z'),
  to = new Date('2030-01-02T00:00Z');
it('clips explicit shared intervals and excludes voided rows', () =>
  expect(
    recordedSeconds(
      [
        {
          startedAt: new Date('2029-12-31T23:30Z'),
          endedAt: new Date('2030-01-01T00:30Z'),
          voidedAt: null,
        },
        { startedAt: from, endedAt: to, voidedAt: to },
      ],
      from,
      to,
    ),
  ).toEqual({ seconds: 1800, count: 1 }));
it('counts recorded effort explicitly without inventing distinct attendance', () =>
  expect(
    recordedSeconds(
      [
        { startedAt: from, endedAt: to, voidedAt: null },
        { startedAt: from, endedAt: to, voidedAt: null },
      ],
      from,
      to,
    ).seconds,
  ).toBe(172800));
it('keeps unknown estimates and declares current-state denominator', () =>
  expect(
    taskReport(
      [
        {
          status: 'OPEN',
          estimatedMinutes: null,
          dueAt: '2029-12-01T00:00Z',
          completedAt: null,
        },
        {
          status: 'DONE',
          estimatedMinutes: 30,
          dueAt: null,
          completedAt: '2030-01-01T12:00Z',
        },
      ],
      from,
      to,
      to,
    ),
  ).toEqual({
    taskCount: 2,
    statusCounts: { OPEN: 1, IN_PROGRESS: 0, DONE: 1, CANCELED: 0 },
    estimatedMinutes: 30,
    unknownEstimates: 1,
    completedInWindow: 1,
    overdueTaskCount: 1,
  }));
