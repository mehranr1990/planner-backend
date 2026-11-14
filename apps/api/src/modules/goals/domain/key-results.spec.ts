import { describe, expect, it } from 'vitest';
import {
  goalProgress,
  keyResultProgress,
  periodProgress,
} from './key-results.js';

describe('Goal key-result formulas', () => {
  it('derives key-result progress only from recorded values, clamped to the target range', () => {
    expect(keyResultProgress('0', '10', null)).toBeNull();
    expect(keyResultProgress('0', '10', '2.5')).toBe(2500);
    expect(keyResultProgress('100', '50', '75')).toBe(5000);
    expect(keyResultProgress('0', '10', '12')).toBe(10000);
    expect(keyResultProgress('0', '10', '-1')).toBe(0);
  });
  it('averages key results without inventing missing progress', () => {
    expect(goalProgress([])).toBeNull();
    expect(goalProgress([5000, null])).toBeNull();
    expect(goalProgress([5000, 10000])).toBe(7500);
  });
  it('measures elapsed inclusive period days', () => {
    expect(periodProgress('2030-01-01', '2030-01-10', '2029-12-31')).toBe(0);
    expect(periodProgress('2030-01-01', '2030-01-10', '2030-01-05')).toBe(5000);
    expect(periodProgress('2030-01-01', '2030-01-10', '2030-02-01')).toBe(
      10000,
    );
  });
});
