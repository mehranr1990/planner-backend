import { it, expect } from 'vitest';
import {
  capacityMinutes,
  forecastPeriod,
  observedMinutes,
} from './capacity-template.js';
import { dayBoundary } from '../../calendar/public/index.js';
it('keeps unknown capacity, independent weekdays, effective date, timezone and dated exceptions', () => {
  const template = {
    timezone: 'America/New_York',
    effectiveFrom: '2026-03-01',
    weekdays: [0, 300, 240, null, 360, 180, 0],
  };
  expect(
    capacityMinutes('2026-03-09', 'America/New_York', undefined, null),
  ).toBeNull();
  expect(
    capacityMinutes('2026-03-09', 'America/New_York', undefined, template),
  ).toBe(300);
  expect(
    capacityMinutes('2026-03-08', 'America/New_York', undefined, template),
  ).toBe(0);
  expect(
    capacityMinutes('2026-03-11', 'America/New_York', undefined, template),
  ).toBeNull();
  expect(capacityMinutes('2026-03-09', 'UTC', undefined, template)).toBeNull();
  expect(
    capacityMinutes('2026-02-23', 'America/New_York', undefined, template),
  ).toBeNull();
  expect(capacityMinutes('2026-03-09', 'America/New_York', 0, template)).toBe(
    0,
  );
  expect(
    capacityMinutes('2026-03-09', 'America/New_York', null, template),
  ).toBeNull();
  // Configured minutes are an amount, not wall-clock durations; DST does not invent an hour.
  expect(
    capacityMinutes('2026-11-02', 'America/New_York', undefined, template),
  ).toBe(300);
});
it('clips midnight-spanning logs and unions duplicates on a DST day', () => {
  const from = dayBoundary('2026-03-08', 'America/New_York'),
    to = dayBoundary('2026-03-09', 'America/New_York');
  expect((to - from) / 3600000).toBe(23);
  const log = {
    startedAt: new Date(from - 3600000),
    endedAt: new Date(to + 3600000),
  };
  expect(observedMinutes([log, log], from, to)).toBe(23 * 60);
});
it('makes forecasts unknown with missing capacity or estimates and proves over-allocation only from evidence', () => {
  expect(forecastPeriod(null, 60, 0)).toMatchObject({
    state: 'UNKNOWN',
    remainingMinutes: null,
    overallocatedMinutes: null,
  });
  expect(forecastPeriod(120, 60, 1)).toMatchObject({
    state: 'UNKNOWN',
    remainingMinutes: null,
  });
  expect(forecastPeriod(120, 150, 1)).toMatchObject({
    state: 'UNKNOWN',
    overallocatedMinutes: 30,
  });
  expect(forecastPeriod(120, 60, 0)).toMatchObject({
    state: 'KNOWN',
    remainingMinutes: 60,
    overallocatedMinutes: 0,
  });
  expect(forecastPeriod(0, 60, 0)).toMatchObject({
    remainingMinutes: -60,
    overallocatedMinutes: 60,
  });
});
