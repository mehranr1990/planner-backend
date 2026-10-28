import { describe, it, expect } from 'vitest';
import {
  PlanningAvailabilitySchema,
  SelectionPutSchema,
  DayReorderSchema,
  CapacityQuerySchema,
  PlanningReviewCreateSchema,
  PlanningReviewQuerySchema,
  RolloverCommitSchema,
  RolloverPreviewRequestSchema,
} from './planning.js';
const id = 'e9130314-064f-486b-810a-c4d7e70c66ed';
describe('P1-03 strict planning contracts', () => {
  it.each(
    [
      [1, 2],
      [-1, 0, 0, 0, 0, 0, 0],
      [1441, 0, 0, 0, 0, 0, 0],
      [0.5, 0, 0, 0, 0, 0, 0],
      ['8', 0, 0, 0, 0, 0, 0],
    ].map((minutes) => ({ minutes })),
  )('rejects invalid configured availability %j', ({ minutes }) => {
    expect(
      PlanningAvailabilitySchema.safeParse({
        version: 1,
        minutesByWeekday: minutes,
      }).success,
    ).toBe(false);
  });
  it('distinguishes zero minutes from unknown and forbids ownership/date overposting', () => {
    expect(
      PlanningAvailabilitySchema.safeParse({
        version: 1,
        minutesByWeekday: [0, 60, 120, 240, 480, 0, 1440],
      }).success,
    ).toBe(true);
    for (const value of [0, null, 1440])
      expect(
        SelectionPutSchema.safeParse({ taskRevision: 1, plannedMinutes: value })
          .success,
      ).toBe(true);
    for (const value of [
      { taskRevision: 0, plannedMinutes: 1 },
      { taskRevision: 1, plannedMinutes: -1 },
      { taskRevision: 1, plannedMinutes: 60, dueAt: '2026-10-28T00:00:00Z' },
      { taskRevision: 1, plannedMinutes: null, spaceId: id },
    ])
      expect(SelectionPutSchema.safeParse(value).success).toBe(false);
  });
  it('bounds order, capacity and private reflection query definitions', () => {
    expect(DayReorderSchema.safeParse({ taskIds: [id, id] }).success).toBe(
      false,
    );
    expect(
      DayReorderSchema.safeParse({ taskIds: Array(101).fill(id) }).success,
    ).toBe(false);
    expect(
      CapacityQuerySchema.safeParse({
        date: '2026-10-28',
        weekStartDate: '2026-10-26',
      }).success,
    ).toBe(false);
    expect(
      PlanningReviewCreateSchema.safeParse({
        kind: 'MORNING',
        localDate: '2026-10-28',
        reflection: 'private\0text',
      }).success,
    ).toBe(false);
    expect(
      PlanningReviewCreateSchema.safeParse({
        kind: 'MORNING',
        localDate: '2025-02-29',
        reflection: '',
      }).success,
    ).toBe(false);
    expect(
      PlanningReviewQuerySchema.safeParse({
        from: '2024-01-01',
        to: '2026-01-01',
      }).success,
    ).toBe(false);
    expect(
      PlanningReviewQuerySchema.safeParse({ from: '2026-10-28' }).success,
    ).toBe(false);
  });
  it('requires explicit rollover dates, snapshots and unique authorized selections', () => {
    const input = {
      fromDate: '2026-10-27',
      toDate: '2026-10-28',
      sourceRevision: 2,
      targetRevision: 0,
      settingsRevision: 1,
      mode: 'MOVE',
      items: [{ taskId: id, taskRevision: 1, itemRevision: 1 }],
    };
    expect(RolloverCommitSchema.safeParse(input).success).toBe(true);
    expect(
      RolloverCommitSchema.safeParse({
        ...input,
        items: [...input.items, ...input.items],
      }).success,
    ).toBe(false);
    expect(
      RolloverCommitSchema.safeParse({ ...input, mode: 'AUTO' }).success,
    ).toBe(false);
    expect(
      RolloverPreviewRequestSchema.safeParse({
        fromDate: '2026-10-28',
        toDate: '2026-10-28',
      }).success,
    ).toBe(false);
  });
});
