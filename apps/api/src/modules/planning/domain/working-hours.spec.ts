import { describe, it, expect } from 'vitest';
import { measureCapacity, union } from './working-hours.js';
describe('working interval capacity', () => {
  it('unions overlaps and clips busy intervals to availability', () => {
    const m = 60000;
    expect(
      measureCapacity(
        [
          { start: 0, end: 60 * m },
          { start: 30 * m, end: 90 * m },
        ],
        [
          { start: 45 * m, end: 75 * m },
          { start: 60 * m, end: 120 * m },
        ],
      ),
    ).toEqual({
      availableMinutes: 90,
      busyMinutes: 75,
      reservedMinutes: 45,
      remainingMinutes: 45,
      overbookedMinutes: 0,
    });
  });
  it('preserves breaks and half-open boundaries', () => {
    expect(
      union([
        { start: 0, end: 2 },
        { start: 3, end: 4 },
        { start: 4, end: 5 },
      ]),
    ).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
    ]);
    expect(
      measureCapacity([], [{ start: 0, end: 60000 }]).overbookedMinutes,
    ).toBe(1);
  });
});
