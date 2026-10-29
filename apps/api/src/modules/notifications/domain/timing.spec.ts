import { describe, it, expect } from 'vitest';
import {
  resolveLocal,
  firstValidLocal,
  quietUntil,
  dueOn,
  countThrough,
  retryAt,
  localParts,
} from './timing.js';
import type { ReminderSchedule } from './timing.js';
const s = (
  frequency: ReminderSchedule['frequency'],
  extra: Partial<ReminderSchedule> = {},
): ReminderSchedule => ({
  version: 1,
  frequency,
  interval: 1,
  weekdays: [],
  until: null,
  count: null,
  exclusions: [],
  ...extra,
});
describe('P1-10 deterministic intended-time and bounded retry rules', () => {
  it('records a New York spring gap without moving its time', () =>
    expect(resolveLocal('2024-03-10', '02:30', 'America/New_York')).toEqual({
      instant: null,
      ambiguous: false,
    }));
  it('selects the earlier fold', () =>
    expect(resolveLocal('2024-11-03', '01:30', 'America/New_York')).toEqual({
      instant: new Date('2024-11-03T05:30:00Z'),
      ambiguous: true,
    }));
  it('handles a half-hour spring gap', () =>
    expect(
      resolveLocal('2024-10-06', '02:15', 'Australia/Lord_Howe').instant,
    ).toBeNull());
  it('selects earlier half-hour folds', () =>
    expect(
      resolveLocal(
        '2024-04-07',
        '01:45',
        'Australia/Lord_Howe',
      ).instant?.toISOString(),
    ).toBe('2024-04-06T14:45:00.000Z'));
  it('defers across midnight and a missing quiet end', () =>
    expect(
      quietUntil(
        new Date('2024-03-10T06:30:00Z'),
        'America/New_York',
        '22:00',
        '02:30',
        false,
      ).toISOString(),
    ).toBe('2024-03-10T07:00:00.000Z'));
  it('first valid local time is explicit', () =>
    expect(
      firstValidLocal('2024-03-10', '02:30', 'America/New_York').toISOString(),
    ).toBe('2024-03-10T07:00:00.000Z'));
  it('defers quiet hours through the earlier fall fold', () =>
    expect(
      quietUntil(
        new Date('2024-11-03T04:30:00Z'),
        'America/New_York',
        '22:00',
        '01:30',
        false,
      ).toISOString(),
    ).toBe('2024-11-03T05:30:00.000Z'));
  it('never moves a quiet end back before now in the repeated hour', () =>
    expect(
      quietUntil(
        new Date('2024-11-03T06:15:00Z'),
        'America/New_York',
        '22:00',
        '01:30',
        false,
      ).toISOString(),
    ).toBe('2024-11-03T06:15:00.000Z'));
  it('urgent bypass is explicit', () =>
    expect(
      quietUntil(
        new Date('2024-01-01T23:00Z'),
        'UTC',
        '22:00',
        '07:00',
        true,
      ).toISOString(),
    ).toBe('2024-01-01T23:00:00.000Z'));
  it('rejects equal quiet endpoints', () =>
    expect(() =>
      quietUntil(new Date(), 'UTC', '00:00', '00:00', false),
    ).toThrow());
  it('uses account timezone for local midnight attribution', () =>
    expect(
      localParts(new Date('2024-01-01T21:00:00Z'), 'Asia/Tehran').date,
    ).toBe('2024-01-02'));
  it.each([1, 2, 3, 4])('exact bounded backoff for attempt %i', (attempt) =>
    expect(retryAt(new Date(0), attempt)?.getTime()).toBe(
      [60000, 300000, 900000, 3600000][attempt - 1],
    ),
  );
  it('stops at five attempts', () => expect(retryAt(new Date(), 5)).toBeNull());
  it('weekly anchor and selected weekdays differ explicitly', () => {
    expect(dueOn('2024-01-08', '2024-01-01', s('WEEKLY'))).toBe(true);
    expect(
      dueOn(
        '2024-01-03',
        '2024-01-01',
        s('SELECTED_WEEKDAYS', { weekdays: [1, 3] }),
      ),
    ).toBe(true);
    expect(
      dueOn(
        '2024-01-04',
        '2024-01-01',
        s('SELECTED_WEEKDAYS', { weekdays: [1, 3] }),
      ),
    ).toBe(false);
  });
  it('interval/count/exclusions are deterministic', () => {
    const rule = s('INTERVAL', {
      interval: 2,
      count: 2,
      exclusions: ['2024-01-03'],
    });
    expect(dueOn('2024-01-03', '2024-01-01', rule)).toBe(false);
    expect(dueOn('2024-01-05', '2024-01-01', rule)).toBe(true);
    expect(dueOn('2024-01-07', '2024-01-01', rule)).toBe(false);
  });
  it('month-end skips absent dates', () => {
    expect(dueOn('2024-02-29', '2024-01-31', s('MONTHLY'))).toBe(false);
    expect(dueOn('2024-03-31', '2024-01-31', s('MONTHLY', { count: 2 }))).toBe(
      true,
    );
    expect(countThrough('2024-03-30', '2024-01-31', s('MONTHLY'))).toBe(1);
  });
  it('leap birthdays skip non-leap years', () => {
    expect(dueOn('2025-02-28', '2024-02-29', s('YEARLY'))).toBe(false);
    expect(dueOn('2028-02-29', '2024-02-29', s('YEARLY', { count: 2 }))).toBe(
      true,
    );
    expect(countThrough('2028-02-28', '2024-02-29', s('YEARLY'))).toBe(1);
  });
  it('until is inclusive', () => {
    expect(
      dueOn('2024-01-02', '2024-01-01', s('DAILY', { until: '2024-01-02' })),
    ).toBe(true);
    expect(
      dueOn('2024-01-03', '2024-01-01', s('DAILY', { until: '2024-01-02' })),
    ).toBe(false);
  });
});
