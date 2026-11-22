import { it, expect } from 'vitest';
import { memberCapacity } from './member-capacity.js';
it('uses the approved workweek, per-member overrides and authoritative date exceptions', () => {
  for (const [date, expected] of [
    ['2030-01-05', 480],
    ['2030-01-06', 480],
    ['2030-01-09', 480],
    ['2030-01-10', 0],
    ['2030-01-11', 0],
  ] as const)
    expect(memberCapacity(date, null, undefined, null, false)).toBe(expected);
  const team = {
    dated: null,
    minutes: 300,
    fullDayOff: false,
    leaveMinutes: 0,
  };
  expect(memberCapacity('2030-01-06', null, undefined, team, true)).toBe(300);
  expect(memberCapacity('2030-01-06', null, 600, team, true)).toBe(600);
  expect(memberCapacity('2030-01-06', null, null, team, true)).toBe(300);
  expect(
    memberCapacity(
      '2030-01-06',
      null,
      600,
      { ...team, dated: { minutes: 0 } },
      true,
    ),
  ).toBe(0);
  expect(
    memberCapacity('2030-01-06', { minutes: null }, 600, team, true),
  ).toBeNull();
  expect(memberCapacity('2030-01-06', null, undefined, null, true)).toBeNull();
  expect(
    memberCapacity(
      '2030-01-06',
      null,
      600,
      { ...team, leaveMinutes: 120 },
      true,
    ),
  ).toBe(480);
});
