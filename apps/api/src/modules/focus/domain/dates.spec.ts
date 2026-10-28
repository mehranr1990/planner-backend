import { describe, it, expect } from 'vitest';
import { dayBoundary, localDate } from './dates.js';
describe('productivity local date boundaries', () => {
  it('uses 23/25 hour days across DST without changing UTC durations', () => {
    expect(
      dayBoundary('2024-03-11', 'America/New_York') -
        dayBoundary('2024-03-10', 'America/New_York'),
    ).toBe(23 * 3600000);
    expect(
      dayBoundary('2024-11-04', 'America/New_York') -
        dayBoundary('2024-11-03', 'America/New_York'),
    ).toBe(25 * 3600000);
  });
  it('preserves submillisecond-free exact local midnight attribution', () => {
    expect(
      localDate(new Date('2024-03-11T03:59:59.999Z'), 'America/New_York'),
    ).toBe('2024-03-10');
    expect(
      localDate(new Date('2024-03-11T04:00:00Z'), 'America/New_York'),
    ).toBe('2024-03-11');
  });
  it('represents a skipped local date as an empty day', () =>
    expect(dayBoundary('2011-12-30', 'Pacific/Apia')).toBe(
      dayBoundary('2011-12-31', 'Pacific/Apia'),
    ));
});
