import { describe, it, expect } from 'vitest';
import { advisoryHealth } from './project-health.js';
const now = new Date('2026-11-15T12:00:00Z');
describe('factual advisory health', () => {
  it('does not invent a baseline for empty or unfinished work', () => {
    expect(advisoryHealth([], null, new Set(), now).state).toBe('UNKNOWN');
    expect(
      advisoryHealth([{ status: 'OPEN', dueAt: null }], null, new Set(), now)
        .state,
    ).toBe('UNKNOWN');
  });
  it('distinguishes missed deadlines, observed overdue work and completed eligible work', () => {
    expect(
      advisoryHealth(
        [{ status: 'OPEN', dueAt: null }],
        '2026-11-14',
        new Set(),
        now,
      ).state,
    ).toBe('OFF_TRACK');
    expect(
      advisoryHealth(
        [{ status: 'OPEN', dueAt: '2026-11-14T12:00:00Z' }],
        null,
        new Set(),
        now,
      ).reasons,
    ).toEqual(['OVERDUE_WORK']);
    expect(
      advisoryHealth(
        [
          { status: 'DONE', dueAt: null },
          { status: 'CANCELED', dueAt: null },
        ],
        null,
        new Set(),
        now,
      ).observed.progressPercent,
    ).toBe(100);
  });
});
