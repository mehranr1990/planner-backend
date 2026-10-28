import { describe, it, expect } from 'vitest';
import {
  due,
  localDate,
  units,
  decimal,
  sum,
  stats,
  scheduleAt,
  currentSchedule,
} from './habits.js';
import type { Schedule, Entry, Rule } from './habits.js';
const v = (patch: Partial<Schedule> = {}): Schedule => ({
  id: 'schedule',
  habitId: 'habit',
  revision: 1,
  effectiveFrom: '2024-01-01',
  timezone: 'UTC',
  target: '1',
  status: 'ACTIVE',
  schedule: { version: 1, startDate: '2024-01-01', rule: { kind: 'DAILY' } },
  createdAt: '2024-01-01T00:00:00Z',
  ...patch,
});
const entry = (
  date: string,
  value = '1',
  patch: Partial<Entry> = {},
): Entry => ({
  id: date,
  revisionId: date + '-v1',
  habitId: 'habit',
  scheduleId: 'schedule',
  revision: 1,
  previousRevisionId: null,
  kind: 'CHECKBOX',
  state: 'RECORDED',
  localDate: date,
  value,
  timezone: 'UTC',
  recordedTimezone: 'UTC',
  recordedAt: '2024-02-01T12:00:00Z',
  actorUserId: 'owner',
  current: true,
  ...patch,
});
describe('P1-05 exact measures and deterministic calendar-date streaks', () => {
  it.each([
    [
      { kind: 'DAILY' },
      [
        '2024-01-01',
        '2024-01-02',
        '2024-01-03',
        '2024-01-04',
        '2024-01-05',
        '2024-01-06',
        '2024-01-07',
        '2024-01-08',
      ],
    ],
    [{ kind: 'WEEKLY' }, ['2024-01-01', '2024-01-08']],
    [
      { kind: 'WEEKDAYS', weekdays: [1, 3] },
      ['2024-01-01', '2024-01-03', '2024-01-08'],
    ],
    [{ kind: 'INTERVAL', days: 3 }, ['2024-01-01', '2024-01-04', '2024-01-07']],
  ] as [Rule, string[]][])(
    'matches %j from its Gregorian anchor',
    (rule, expected) => {
      const dates = Array.from(
        { length: 8 },
        (_, i) => '2024-01-' + String(i + 1).padStart(2, '0'),
      );
      expect(
        dates.filter((date) =>
          due({ version: 1, startDate: '2024-01-01', rule }, date),
        ),
      ).toEqual(expected);
      expect(
        due({ version: 1, startDate: '2024-01-01', rule }, '2023-12-31'),
      ).toBe(false);
    },
  );
  it('keeps fractional sums and large totals exact', () => {
    expect(decimal(units('0.1') + units('0.2'))).toBe('0.3');
    expect(decimal(units('999999999.999') * 2n)).toBe('1999999999.998');
    expect(decimal(units('0.001'))).toBe('0.001');
  });
  it('counts a threshold reached by multiple logs exactly once', () => {
    const r = stats(
      'habit',
      [v({ target: '0.3' })],
      [
        entry('2024-01-01', '0.1', { kind: 'QUANTITY' }),
        entry('2024-01-01', '0.2', { kind: 'QUANTITY', id: 'second' }),
      ],
      '2024-01-01',
      '2024-01-02',
      '2024-01-02',
    );
    expect(r.completed).toBe(1);
    expect(r.days[0]?.total).toBe('0.3');
    expect(r.currentStreak).toBe(1);
  });
  it('bridges rest days without counting them as successes', () => {
    const versions = [
      v({
        schedule: {
          version: 1,
          startDate: '2024-01-01',
          rule: { kind: 'WEEKLY' },
        },
      }),
    ];
    const r = stats(
      'habit',
      versions,
      [entry('2024-01-01'), entry('2024-01-08')],
      '2024-01-01',
      '2024-01-09',
      '2024-01-08',
    );
    expect(r.currentStreak).toBe(2);
    expect(r.completed).toBe(2);
    expect(r.due).toBe(2);
  });
  it('bridges explicit skips, excluding them from the denominator', () => {
    const r = stats(
      'habit',
      [v()],
      [
        entry('2024-01-01'),
        entry('2024-01-02', '0', { kind: 'SKIP', value: null }),
        entry('2024-01-03'),
      ],
      '2024-01-01',
      '2024-01-04',
      '2024-01-03',
    );
    expect(r.currentStreak).toBe(2);
    expect(r.skipped).toBe(1);
    expect(r.completionRate).toEqual({ numerator: 2, denominator: 2 });
  });
  it('suspends expectations while paused and resumes without fabricated successes', () => {
    const versions = [
      v(),
      v({
        id: 'paused',
        revision: 2,
        effectiveFrom: '2024-01-02',
        status: 'PAUSED',
      }),
      v({ id: 'resumed', revision: 3, effectiveFrom: '2024-01-04' }),
    ];
    const r = stats(
      'habit',
      versions,
      [entry('2024-01-01'), entry('2024-01-02'), entry('2024-01-04')],
      '2024-01-01',
      '2024-01-05',
      '2024-01-04',
    );
    expect(r.days.map((d) => d.outcome)).toEqual([
      'COMPLETED',
      'PAUSED',
      'PAUSED',
      'COMPLETED',
    ]);
    expect(r.currentStreak).toBe(2);
    expect(r.completed).toBe(2);
  });
  it('breaks on a missed past due day but not on the pending as-of date', () => {
    const rows = [entry('2024-01-01'), entry('2024-01-03')];
    const r = stats(
      'habit',
      [v()],
      rows,
      '2024-01-01',
      '2024-01-06',
      '2024-01-04',
    );
    expect(r.days.map((d) => d.outcome)).toEqual([
      'COMPLETED',
      'MISSED',
      'COMPLETED',
      'PENDING',
      'UPCOMING',
    ]);
    expect(r.currentStreak).toBe(1);
    expect(r.longestStreak).toBe(1);
    expect(r.missed).toBe(1);
  });
  it('recomputes after checkbox toggles and retains the original recorded context', () => {
    const before = entry('2024-01-02'),
      after = { ...before, revision: 2, revisionId: 'correction', value: '0' };
    expect(
      stats(
        'habit',
        [v()],
        [entry('2024-01-01'), before],
        '2024-01-01',
        '2024-01-03',
        '2024-01-03',
      ).currentStreak,
    ).toBe(2);
    const r = stats(
      'habit',
      [v()],
      [entry('2024-01-01'), { ...before, current: false }, after],
      '2024-01-01',
      '2024-01-03',
      '2024-01-03',
    );
    expect(r.currentStreak).toBe(0);
    expect(before.value).toBe('1');
    expect(before.recordedAt).toBe('2024-02-01T12:00:00Z');
  });
  it('uses confirmed newer schedule snapshots without mutating old entries or versions', () => {
    const original = v({ target: '2' }),
      revision = v({
        id: 'new',
        revision: 2,
        effectiveFrom: '2024-01-02',
        target: '3',
      }),
      rows = [
        entry('2024-01-01', '2', { kind: 'QUANTITY' }),
        entry('2024-01-02', '2', { kind: 'QUANTITY' }),
      ];
    expect(
      stats('habit', [original], rows, '2024-01-01', '2024-01-03', '2024-01-03')
        .completed,
    ).toBe(2);
    expect(
      stats(
        'habit',
        [original, revision],
        rows,
        '2024-01-01',
        '2024-01-03',
        '2024-01-03',
      ).completed,
    ).toBe(1);
    expect(original.target).toBe('2');
    expect(rows[1]?.value).toBe('2');
    expect(scheduleAt([original, revision], '2024-01-01')?.id).toBe(
      original.id,
    );
  });
  it('ignores void and superseded contributions but retains rest-day water logs', () => {
    const rows = [
      entry('2024-01-01', '250', { kind: 'QUANTITY' }),
      entry('2024-01-01', '100', { kind: 'QUANTITY', state: 'VOID' }),
      entry('2024-01-01', '500', { kind: 'QUANTITY', current: false }),
    ];
    expect(decimal(sum(rows))).toBe('250');
    expect(
      stats(
        'habit',
        [v({ status: 'ARCHIVED' })],
        rows,
        '2024-01-01',
        '2024-01-02',
        '2024-01-02',
      ).completed,
    ).toBe(0);
  });
  it.each([
    '2024-03-10T06:59:00Z',
    '2024-03-10T07:01:00Z',
    '2024-11-03T05:30:00Z',
    '2024-11-03T06:30:00Z',
  ])('keeps date-only expectations stable across DST at %s', (instant) => {
    const date = localDate(new Date(instant), 'America/New_York');
    expect(date).toBe(instant.slice(0, 10));
    expect(due(v().schedule, date)).toBe(true);
  });
  it('uses the saved IANA zone around midnight and travel without rewriting dates', () => {
    const now = new Date('2024-01-02T00:30:00Z');
    expect(localDate(now, 'America/Los_Angeles')).toBe('2024-01-01');
    expect(localDate(now, 'Asia/Tokyo')).toBe('2024-01-02');
    const old = v({ timezone: 'America/Los_Angeles' }),
      future = v({
        id: 'future',
        revision: 2,
        effectiveFrom: '2024-01-03',
        timezone: 'Asia/Tokyo',
      });
    expect(currentSchedule([old, future], now)?.id).toBe(old.id);
  });
  it('has no due-day distortion on leap day or local midnight', () => {
    expect(
      due(
        {
          version: 1,
          startDate: '2024-02-28',
          rule: { kind: 'INTERVAL', days: 2 },
        },
        '2024-03-01',
      ),
    ).toBe(true);
    expect(localDate(new Date('2024-03-01T00:00:00Z'), 'UTC')).toBe(
      '2024-03-01',
    );
  });
});
