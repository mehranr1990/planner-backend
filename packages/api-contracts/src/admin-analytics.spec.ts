import { it, expect } from 'vitest';
import {
  AnalyticsNavigationSchema,
  AnalyticsDefinitionInputSchema,
  AnalyticsFilterSchema,
  AnalyticsPolicySchema,
} from './admin-analytics.js';
it('rejects private content, arbitrary event names and executable formulas', () => {
  expect(
    AnalyticsNavigationSchema.safeParse({
      eventId: crypto.randomUUID(),
      page: 'tasks',
      text: 'private',
    }).success,
  ).toBe(false);
  expect(
    AnalyticsDefinitionInputSchema.safeParse({
      name: 'unsafe',
      kind: 'KPI',
      events: ['journal.body'],
      formula: 'eval()',
      windowDays: 7,
    }).success,
  ).toBe(false);
});
it('bounds ranges, retention and minimum privacy cohorts', () => {
  expect(
    AnalyticsFilterSchema.safeParse({
      from: '2026-11-01T00:00:00Z',
      to: '2026-01-01T00:00:00Z',
    }).success,
  ).toBe(false);
  expect(
    AnalyticsPolicySchema.safeParse({
      revision: 1,
      product: true,
      navigation: false,
      rawDays: 90,
      aggregateDays: 730,
      minimumCohort: 1,
    }).success,
  ).toBe(false);
});
