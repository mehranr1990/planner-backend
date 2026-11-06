import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  TeamPlanCreateSchema,
  TeamWorkItemCreateSchema,
  TeamCalendarRangeQuerySchema,
} from './team-work.js';
it('weekly periods are seven civil dates and sprints are bounded optional periods', () => {
  const p = {
    id: randomUUID(),
    kind: 'WEEK',
    title: 'Week',
    startDate: '2030-01-07',
    endDate: '2030-01-14',
    timezone: 'Asia/Tehran',
  };
  expect(TeamPlanCreateSchema.safeParse(p).success).toBe(true);
  for (const patch of [
    { endDate: '2030-01-13' },
    { endDate: '2030-01-07' },
    { timezone: 'Invalid/Zone' },
    { companyId: randomUUID() },
  ])
    expect(TeamPlanCreateSchema.safeParse({ ...p, ...patch }).success).toBe(
      false,
    );
  expect(
    TeamPlanCreateSchema.safeParse({
      ...p,
      kind: 'SPRINT',
      endDate: '2030-02-01',
    }).success,
  ).toBe(true);
  expect(
    TeamPlanCreateSchema.safeParse({
      ...p,
      kind: 'SPRINT',
      endDate: '2031-01-01',
    }).success,
  ).toBe(false);
});
it('work references are typed and reject authority overposting; Calendar retains existing range validation', () => {
  const input = {
    id: randomUUID(),
    target: { kind: 'TASK', spaceId: randomUUID(), id: randomUUID() },
    sourceRevision: 1,
  };
  expect(TeamWorkItemCreateSchema.parse(input).planId).toBeNull();
  for (const patch of [
    { ownerUserId: randomUUID() },
    { sourceRevision: 0 },
    { target: { kind: 'PERSONAL', spaceId: randomUUID(), id: randomUUID() } },
  ])
    expect(
      TeamWorkItemCreateSchema.safeParse({ ...input, ...patch }).success,
    ).toBe(false);
  expect(
    TeamCalendarRangeQuerySchema.safeParse({
      from: '2030-01-01',
      to: '2030-01-07',
      timezone: 'UTC',
      cursor: 'signed',
    }).success,
  ).toBe(true);
  expect(
    TeamCalendarRangeQuerySchema.safeParse({
      from: '2030-01-01',
      to: '2031-01-07',
      timezone: 'UTC',
    }).success,
  ).toBe(false);
});
