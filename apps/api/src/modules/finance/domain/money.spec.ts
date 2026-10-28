import { describe, it, expect } from 'vitest';
import { units, amount, converted, rateRatio, ratioPercent } from './money.js';
describe('Exact finance arithmetic', () => {
  it('adds amounts beyond binary-number precision without loss', () => {
    const n = units('999999999999999999.99', 2) + units('0.01', 2);
    expect(amount(n, 2)).toBe('1000000000000000000.00');
  });
  it('handles zero, negative balances and zero/three/four minor units', () => {
    expect(amount(units('-12', 0), 0)).toBe('-12');
    expect(amount(units('0', 3), 3)).toBe('0.000');
    expect(amount(units('12.3456', 4), 4)).toBe('12.3456');
  });
  it('rejects exponent, float syntax, extra currency precision and nonpositive input', () => {
    for (const v of ['1e3', '01.00', '+1', 'NaN', '1.001'])
      expect(() => units(v, 2, true)).toThrow();
    for (const v of ['0', '-1']) expect(() => units(v, 2, true)).toThrow();
  });
  it('rounds HALF_UP exactly once to destination units', () => {
    expect(converted(1n, 2, 2, '0.5')).toBe(1n);
    expect(converted(1n, 2, 2, '0.499999999999')).toBe(0n);
    expect(converted(12345n, 2, 0, '150.123456789012')).toBe(18533n);
  });
  it('preserves rational FX and validates rates', () => {
    expect(rateRatio('1.234567890123')).toEqual({
      numerator: 1234567890123n,
      denominator: 1000000000000n,
    });
    for (const v of ['0', '-1', 'Infinity', '1.1234567890123'])
      expect(() => rateRatio(v)).toThrow();
  });
  it('reports exact percent including exceeded and negative account progress', () => {
    expect(ratioPercent(1n, 3n)).toBe('33.33');
    expect(ratioPercent(120n, 100n)).toBe('120.00');
    expect(ratioPercent(-1n, 2n)).toBe('-50.00');
  });
});
