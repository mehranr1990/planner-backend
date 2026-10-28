import { describe, it, expect } from 'vitest';
import {
  CalendarEventCreateSchema,
  CalendarEventPatchSchema,
  CalendarRangeQuerySchema,
  TimeBlockCreateSchema,
  CalendarSeriesEditSchema,
} from './calendar.js';
import { randomUUID } from 'node:crypto';
describe('P1-04 strict calendar contracts', () => {
  const schedule = {
    kind: 'ALL_DAY',
    timezone: 'Asia/Tehran',
    startDate: '2028-02-29',
    endDate: '2028-03-01',
  };
  it('normalizes titles and keeps exclusive Gregorian dates', () => {
    expect(
      CalendarEventCreateSchema.parse({ title: ' Event ', schedule }),
    ).toEqual({ title: 'Event', schedule });
  });
  it.each([
    { ...schedule, endDate: '2028-02-29' },
    { ...schedule, startDate: '2027-02-29' },
    { ...schedule, timezone: 'made/up' },
    { ...schedule, timezone: '+03:30' },
    { ...schedule, endDate: '2030-01-01' },
  ])('rejects invalid date/zone/duration %#', (s) =>
    expect(
      CalendarEventCreateSchema.safeParse({ title: 'Event', schedule: s })
        .success,
    ).toBe(false),
  );
  it('prevents overposting and empty mutations', () => {
    expect(
      CalendarEventCreateSchema.safeParse({
        title: 'Event',
        schedule,
        spaceId: randomUUID(),
      }).success,
    ).toBe(false);
    expect(CalendarEventPatchSchema.safeParse({}).success).toBe(false);
    expect(CalendarEventPatchSchema.safeParse({ revision: 1 }).success).toBe(
      false,
    );
  });
  it('requires timed blocks and matching Task revision snapshots', () => {
    const timed = {
      kind: 'TIMED',
      timezone: 'UTC',
      localStart: '2030-01-01T09:00',
      localEnd: '2030-01-01T10:00',
    };
    expect(
      TimeBlockCreateSchema.safeParse({ title: 'Work', schedule }).success,
    ).toBe(false);
    expect(
      TimeBlockCreateSchema.safeParse({
        title: 'Work',
        schedule: timed,
        taskId: randomUUID(),
      }).success,
    ).toBe(false);
    expect(
      TimeBlockCreateSchema.safeParse({
        title: 'Work',
        schedule: timed,
        taskRevision: 1,
      }).success,
    ).toBe(false);
    expect(
      TimeBlockCreateSchema.safeParse({
        title: 'Work',
        schedule: timed,
        taskId: randomUUID(),
        taskRevision: 1,
      }).success,
    ).toBe(true);
  });
  it('bounds ranges, cursors, query fields and page sizes', () => {
    const q = { from: '2030-01-01', to: '2030-01-02', timezone: 'UTC' };
    expect(CalendarRangeQuerySchema.parse(q)).toEqual(q);
    for (const patch of [
      { to: q.from },
      { to: '2030-05-01' },
      { limit: '101' },
      { cursor: 'x'.repeat(1025) },
      { spaceId: randomUUID() },
    ])
      expect(
        CalendarRangeQuerySchema.safeParse({ ...q, ...patch }).success,
      ).toBe(false);
  });
  it('requires explicit series scope and occurrence concurrency', () => {
    expect(
      CalendarSeriesEditSchema.safeParse({
        scope: 'THIS_OCCURRENCE',
        recurrenceKey: '2030-01-01T09:00',
        patch: { title: 'x' },
      }).success,
    ).toBe(false);
    expect(
      CalendarSeriesEditSchema.safeParse({
        scope: 'THIS_OCCURRENCE',
        recurrenceKey: '2030-01-01T09:00',
        exceptionRevision: 0,
        patch: { title: 'x' },
      }).success,
    ).toBe(true);
  });
});
