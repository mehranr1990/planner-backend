import { describe, it, expect } from 'vitest';
import {
  addDays,
  weekday,
  localToday,
  disposition,
  allocate,
} from './planning.js';
import type { PlanningTask, Item } from './planning.js';
const task: PlanningTask = {
  id: 'task',
  revision: 3,
  title: 'Work',
  status: 'OPEN',
  dueAt: null,
  scheduledDate: null,
  deleted: false,
  isMaster: false,
  occurrenceState: null,
};
const item = (minutes: number | null) => ({ plannedMinutes: minutes }) as Item;
describe('personal planning invariants', () => {
  it.each([
    ['2024-01-01T00:30:00Z', 'America/New_York', '2023-12-31'],
    ['2024-01-01T00:30:00Z', 'Asia/Tehran', '2024-01-01'],
    ['2024-03-10T04:59:59Z', 'America/New_York', '2024-03-09'],
    ['2024-03-10T05:00:00Z', 'America/New_York', '2024-03-10'],
    ['2024-11-03T05:30:00Z', 'America/New_York', '2024-11-03'],
    ['2024-11-03T06:30:00Z', 'America/New_York', '2024-11-03'],
  ])('uses explicit zone at midnight and DST: %s %s', (instant, zone, date) => {
    expect(localToday(new Date(instant), zone)).toBe(date);
  });
  it('keeps calendar dates/weekdays independent of host and crosses leap/year boundaries', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-12-30', 6)).toBe('2025-01-05');
    expect(weekday('2024-12-30')).toBe(1);
    expect(weekday('2025-01-05')).toBe(0);
  });
  it.each([
    [undefined, undefined, 'BLOCKED'],
    [{ ...task, isMaster: true }, undefined, 'BLOCKED'],
    [{ ...task, deleted: true }, undefined, 'DELETED'],
    [{ ...task, status: 'DONE' }, undefined, 'COMPLETED'],
    [{ ...task, status: 'CANCELED' }, undefined, 'CANCELED'],
    [
      { ...task, status: 'CANCELED', occurrenceState: 'SKIPPED' },
      undefined,
      'SKIPPED',
    ],
    [task, 2, 'STALE'],
    [task, 3, 'READY'],
    [task, undefined, 'READY'],
  ] as Array<[PlanningTask | undefined, number | undefined, string]>)(
    'classifies state without mutating Task (%j)',
    (snapshot, selectedRevision, expected) => {
      const before = JSON.stringify(snapshot);
      expect(disposition(snapshot, selectedRevision)).toBe(expected);
      expect(JSON.stringify(snapshot)).toBe(before);
    },
  );
  it('reports unknown allocation/availability and advisory excess without inferred effort', () => {
    expect(allocate([item(60), item(null)], 120)).toMatchObject({
      knownPlannedMinutes: 60,
      unknownAllocations: 1,
      remainingMinutes: null,
      overCapacity: false,
    });
    expect(allocate([item(60), item(30)], 60)).toMatchObject({
      remainingMinutes: -30,
      overCapacity: true,
    });
    expect(allocate([item(60)], null)).toMatchObject({
      availableMinutes: null,
      remainingMinutes: null,
      overCapacity: null,
    });
    expect(allocate([item(0)], 0)).toMatchObject({
      remainingMinutes: 0,
      overCapacity: false,
    });
  });
});
