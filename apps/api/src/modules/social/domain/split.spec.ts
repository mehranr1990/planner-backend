import { describe, it, expect } from 'vitest';
import { split, balances, SplitError } from './split.js';
const [a, b, c] = ['a', 'b', 'c'];
const sum = (r: { shareMinor: bigint }[]) =>
  r.reduce((t, s) => t + s.shareMinor, 0n);
describe('P6-03 exact split allocation', () => {
  it('equal split gives the remainder to the payer first, then recorded order', () => {
    const r = split(
      100n,
      'EQUAL',
      [{ userId: a }, { userId: b }, { userId: c }],
      b,
    );
    expect(r.map((s) => s.shareMinor)).toEqual([33n, 34n, 33n]);
    const r2 = split(
      101n,
      'EQUAL',
      [{ userId: a }, { userId: b }, { userId: c }],
      b,
    );
    expect(r2.map((s) => s.shareMinor)).toEqual([34n, 34n, 33n]);
    // A non-sharing payer leaves the recorded order unchanged.
    const r3 = split(
      101n,
      'EQUAL',
      [{ userId: a }, { userId: b }, { userId: c }],
      'z',
    );
    expect(r3.map((s) => s.shareMinor)).toEqual([34n, 34n, 33n]);
  });
  it('percent uses basis points and reconciles exactly', () => {
    const r = split(
      1001n,
      'PERCENT',
      [
        { userId: a, value: 3333n },
        { userId: b, value: 3333n },
        { userId: c, value: 3334n },
      ],
      c,
    );
    expect(sum(r)).toBe(1001n);
    expect(r.map((s) => s.shareMinor)).toEqual([334n, 333n, 334n]);
    expect(() =>
      split(
        100n,
        'PERCENT',
        [
          { userId: a, value: 5000n },
          { userId: b, value: 4999n },
        ],
        a,
      ),
    ).toThrow(SplitError);
  });
  it('weighted and fixed splits reconcile or reject', () => {
    const w = split(
      10n,
      'WEIGHTED',
      [
        { userId: a, value: 2n },
        { userId: b, value: 1n },
      ],
      b,
    );
    expect(w.map((s) => s.shareMinor)).toEqual([6n, 4n]);
    expect(sum(w)).toBe(10n);
    expect(
      split(
        10n,
        'FIXED',
        [
          { userId: a, value: 7n },
          { userId: b, value: 3n },
        ],
        a,
      ).map((s) => s.shareMinor),
    ).toEqual([7n, 3n]);
    expect(() =>
      split(
        10n,
        'FIXED',
        [
          { userId: a, value: 7n },
          { userId: b, value: 2n },
        ],
        a,
      ),
    ).toThrow('SPLIT_TOTAL_MISMATCH');
    // Zero weights never receive remainder units.
    const z = split(
      5n,
      'WEIGHTED',
      [
        { userId: a, value: 0n },
        { userId: b, value: 1n },
        { userId: c, value: 1n },
      ],
      a,
    );
    expect(z.map((s) => s.shareMinor)).toEqual([0n, 3n, 2n]);
  });
  it('handles very large exact amounts without precision loss', () => {
    const big = 900000000000000000n;
    const r = split(
      big,
      'EQUAL',
      [{ userId: a }, { userId: b }, { userId: c }],
      a,
    );
    expect(sum(r)).toBe(big);
  });
  it('rejects invalid inputs', () => {
    expect(() => split(0n, 'EQUAL', [{ userId: a }], a)).toThrow(
      'AMOUNT_INVALID',
    );
    expect(() => split(1n, 'EQUAL', [{ userId: a }, { userId: a }], a)).toThrow(
      'SHARES_DUPLICATE',
    );
    expect(() => split(1n, 'EQUAL', [{ userId: a, value: 1n }], a)).toThrow(
      'SHARE_VALUE_INVALID',
    );
    expect(() => split(1n, 'WEIGHTED', [{ userId: a, value: 0n }], a)).toThrow(
      'WEIGHT_TOTAL_INVALID',
    );
  });
  it('balances are per currency and include only supplied effective records', () => {
    const r = balances(
      [
        {
          currency: 'USD',
          payerUserId: a,
          amountMinor: 90n,
          shares: [
            { userId: a, shareMinor: 30n },
            { userId: b, shareMinor: 30n },
            { userId: c, shareMinor: 30n },
          ],
        },
        {
          currency: 'EUR',
          payerUserId: b,
          amountMinor: 10n,
          shares: [{ userId: a, shareMinor: 10n }],
        },
      ],
      [{ currency: 'USD', payerUserId: b, payeeUserId: a, amountMinor: 30n }],
    );
    const get = (u: string, cur: string) =>
      r.find((x) => x.userId === u && x.currency === cur)!;
    expect(get(a, 'USD')).toMatchObject({
      netMinor: 30n,
      receivableMinor: 30n,
    });
    expect(get(b, 'USD')).toMatchObject({ netMinor: 0n, owedMinor: 0n });
    expect(get(c, 'USD')).toMatchObject({ owedMinor: 30n });
    expect(get(a, 'EUR')).toMatchObject({ owedMinor: 10n });
  });
});
