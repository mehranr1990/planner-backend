import { describe, expect, it } from 'vitest';
import {
  dayBoundary,
  localKey,
  normalizeSchedule,
  overlaps,
  wallInstant,
} from './calendar.js';
describe('calendar civil dates, instants and advisory intervals', () => {
  it('keeps all-day exclusive dates independent of instants', () => {
    expect(
      normalizeSchedule({
        kind: 'ALL_DAY',
        timezone: 'Asia/Tehran',
        startDate: '2028-02-29',
        endDate: '2028-03-01',
      }),
    ).toEqual({
      kind: 'ALL_DAY',
      timezone: 'Asia/Tehran',
      startDate: '2028-02-29',
      endDate: '2028-03-01',
      startAt: null,
      endAt: null,
    });
  });
  it('rejects a spring gap instead of shifting an explicit event', () => {
    expect(wallInstant('2027-03-14T02:30', 'America/New_York')).toBeNull();
    expect(() =>
      normalizeSchedule({
        kind: 'TIMED',
        timezone: 'America/New_York',
        localStart: '2027-03-14T02:30',
        localEnd: '2027-03-14T04:00',
      }),
    ).toThrow('DST_GAP');
  });
  it('selects the earlier repeated instant deterministically', () => {
    expect(
      wallInstant('2027-11-07T01:30', 'America/New_York')?.toISOString(),
    ).toBe('2027-11-07T05:30:00.000Z');
  });
  it('retains timezone and uses elapsed UTC duration across DST', () => {
    const event = normalizeSchedule({
      kind: 'TIMED',
      timezone: 'America/New_York',
      localStart: '2027-03-14T01:30',
      localEnd: '2027-03-14T03:30',
    });
    expect(event.startAt).toBe('2027-03-14T06:30:00.000Z');
    expect(event.endAt).toBe('2027-03-14T07:30:00.000Z');
    expect(localKey(new Date(event.startAt!), 'Asia/Tokyo')).toBe(
      '2027-03-14T15:30:00',
    );
    expect(event.timezone).toBe('America/New_York');
  });
  it('uses true local-midnight boundaries on 23- and 25-hour days', () => {
    const duration = (a: string, b: string) =>
      (dayBoundary(b, 'America/New_York') -
        dayBoundary(a, 'America/New_York')) /
      3600000;
    expect(duration('2027-03-14', '2027-03-15')).toBe(23);
    expect(duration('2027-11-07', '2027-11-08')).toBe(25);
  });
  it('represents a skipped civil date as a zero-duration range', () => {
    expect(dayBoundary('2011-12-30', 'Pacific/Apia')).toBe(
      dayBoundary('2011-12-31', 'Pacific/Apia'),
    );
  });
  it('allows touching and detects containment and partial overlaps', () => {
    expect(overlaps({ start: 1, end: 2 }, { start: 2, end: 3 })).toBe(false);
    expect(overlaps({ start: 1, end: 5 }, { start: 2, end: 3 })).toBe(true);
    expect(overlaps({ start: 1, end: 3 }, { start: 2, end: 4 })).toBe(true);
    expect(overlaps({ start: 2, end: 2 }, { start: 1, end: 3 })).toBe(false);
  });
});
