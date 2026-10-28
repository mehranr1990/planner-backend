import { describe, it, expect } from 'vitest';
import * as c from './goals.js';
describe('strict goal contracts', () => {
  const goal = { title: ' Goal ', horizon: 'SHORT_TERM' };
  it('normalizes titles and applies explicit defaults', () =>
    expect(c.GoalCreateSchema.parse(goal)).toMatchObject({
      title: 'Goal',
      progressMode: 'MANUAL',
      status: 'PLANNED',
    }));
  it('rejects ownership overposting', () => {
    for (const k of ['spaceId', 'createdByUserId', 'revision', 'companyId'])
      expect(
        c.GoalCreateSchema.safeParse({ ...goal, [k]: 'foreign' }).success,
      ).toBe(false);
  });
  it('rejects malformed amounts and excess precision', () => {
    for (const n of ['1e2', 'NaN', '1.0000001', '1000000000', '--1'])
      expect(c.GoalAmountSchema.safeParse(n).success).toBe(false);
  });
  it('normalizes negative zero and trailing zeros', () => {
    expect(c.GoalAmountSchema.parse('-0.000')).toBe('0');
    expect(c.GoalAmountSchema.parse('1.2000')).toBe('1.2');
  });
  it('requires nonzero positive bounded weights', () => {
    for (const weight of ['0', '-1', '1000000.000001'])
      expect(c.GoalWeightSchema.safeParse(weight).success).toBe(false);
  });
  it('rejects equal normalized metric baseline and target', () =>
    expect(
      c.GoalMetricCreateSchema.safeParse({
        title: 'm',
        unit: 'COUNT',
        baseline: '1.0',
        target: '1',
        current: '1',
      }).success,
    ).toBe(false));
  it('requires real ordered dates', () => {
    expect(
      c.GoalCreateSchema.safeParse({ ...goal, startDate: '2024-02-30' })
        .success,
    ).toBe(false);
    expect(
      c.GoalCreateSchema.safeParse({
        ...goal,
        startDate: '2024-03-02',
        targetDate: '2024-03-01',
      }).success,
    ).toBe(false);
  });
  it('rejects premature metric selection at creation', () =>
    expect(
      c.GoalCreateSchema.safeParse({ ...goal, progressMode: 'METRIC' }).success,
    ).toBe(false));
  it('validates complete habit windows and partial contribution edits', () => {
    expect(
      c.GoalHabitLinkPatchSchema.safeParse({ contributes: true }).success,
    ).toBe(true);
    expect(
      c.GoalHabitLinkPatchSchema.safeParse({ from: '2024-01-01' }).success,
    ).toBe(false);
    expect(
      c.GoalHabitLinkPatchSchema.safeParse({
        from: '2024-01-01',
        to: '2026-01-01',
      }).success,
    ).toBe(false);
  });
  it('rejects empty patches and unknown source retargeting', () => {
    expect(c.GoalPatchSchema.safeParse({}).success).toBe(false);
    expect(c.GoalPatchSchema.parse({ title: 'Rename' })).toEqual({
      title: 'Rename',
    });
    expect(c.GoalMilestonePatchSchema.parse({ title: 'Rename' })).toEqual({
      title: 'Rename',
    });
    expect(
      c.GoalTaskLinkPatchSchema.safeParse({ taskId: 'foreign' }).success,
    ).toBe(false);
  });
});
