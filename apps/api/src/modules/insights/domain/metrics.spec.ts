import { describe, it, expect } from 'vitest';
import { rounded, comparison, buckets, addDates, fixed } from './metrics.js';
describe('P1-11 reproducible metric arithmetic and periods', () => {
  it('rounds exact ratios half up at six places', () => {
    expect(rounded(100n, 3n)).toBe('33.333333');
    expect(rounded(1n, 2000000n)).toBe('0.000001');
  });
  it('preserves signed changes without binary float arithmetic', () => {
    expect(comparison('0.30', '0.20')).toEqual({
      absoluteChange: '0.100000',
      percentageChange: '50.000000',
      reason: null,
    });
    expect(comparison('-10', '-20').percentageChange).toBe('50.000000');
  });
  it('does not invent zero baseline growth or missing observations', () => {
    expect(comparison('5', '0')).toEqual({
      absoluteChange: '5.000000',
      percentageChange: null,
      reason: 'NO_BASELINE',
    });
    expect(comparison(null, '3').reason).toBe('NO_OBSERVATION');
  });
  it('handles exact large money values', () =>
    expect(
      comparison('999999999999999999.99', '999999999999999999.98')
        .absoluteChange,
    ).toBe('0.010000'));
  it('rejects division by zero and excess precision', () => {
    expect(() => rounded(1n, 0n)).toThrow();
    expect(() => fixed('1.0000001')).toThrow();
  });
  it('preserves leap dates and fixed local-date comparison lengths', () => {
    expect(addDates('2024-03-01', -1)).toBe('2024-02-29');
    expect(addDates('2024-03-11', -3)).toBe('2024-03-08');
  });
  it('marks partial week edges under Sunday preferences', () =>
    expect(buckets('2024-03-08', '2024-03-12', 'WEEK', 0)).toEqual([
      { from: '2024-03-08', to: '2024-03-10', partial: true },
      { from: '2024-03-10', to: '2024-03-12', partial: true },
    ]));
  it('honors Monday week starts without shifting stored dates', () =>
    expect(buckets('2024-03-04', '2024-03-11', 'WEEK', 1)).toEqual([
      { from: '2024-03-04', to: '2024-03-11', partial: false },
    ]));
  it('uses actual month ends including leap February', () =>
    expect(buckets('2024-02-28', '2024-04-01', 'MONTH', 1)).toEqual([
      { from: '2024-02-28', to: '2024-03-01', partial: true },
      { from: '2024-03-01', to: '2024-04-01', partial: false },
    ]));
  it('keeps a bucket for every local date including DST days', () =>
    expect(buckets('2024-03-09', '2024-03-12', 'DAY', 1)).toHaveLength(3));
});
