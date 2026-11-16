import { it, expect } from 'vitest';
import * as c from './index.js';
it('validates explicit seven-day capacity and keeps points separate from minutes', () => {
  const template = {
    timezone: 'Asia/Tehran',
    effectiveFrom: '2026-11-16',
    weekdays: [null, 300, 240, 0, 360, 180, 0],
  };
  expect(c.TeamWeeklyCapacityInputSchema.safeParse(template).success).toBe(
    true,
  );
  expect(
    c.TeamWeeklyCapacityInputSchema.safeParse({ ...template, weekdays: [240] })
      .success,
  ).toBe(false);
  expect(
    c.TeamWeeklyCapacityInputSchema.safeParse({
      ...template,
      timezone: 'Unknown/Zone',
    }).success,
  ).toBe(false);
  expect(
    c.TeamWeeklyCapacityInputSchema.safeParse({
      ...template,
      weeklyMinutes: 2400,
    }).success,
  ).toBe(false);
  expect(
    c.TeamSprintCapacityInputSchema.parse({ capacityPoints: null }),
  ).toEqual({ capacityPoints: null });
  expect(
    c.TeamSprintCapacityInputSchema.safeParse({ capacityMinutes: 480 }).success,
  ).toBe(false);
});
it('accepts MAYBE, occurrence keys, cancellation and bounded source queries', () => {
  expect(
    c.TeamMeetingInvitationResponseSchema.parse({ decision: 'MAYBE' }).decision,
  ).toBe('MAYBE');
  expect(
    c.TeamRsvpQuerySchema.safeParse({ recurrenceKey: '2030-01-01T10:00' })
      .success,
  ).toBe(true);
  expect(
    c.CalendarSeriesEditSchema.parse({
      scope: 'CANCEL_FUTURE',
      recurrenceKey: '2030-01-01T10:00',
    }).scope,
  ).toBe('CANCEL_FUTURE');
  expect(
    c.TeamCrossWorkloadQuerySchema.safeParse({
      from: '2030-01-01',
      to: '2030-03-01',
      timezone: 'UTC',
    }).success,
  ).toBe(false);
  expect(c.TeamSourceQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  expect(
    c.TeamSourceQuerySchema.safeParse({ source: 'PERSONAL' }).success,
  ).toBe(false);
});
