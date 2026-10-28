import { describe, it, expect } from 'vitest';
import { normalizeSchedule } from './calendar.js';
import { expand } from './expansion.js';
import type { Event, Version } from './model.js';
import type { RecurrenceRule } from './recurrence.js';
describe('calendar normalized virtual identities, versions and exceptions', () => {
  const series: Event = {
    id: 'series',
    spaceId: 'space',
    createdByUserId: 'actor',
    revision: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    deletedAt: null,
    title: 'Original',
    status: 'ACTIVE',
    schedule: normalizeSchedule({
      kind: 'TIMED',
      timezone: 'America/New_York',
      localStart: '2027-03-13T02:30',
      localEnd: '2027-03-13T03:30',
    }),
    description: null,
    seriesId: null,
    recurrenceKey: null,
    previousSeriesId: null,
    splitBefore: null,
    recurrence: null,
  };
  const version = (
    rule: RecurrenceRule = { kind: 'DAILY', interval: 1 },
  ): Version => ({
    id: 'version',
    eventId: series.id,
    revision: 1,
    fromKey: '2027-03-13T02:30',
    untilKey: null,
    identityTime: '02:30',
    definition: {
      version: 1,
      startDate: '2027-03-13',
      endDate: null,
      localTime: '02:30',
      timezone: 'America/New_York',
      rule,
      exclusionDates: [],
    },
    title: 'Original',
    description: null,
    status: 'ACTIVE',
    schedule: series.schedule,
  });
  it('emits one explicit DST gap without an instant and resumes with unchanged wall context', () => {
    const items = expand(series, [version()], [], {
      from: '2027-03-13',
      to: '2027-03-16',
      timezone: 'UTC',
    });
    expect(
      items.map((i) => [
        i.recurrenceKey,
        i.status,
        i.reason,
        i.schedule.startAt,
      ]),
    ).toEqual([
      ['2027-03-13T02:30', 'ACTIVE', null, '2027-03-13T07:30:00.000Z'],
      ['2027-03-14T02:30', 'SKIPPED', 'DST_GAP', null],
      ['2027-03-15T02:30', 'ACTIVE', null, '2027-03-15T06:30:00.000Z'],
    ]);
  });
  it('retains elapsed duration when fall-back makes the local end precede local start', () => {
    const v = version();
    v.definition.localTime = '01:30';
    v.schedule = normalizeSchedule({
      kind: 'TIMED',
      timezone: 'America/New_York',
      localStart: '2027-03-13T01:30',
      localEnd: '2027-03-13T02:15',
    });
    const row = expand(series, [v], [], {
      from: '2027-11-07',
      to: '2027-11-08',
      timezone: 'UTC',
    })[0]!;
    expect(row.schedule.startAt).toBe('2027-11-07T05:30:00.000Z');
    expect(row.schedule.endAt).toBe('2027-11-07T06:15:00.000Z');
    expect(row.schedule.kind === 'TIMED' && row.schedule.localEnd).toBe(
      '2027-11-07T01:15',
    );
  });
  it('includes moved exceptions by actual interval and suppresses the original slot', () => {
    const exception: Event = {
      ...series,
      id: 'exception',
      seriesId: series.id,
      recurrenceKey: '2027-03-13T02:30',
      schedule: normalizeSchedule({
        kind: 'TIMED',
        timezone: 'UTC',
        localStart: '2027-04-01T09:00',
        localEnd: '2027-04-01T10:00',
      }),
    };
    expect(
      expand(series, [version()], [exception], {
        from: '2027-03-13',
        to: '2027-03-14',
        timezone: 'UTC',
      }),
    ).toHaveLength(0);
    const rows = expand(series, [version()], [exception], {
      from: '2027-04-01',
      to: '2027-04-02',
      timezone: 'UTC',
    });
    expect(rows.find((r) => r.resourceId === 'exception')?.identity).toBe(
      'series/2027-03-13T02:30',
    );
  });
  it('preserves earlier content and identity time after future schedule changes', () => {
    const old = version(),
      next = version();
    old.untilKey = '2027-03-15T02:30';
    next.fromKey = old.untilKey;
    next.title = 'Revised';
    next.definition.localTime = '09:00';
    const rows = expand({ ...series, revision: 2 }, [old, next], [], {
      from: '2027-03-13',
      to: '2027-03-16',
      timezone: 'UTC',
    });
    expect(rows.map((r) => r.title)).toEqual([
      'Original',
      'Original',
      'Revised',
    ]);
    expect(rows[2]?.identity).toBe('series/2027-03-15T02:30');
    expect(rows[2]?.schedule.startAt).toBe('2027-03-15T13:00:00.000Z');
  });
  it.each([
    [
      { kind: 'MONTHLY_DATE', interval: 1, day: 31 },
      '2027-01-31',
      '2027-04-01',
      ['2027-01-31', '2027-03-31'],
    ],
    [
      { kind: 'YEARLY', interval: 1, month: 2, day: 29 },
      '2024-02-29',
      '2029-01-01',
      ['2024-02-29', '2028-02-29'],
    ],
    [
      { kind: 'MONTHLY_NTH', interval: 1, weekday: 1, nth: -1 },
      '2027-01-01',
      '2027-03-01',
      ['2027-01-25', '2027-02-22'],
    ],
    [
      { kind: 'WEEKDAYS', interval: 1, weekdays: [1, 3] },
      '2027-01-01',
      '2027-01-08',
      ['2027-01-04', '2027-01-06'],
    ],
    [
      { kind: 'INTERVAL', interval: 2, unit: 'DAY' },
      '2027-01-01',
      '2027-01-06',
      ['2027-01-01', '2027-01-03', '2027-01-05'],
    ],
  ] as [RecurrenceRule, string, string, string[]][])(
    'matches approved %j patterns without short-month shifts',
    (rule, from, to, dates) => {
      const v = version(rule);
      v.fromKey = from + 'T02:30';
      v.definition.startDate = from;
      expect(
        expand(series, [v], [], { from, to, timezone: 'UTC' }).map((r) =>
          r.recurrenceKey!.slice(0, 10),
        ),
      ).toEqual(dates);
    },
  );
  it('retains explicit cancellations and exclusions across a split', () => {
    const v = version();
    v.definition.exclusionDates = ['2027-03-15'];
    const exception: Event = {
      ...series,
      id: 'canceled',
      status: 'CANCELED',
      seriesId: series.id,
      recurrenceKey: '2027-03-16T02:30',
      schedule: normalizeSchedule({
        kind: 'TIMED',
        timezone: 'UTC',
        localStart: '2027-03-16T10:00',
        localEnd: '2027-03-16T11:00',
      }),
    };
    const rows = expand(
      { ...series, splitBefore: '2027-03-16T02:30' },
      [v],
      [exception],
      { from: '2027-03-15', to: '2027-03-18', timezone: 'UTC' },
    );
    expect(rows.map((r) => r.status)).toEqual(['CANCELED']);
  });
  it('renders all-day recurrences by exclusive date spans in every display zone', () => {
    const v = version();
    v.schedule = normalizeSchedule({
      kind: 'ALL_DAY',
      timezone: 'Pacific/Auckland',
      startDate: '2027-03-13',
      endDate: '2027-03-15',
    });
    v.identityTime = '00:00';
    v.fromKey = '2027-03-13T00:00';
    v.definition.localTime = '00:00';
    const rows = expand(series, [v], [], {
      from: '2027-03-15',
      to: '2027-03-16',
      timezone: 'America/Los_Angeles',
    });
    expect(rows.map((r) => r.displayStart)).toEqual([
      '2027-03-14',
      '2027-03-15',
    ]);
    expect(rows.every((r) => r.schedule.startAt === null)).toBe(true);
  });
});
