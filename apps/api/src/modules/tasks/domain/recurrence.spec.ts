import { describe, it, expect } from 'vitest';
import {
  matchesDate,
  resolveRecurrenceInstant,
  recurrenceBatch,
  localDateAt,
  nextDate,
} from './recurrence.js';
import type { RecurrenceDefinition, RecurrenceRule } from './recurrence.js';
const definition = (
  rule: RecurrenceRule,
  extra: Partial<RecurrenceDefinition> = {},
): RecurrenceDefinition => ({
  version: 1,
  startDate: '2024-01-01',
  endDate: null,
  localTime: '09:00',
  timezone: 'UTC',
  rule,
  exclusionDates: [],
  ...extra,
});
describe('recurrence calendar and explicit timezone policy', () => {
  it.each([
    ['2024-03-10T02:30:00', 'America/New_York', null],
    ['2024-11-03T01:30:00', 'America/New_York', '2024-11-03T05:30:00.000Z'],
    ['2024-10-06T02:15:00', 'Australia/Lord_Howe', null],
    ['2024-04-07T01:45:00', 'Australia/Lord_Howe', '2024-04-06T14:45:00.000Z'],
    ['2011-12-30T12:00:00', 'Pacific/Apia', null],
    ['2024-01-01T00:00:00', 'Asia/Tehran', '2023-12-31T20:30:00.000Z'],
    ['2024-01-01T00:00:00', 'Pacific/Kiritimati', '2023-12-31T10:00:00.000Z'],
  ])('resolves %s in %s deterministically', (key, zone, result) => {
    expect(resolveRecurrenceInstant(key, zone)?.toISOString() ?? null).toBe(
      result,
    );
  });
  it.each<[RecurrenceRule, string[], string[]]>([
    [
      { kind: 'DAILY', interval: 2 },
      ['2024-01-01', '2024-01-03'],
      ['2024-01-02'],
    ],
    [
      { kind: 'WEEKLY', interval: 2 },
      ['2024-01-01', '2024-01-15'],
      ['2024-01-08', '2024-01-02'],
    ],
    [
      { kind: 'WEEKDAYS', interval: 2, weekdays: [1, 5] },
      ['2024-01-01', '2024-01-05', '2024-01-15'],
      ['2024-01-08', '2024-01-02'],
    ],
    [
      { kind: 'MONTHLY_DATE', interval: 1, day: 31 },
      ['2024-01-31', '2024-03-31'],
      ['2024-02-29', '2024-04-30'],
    ],
    [
      { kind: 'MONTHLY_NTH', interval: 1, weekday: 1, nth: 5 },
      ['2024-01-29', '2024-04-29'],
      ['2024-02-26'],
    ],
    [
      { kind: 'MONTHLY_NTH', interval: 1, weekday: 5, nth: -1 },
      ['2024-01-26', '2024-02-23'],
      ['2024-01-19'],
    ],
    [
      { kind: 'YEARLY', interval: 1, month: 2, day: 29 },
      ['2024-02-29', '2028-02-29'],
      ['2025-02-28', '2100-02-28'],
    ],
    [
      { kind: 'INTERVAL', interval: 2, unit: 'MONTH' },
      ['2024-01-01', '2024-03-01'],
      ['2024-02-01'],
    ],
    [
      { kind: 'INTERVAL', interval: 3, unit: 'DAY' },
      ['2024-01-01', '2024-01-04'],
      ['2024-01-03'],
    ],
    [
      { kind: 'INTERVAL', interval: 3, unit: 'WEEK' },
      ['2024-01-01', '2024-01-22'],
      ['2024-01-08'],
    ],
    [
      { kind: 'INTERVAL', interval: 2, unit: 'YEAR' },
      ['2024-01-01', '2026-01-01'],
      ['2025-01-01'],
    ],
  ])('matches only the specified pattern %j', (rule, yes, no) => {
    const def = definition(rule);
    for (const day of yes) expect(matchesDate(def, day)).toBe(true);
    for (const day of no) expect(matchesDate(def, day)).toBe(false);
  });
  it('anchors interval month/year without clamping missing dates', () => {
    expect(
      matchesDate(
        definition(
          { kind: 'INTERVAL', interval: 1, unit: 'MONTH' },
          { startDate: '2024-01-31' },
        ),
        '2024-02-29',
      ),
    ).toBe(false);
    expect(
      matchesDate(
        definition(
          { kind: 'INTERVAL', interval: 1, unit: 'YEAR' },
          { startDate: '2024-02-29' },
        ),
        '2025-02-28',
      ),
    ).toBe(false);
  });
  it('bounds scanning even when a sparse schedule produces no instances', () => {
    const batch = recurrenceBatch(
      definition({ kind: 'YEARLY', interval: 1000, month: 2, day: 29 }),
      '2024-01-01',
      '9998-12-31',
      100,
    );
    expect(batch.scannedThrough).toBe('2024-12-31');
    expect(batch.nextDate).toBe('2025-01-01');
    expect(batch.candidates).toHaveLength(1);
  });
  it('paginates, honors exclusions/start/end and retains DST gap candidates', () => {
    const def = definition(
      { kind: 'DAILY', interval: 1 },
      {
        startDate: '2024-03-08',
        endDate: '2024-03-11',
        localTime: '02:30',
        timezone: 'America/New_York',
        exclusionDates: ['2024-03-09'],
      },
    );
    const first = recurrenceBatch(def, '2024-01-01', '2024-04-01', 1),
      second = recurrenceBatch(def, first.nextDate!, '2024-04-01', 100);
    expect(first.candidates[0]!.localDate).toBe('2024-03-08');
    expect(second.candidates.map((value) => value.localDate)).toEqual([
      '2024-03-10',
      '2024-03-11',
    ]);
    expect(second.candidates[0]!.instant).toBeNull();
    expect(second.nextDate).toBeNull();
  });
  it('uses explicit recorded timezone at midnight independently of account/host timezone', () => {
    const instant = new Date('2024-01-01T00:30:00Z');
    expect(localDateAt(instant, 'America/New_York')).toBe('2023-12-31');
    expect(localDateAt(instant, 'Asia/Tehran')).toBe('2024-01-01');
    expect(nextDate('2024-02-28')).toBe('2024-02-29');
  });
});
