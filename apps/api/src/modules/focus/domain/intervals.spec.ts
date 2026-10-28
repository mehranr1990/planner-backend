import { describe, it, expect } from 'vitest';
import { clip, unionMilliseconds } from './intervals.js';

describe('work interval arithmetic', () => {
  it('clips with exact millisecond and exclusive-end boundaries', () => {
    expect(clip({ start: 1, end: 1001 }, { start: 500, end: 1500 })).toEqual({
      start: 500,
      end: 1001,
    });
    expect(clip({ start: 1, end: 500 }, { start: 500, end: 1000 })).toBeNull();
  });
  it('does not count nested, repeated or overlapping work twice', () => {
    expect(
      unionMilliseconds([
        { start: 100, end: 400 },
        { start: 200, end: 300 },
        { start: 100, end: 400 },
        { start: 350, end: 500 },
      ]),
    ).toBe(400);
  });
  it('handles empty, disjoint and touching ranges', () => {
    expect(unionMilliseconds([])).toBe(0);
    expect(unionMilliseconds([{ start: -1000, end: -500 }])).toBe(500);
    expect(
      unionMilliseconds([
        { start: 1, end: 100 },
        { start: 100, end: 200 },
        { start: 400, end: 500 },
      ]),
    ).toBe(299);
  });
});
