import { describe, it, expect } from 'vitest';
import {
  midnight,
  periodDates,
  localDate,
  dueOn,
  validRange,
} from './dates.js';
import type { DateSchedule } from './dates.js';
const schedule = (
  frequency: DateSchedule['frequency'],
  extra: Partial<DateSchedule> = {},
): DateSchedule => ({
  version: 1,
  frequency,
  interval: 1,
  weekdays: [],
  until: null,
  count: null,
  exclusions: [],
  ...extra,
});
describe('Finance dates and periods', () => {
  it('bounds spring/fall days at local midnight', () => {
    expect(
      midnight('2024-03-11', 'America/New_York').getTime() -
        midnight('2024-03-10', 'America/New_York').getTime(),
    ).toBe(23 * 3600000);
    expect(
      midnight('2024-11-04', 'America/New_York').getTime() -
        midnight('2024-11-03', 'America/New_York').getTime(),
    ).toBe(25 * 3600000);
  });
  it('chooses first valid gap midnight and earlier repeated midnight', () => {
    expect(midnight('2018-11-04', 'America/Sao_Paulo').toISOString()).toBe(
      '2018-11-04T03:00:00.000Z',
    );
    expect(midnight('2024-11-03', 'America/Havana').toISOString()).toBe(
      '2024-11-03T04:00:00.000Z',
    );
    expect(midnight('2011-12-30', 'Pacific/Apia')).toEqual(
      midnight('2011-12-31', 'Pacific/Apia'),
    );
  });
  it('computes saved Gregorian and Jalali month boundaries', () => {
    expect(periodDates('2024-02-29', 'MONTHLY', 'GREGORIAN', 1)).toEqual({
      startDate: '2024-02-01',
      endDate: '2024-03-01',
    });
    expect(periodDates('2024-03-25', 'MONTHLY', 'JALALI', 6)).toEqual({
      startDate: '2024-03-20',
      endDate: '2024-04-20',
    });
  });
  it('computes week preference and explicit custom windows', () => {
    expect(periodDates('2024-03-13', 'WEEKLY', 'GREGORIAN', 6)).toEqual({
      startDate: '2024-03-09',
      endDate: '2024-03-16',
    });
    expect(() => validRange('2024-01-01', '2026-01-01')).toThrow();
    expect(() => periodDates('2024-01-01', 'CUSTOM', 'GREGORIAN', 1)).toThrow();
  });
  it('skips nonexistent month days and nonleap years', () => {
    expect(dueOn('2024-02-29', '2024-01-31', schedule('MONTHLY'))).toBe(false);
    expect(dueOn('2024-03-31', '2024-01-31', schedule('MONTHLY'))).toBe(true);
    expect(dueOn('2025-02-28', '2024-02-29', schedule('YEARLY'))).toBe(false);
    expect(dueOn('2028-02-29', '2024-02-29', schedule('YEARLY'))).toBe(true);
  });
  it('matches daily/weekly/weekday/interval rules, exclusions, end and count', () => {
    expect(dueOn('2024-01-08', '2024-01-01', schedule('WEEKLY'))).toBe(true);
    expect(
      dueOn(
        '2024-01-03',
        '2024-01-01',
        schedule('SELECTED_WEEKDAYS', { weekdays: [3] }),
      ),
    ).toBe(true);
    expect(
      dueOn('2024-01-05', '2024-01-01', schedule('INTERVAL', { interval: 2 })),
    ).toBe(true);
    expect(
      dueOn(
        '2024-01-03',
        '2024-01-01',
        schedule('DAILY', { exclusions: ['2024-01-03'] }),
      ),
    ).toBe(false);
    expect(
      dueOn('2024-01-03', '2024-01-01', schedule('DAILY', { count: 2 })),
    ).toBe(false);
    expect(
      dueOn(
        '2024-01-03',
        '2024-01-01',
        schedule('DAILY', { until: '2024-01-02' }),
      ),
    ).toBe(false);
  });
  it('counts finite schedules with exclusions and long downtime without day scans', () => {
    expect(
      dueOn(
        '2024-01-04',
        '2024-01-01',
        schedule('DAILY', { count: 3, exclusions: ['2024-01-02'] }),
      ),
    ).toBe(true);
    expect(
      dueOn(
        '2024-01-05',
        '2024-01-01',
        schedule('DAILY', { count: 3, exclusions: ['2024-01-02'] }),
      ),
    ).toBe(false);
    expect(
      dueOn(
        '2024-01-08',
        '2024-01-01',
        schedule('SELECTED_WEEKDAYS', { count: 3, weekdays: [1, 3] }),
      ),
    ).toBe(true);
    expect(
      dueOn(
        '2024-01-10',
        '2024-01-01',
        schedule('SELECTED_WEEKDAYS', { count: 3, weekdays: [1, 3] }),
      ),
    ).toBe(false);
    expect(
      dueOn('2024-03-31', '2024-01-31', schedule('MONTHLY', { count: 2 })),
    ).toBe(true);
    expect(
      dueOn('2024-05-31', '2024-01-31', schedule('MONTHLY', { count: 2 })),
    ).toBe(false);
    expect(
      dueOn('2028-02-29', '2024-02-29', schedule('YEARLY', { count: 2 })),
    ).toBe(true);
    expect(
      dueOn('2032-02-29', '2024-02-29', schedule('YEARLY', { count: 2 })),
    ).toBe(false);
    expect(
      dueOn('2024-01-01', '1900-01-01', schedule('DAILY', { count: 10000 })),
    ).toBe(false);
  });
  it('attributes account travel at the actual instant without changing stored dates', () => {
    const instant = new Date('2024-01-01T00:15:00Z');
    expect(localDate(instant, 'America/Los_Angeles')).toBe('2023-12-31');
    expect(localDate(instant, 'Asia/Tehran')).toBe('2024-01-01');
  });
});
