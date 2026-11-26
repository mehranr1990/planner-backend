import { it, expect } from 'vitest';
import {
  analyticsMetrics,
  definitionMetrics,
  analyticsCsv,
  measure,
  type AnalyticsEvent,
} from './analytics-engine.js';
const event = (
  id: string,
  date: string,
  name = 'task.created',
  meaningful = true,
): AnalyticsEvent => ({
  userId: id,
  occurredAt: new Date(date),
  name,
  feature: 'tasks',
  meaningful,
});
const filter = { from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z' };
it('counts meaningful distinct rolling users, excluding navigation and duplicate activity', () => {
  const rows = [
    ...Array.from({ length: 5 }, (_, i) =>
      event(String(i), '2026-10-31T12:00:00Z'),
    ),
    ...Array.from({ length: 5 }, (_, i) =>
      event(String(i), '2026-10-31T13:00:00Z'),
    ),
    event('navigation', '2026-10-31T13:00:00Z', 'navigation.viewed', false),
  ];
  const m = analyticsMetrics(rows, filter, 5);
  expect(m.find((v) => v.key === 'dau')?.value).toBe(5);
  expect(m.find((v) => v.key === 'meaningful_events')?.value).toBe(10);
});
it('suppresses small populations and denominators, including zero', () => {
  expect(measure('x', 4, 4, 5, 10)).toMatchObject({
    value: null,
    denominator: null,
    suppressed: true,
  });
  expect(measure('x', 0, 0, 5)).toMatchObject({ value: null });
});
it('uses ordered same-user funnel steps within the configured conversion window', () => {
  const rows = Array.from({ length: 5 }, (_, i) => [
    event(String(i), '2026-10-02T00:00:00Z'),
    event(String(i), '2026-10-03T00:00:00Z', 'task.completed'),
  ]).flat();
  const d = {
    events: ['task.created', 'task.completed'],
    kind: 'FUNNEL',
    formula: 'COUNT',
    windowDays: 7,
  };
  expect(definitionMetrics(rows, d, 5).map((v) => v.value)).toEqual([5, 5]);
  expect(
    definitionMetrics(
      rows.map((r) =>
        r.name === 'task.completed'
          ? { ...r, occurredAt: new Date('2026-10-01') }
          : r,
      ),
      d,
      5,
    )[1]?.value,
  ).toBeNull();
});
it('suppresses KPI ratios when the denominator cohort is too small', () => {
  expect(
    definitionMetrics(
      [event('one', '2026-10-02')],
      {
        events: ['task.created', 'task.completed'],
        kind: 'KPI',
        formula: 'RATIO',
        windowDays: 7,
      },
      5,
    )[0]?.value,
  ).toBeNull();
});
it('calculates return cohorts from first event and preserves time ordering', () => {
  const rows = Array.from({ length: 5 }, (_, i) => [
    event(String(i), '2026-10-02T00:00:00Z'),
    event(String(i), '2026-10-09T01:00:00Z', 'task.completed'),
  ]).flat();
  expect(
    definitionMetrics(
      rows,
      {
        events: ['task.created', 'task.completed'],
        kind: 'COHORT',
        formula: 'COUNT',
        windowDays: 7,
      },
      5,
    ).map((v) => v.value),
  ).toEqual([5, 5]);
});
it('escapes executable CSV cell prefixes', () => {
  expect(
    analyticsCsv({
      metrics: [{ key: '=2+2', value: 3, denominator: 5, suppressed: false }],
    }),
  ).toContain("'=2+2");
});
it('anchors registration retention to all eligible registrations, including inactive users', () => {
  const anchors = new Map(
    Array.from(
      { length: 10 },
      (_, i) => [String(i), new Date('2026-10-02T00:00:00Z')] as const,
    ),
  );
  const rows = Array.from({ length: 5 }, (_, i) =>
    event(String(i), '2026-10-09T01:00:00Z'),
  );
  const metric = analyticsMetrics(rows, filter, 5, anchors).find(
    (m) => m.key === 'registration_return_day_7',
  );
  expect(metric).toMatchObject({
    value: 0.5,
    denominator: 10,
    suppressed: false,
  });
});

it('keeps rolling DAU/WAU/MAU windows exact and excludes partially observed return days', () => {
  const rows = [
    ...Array.from({ length: 5 }, (_, i) =>
      event('today' + i, '2026-10-31T12:00:00Z'),
    ),
    ...Array.from({ length: 5 }, (_, i) =>
      event('yesterday' + i, '2026-10-30T12:00:00Z'),
    ),
  ];
  expect(
    analyticsMetrics(rows, filter, 5).find((m) => m.key === 'dau')?.value,
  ).toBe(5);
  const anchors = new Map([
    ...Array.from(
      { length: 5 },
      (_, i) => ['early' + i, new Date('2026-10-02T00:00:00Z')] as const,
    ),
    ...Array.from(
      { length: 5 },
      (_, i) => ['late' + i, new Date('2026-10-24T12:00:00Z')] as const,
    ),
  ]);
  const returned = Array.from({ length: 5 }, (_, i) =>
    event('early' + i, '2026-10-09T01:00:00Z'),
  );
  expect(
    analyticsMetrics(returned, filter, 5, anchors).find(
      (m) => m.key === 'registration_return_day_7',
    ),
  ).toMatchObject({ value: 1, denominator: 5 });
});
it('counts selected events per meaningful active user and suppresses small formula contributors', () => {
  const rows = Array.from({ length: 5 }, (_, i) => [
    event(String(i), '2026-10-02'),
    event(String(i), '2026-10-03'),
  ]).flat();
  expect(
    definitionMetrics(
      rows,
      {
        events: ['task.created'],
        kind: 'KPI',
        formula: 'PER_ACTIVE_USER',
        windowDays: 7,
      },
      5,
    )[0]?.value,
  ).toBe(2);
  const denominator = Array.from({ length: 5 }, (_, i) =>
    event('denom' + i, '2026-10-02', 'task.completed'),
  );
  expect(
    definitionMetrics(
      [...denominator, event('one', '2026-10-02')],
      {
        events: ['task.created', 'task.completed'],
        kind: 'KPI',
        formula: 'RATIO',
        windowDays: 7,
      },
      5,
    )[0]?.value,
  ).toBeNull();
});
it('processes bounded large cohorts without quadratic per-user scans', () => {
  const rows = Array.from({ length: 5000 }, (_, i) =>
    Array.from({ length: 10 }, (_, n) =>
      event(
        String(i),
        '2026-10-31T12:00:00.' + String(n).padStart(3, '0') + 'Z',
        n < 5 ? 'task.created' : 'task.completed',
      ),
    ),
  ).flat();
  expect(
    analyticsMetrics(rows, filter, 5).find((m) => m.key === 'mau')?.value,
  ).toBe(5000);
  expect(
    definitionMetrics(
      rows,
      {
        events: ['task.created', 'task.completed'],
        kind: 'FUNNEL',
        formula: 'COUNT',
        windowDays: 7,
      },
      5,
    ).map((m) => m.value),
  ).toEqual([5000, 5000]);
});

import { financialAnalyticsCsv } from './analytics-engine.js';
it('exports exact signed financial minor units without mixing currencies', () => {
  const csv = financialAnalyticsCsv({
    suppressed: false,
    report: {
      currencies: [
        {
          currency: 'USD',
          payments: '0',
          refunds: '1',
          netCash: '-1',
          receivables: '0',
          invoiceCharges: '0',
          mrr: '0',
          arr: '0',
          conversionNumerator: 5,
          conversionDenominator: 10,
          byProduct: [],
        },
      ],
    },
    prices: [],
    economics: [],
  });
  expect(csv).toContain('"netCash","USD","-1"');
});
