import { it, expect } from 'vitest';
import {
  minor,
  bounded,
  percent,
  unusedCredit,
  effectiveSubscription,
  resolveAllowance,
  dayMs,
} from './commercial-policy.js';
import { termWindow } from './term-clock.js';
it('keeps money exact beyond Number precision, validates bounds and rounds percentages once', () => {
  expect(minor('9007199254740993') + 1n).toBe(9007199254740994n);
  expect(percent(101n, 5000)).toBe(51n);
  expect(() => minor('1.1')).toThrow();
  expect(() => minor('1e3')).toThrow();
  expect(() => bounded(10n ** 24n)).toThrow();
  expect(unusedCredit(101n, new Date(0), new Date(1000), new Date(500))).toBe(
    50n,
  );
  expect(unusedCredit(101n, new Date(0), new Date(1000), new Date(1000))).toBe(
    0n,
  );
});
it('computes term and grace at exact UTC boundaries without relying on workers', () => {
  const s = {
    state: 'ACTIVE',
    startsAt: new Date(0),
    endsAt: new Date(dayMs),
    pausedAt: null,
    pauseClock: null,
    graceDays: 1,
    cancelAtEnd: false,
  };
  expect(effectiveSubscription(s, new Date(dayMs - 1))).toBe('ACTIVE');
  expect(effectiveSubscription(s, new Date(dayMs))).toBe('GRACE');
  expect(effectiveSubscription(s, new Date(2 * dayMs))).toBe('EXPIRED');
  expect(
    effectiveSubscription({ ...s, cancelAtEnd: true }, new Date(dayMs)),
  ).toBe('EXPIRED');
  expect(
    effectiveSubscription(
      { ...s, state: 'PAUSED', pausedAt: new Date(1), pauseClock: 'FREEZE' },
      new Date(3 * dayMs),
    ),
  ).toBe('PAUSED');
  expect(
    effectiveSubscription(
      { ...s, state: 'PAUSED', pausedAt: new Date(1), pauseClock: 'CONTINUE' },
      new Date(3 * dayMs),
    ),
  ).toBe('EXPIRED');
  expect(
    effectiveSubscription(
      { ...s, state: 'PAUSED', pausedAt: new Date(1), pauseClock: 'CONTINUE' },
      new Date(dayMs + 1),
    ),
  ).toBe('PAUSED');
});
it('applies additive allowances and the final Admin cap independently of RBAC', () => {
  expect(resolveAllowance(10n, [5n, 9n], [12n])).toBe(12n);
  expect(resolveAllowance(10n, [5n], [100n])).toBe(15n);
  expect(resolveAllowance(0n, [1n], [0n])).toBe(0n);
});
it('preserves original term dates while applying freeze shifts and immutable termination', () => {
  const term = {
    startsAt: new Date(1000),
    endsAt: new Date(2000),
    shifts: [{ startShiftMs: 1000n, endShiftMs: 1000n }],
  };
  expect(termWindow(term).startsAt.getTime()).toBe(2000);
  expect(termWindow(term).endsAt!.getTime()).toBe(3000);
  expect(
    termWindow({
      ...term,
      closure: { endedAt: new Date(2500) },
    }).endsAt!.getTime(),
  ).toBe(2500);
  expect(term.endsAt.getTime()).toBe(2000);
});
