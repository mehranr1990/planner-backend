import { describe, it, expect } from 'vitest';
import { routineDue } from './routines.js';
describe('routine scheduling', () => {
  it('anchors weekly schedules and honors inclusive end date', () => {
    const rule = {
      startDate: '2026-11-02',
      endDate: '2026-11-09',
      kind: 'WEEKLY' as const,
    };
    expect(routineDue(rule, '2026-11-09')).toBe(true);
    expect(routineDue(rule, '2026-11-08')).toBe(false);
    expect(routineDue(rule, '2026-11-16')).toBe(false);
  });
  it('supports daily and selected weekdays without default times', () => {
    expect(
      routineDue({ startDate: '2026-11-02', kind: 'DAILY' }, '2026-11-03'),
    ).toBe(true);
    expect(
      routineDue(
        { startDate: '2026-11-02', kind: 'WEEKDAYS', weekdays: [2] },
        '2026-11-03',
      ),
    ).toBe(true);
  });
});
