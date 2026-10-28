import { describe, it, expect } from 'vitest';
import {
  HabitAmountSchema,
  HabitCreateSchema,
  HabitPatchSchema,
  HabitEntryCreateSchema,
  HabitEntryPatchSchema,
  HabitStatsQuerySchema,
  RoutineCreateSchema,
  WaterSummaryQuerySchema,
} from './habits.js';
import { randomUUID } from 'node:crypto';
describe('P1-05 strict measures, ownership and date-range contracts', () => {
  const habit = {
    title: ' Water ',
    type: 'QUANTITY',
    unit: 'ML',
    purpose: 'WATER',
    target: '2000',
    schedule: { version: 1, startDate: '2024-01-01', rule: { kind: 'DAILY' } },
  };
  it('normalizes exact decimal strings without number coercion', () => {
    expect(HabitAmountSchema.parse('100.500')).toBe('100.5');
    expect(HabitAmountSchema.parse('0.000')).toBe('0');
  });
  it.each(['-1', '0.0001', '01', '1e3', 'NaN', '1000000000', 1.5, null])(
    'rejects invalid exact measure %j',
    (v) => expect(HabitAmountSchema.safeParse(v).success).toBe(false),
  );
  it('requires canonical water and duration units and meaningful targets', () => {
    expect(HabitCreateSchema.parse(habit).title).toBe('Water');
    for (const patch of [
      { unit: 'L' },
      { type: 'CHECKBOX' },
      { target: '0' },
      { purpose: 'water' },
      { type: 'DURATION', unit: 'SECOND', purpose: 'GENERIC', target: '1.5' },
    ])
      expect(HabitCreateSchema.safeParse({ ...habit, ...patch }).success).toBe(
        false,
      );
  });
  it('rejects overposting and empty or metadata-only effective-date edits', () => {
    expect(
      HabitCreateSchema.safeParse({ ...habit, spaceId: randomUUID() }).success,
    ).toBe(false);
    for (const patch of [
      {},
      { unit: 'L' },
      { type: 'CHECKBOX' },
      { effectiveFrom: '2024-01-01' },
      { title: 'x', confirmHistoricalChange: true },
    ])
      expect(HabitPatchSchema.safeParse(patch).success).toBe(false);
  });
  it('requires a habit revision and separate skip semantics', () => {
    expect(HabitEntryCreateSchema.safeParse({ value: '1' }).success).toBe(
      false,
    );
    expect(
      HabitEntryCreateSchema.safeParse({
        habitRevision: 1,
        action: 'SKIP',
        value: '1',
      }).success,
    ).toBe(false);
    expect(
      HabitEntryPatchSchema.safeParse({
        habitRevision: 1,
        localDate: '2024-01-01',
      }).success,
    ).toBe(false);
  });
  it('bounds half-open ranges and forbids foreign ownership selectors', () => {
    const q = { from: '2024-01-01', to: '2025-01-01' };
    expect(HabitStatsQuerySchema.safeParse(q).success).toBe(true);
    for (const patch of [
      { to: q.from },
      { to: '2025-01-02' },
      { spaceId: randomUUID() },
    ])
      expect(HabitStatsQuerySchema.safeParse({ ...q, ...patch }).success).toBe(
        false,
      );
    expect(
      WaterSummaryQuerySchema.safeParse({ ...q, habitId: randomUUID() })
        .success,
    ).toBe(true);
  });
  it('bounds ordered unique routine links', () => {
    const id = randomUUID();
    expect(
      RoutineCreateSchema.safeParse({ title: 'Morning', habitIds: [id, id] })
        .success,
    ).toBe(false);
    expect(
      RoutineCreateSchema.safeParse({
        title: 'Morning',
        habitIds: Array.from({ length: 101 }, () => randomUUID()),
      }).success,
    ).toBe(false);
  });
});
