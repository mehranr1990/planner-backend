import { describe, it, expect } from 'vitest';
import { calculate, metric, percentage, output, ratio } from './progress.js';
describe('exact goal progress', () => {
  it('normalizes arbitrary positive weights', () => {
    expect(
      calculate('WEIGHTED', '0', [
        { weight: '2', value: ratio(100n, 1n) },
        { weight: '1', value: ratio(0n, 1n) },
      ]),
    ).toMatchObject({ percentage: '66.666667', weightSum: '3' });
  });
  it('does not round intermediate thirds', () => {
    const r = calculate(
      'WEIGHTED',
      '0',
      Array.from({ length: 3 }, () => ({
        weight: '0.000001',
        value: ratio(100n, 3n),
      })),
    );
    expect(r.rawPercentage).toBe('33.333333');
  });
  it('retains over-target and negative sources before clamping', () => {
    expect(
      calculate('WEIGHTED', '0', [
        { weight: '1', value: ratio(200n, 1n) },
        { weight: '1', value: ratio(-100n, 1n) },
      ]).percentage,
    ).toBe('50');
  });
  it('clamps visible manual percentage only', () => {
    expect(calculate('MANUAL', '150', [])).toMatchObject({
      rawPercentage: '150',
      percentage: '100',
    });
    expect(calculate('MANUAL', '-1', [])).toMatchObject({
      rawPercentage: '-1',
      percentage: '0',
    });
  });
  it('handles descending metric targets', () => {
    expect(output(metric('75', '100', '0'))).toBe('25');
  });
  it('handles negative metric baselines exactly', () => {
    expect(output(metric('-0.1', '-0.2', '0.1'))).toBe('33.333333');
  });
  it('rejects zero metric denominator', () =>
    expect(() => metric('1', '2', '2')).toThrow('ZERO_DENOMINATOR'));
  it('requires exactly one selected metric', () =>
    expect(() => calculate('METRIC', '0', [])).toThrow('METRIC_REQUIRED'));
  it('handles empty weights without division', () =>
    expect(calculate('WEIGHTED', '0', [])).toMatchObject({
      percentage: '0',
      weightSum: '0',
      reason: 'NO_SOURCES',
    }));
  it('rejects invalid weights', () => {
    for (const weight of ['0', '-1', '1000001'])
      expect(() =>
        calculate('WEIGHTED', '0', [{ weight, value: ratio(1n, 1n) }]),
      ).toThrow('INVALID_WEIGHT');
  });
  it('returns zero for no due habit dates', () =>
    expect(output(percentage(0, 0))).toBe('0'));
  it('rounds ties away from zero', () => {
    expect(output(ratio(1n, 2000000n))).toBe('0.000001');
    expect(output(ratio(-1n, 2000000n))).toBe('-0.000001');
  });
  it('preserves values near the approved exact bound', () =>
    expect(calculate('MANUAL', '999999999.999999', []).rawPercentage).toBe(
      '999999999.999999',
    ));
});
