/** P6-03 exact minor-unit allocation. No floating point is used anywhere. */
export type SplitMethod = 'EQUAL' | 'PERCENT' | 'FIXED' | 'WEIGHTED';
export type SplitInput = { userId: string; value?: bigint | undefined };
export type SplitShare = {
  userId: string;
  input: bigint | null;
  shareMinor: bigint;
};
export class SplitError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
const PERCENT_BASIS = 10000n;
/**
 * ADR 0051: an exact remainder is allocated one minor unit at a time, payer
 * first (when sharing), then in the recorded participant order.
 */
function remainderOrder(shares: SplitInput[], payerUserId: string) {
  const payer = shares.findIndex((s) => s.userId === payerUserId);
  const order = shares.map((_, i) => i);
  if (payer > 0) order.unshift(...order.splice(payer, 1));
  return order;
}
export function split(
  amountMinor: bigint,
  method: SplitMethod,
  shares: SplitInput[],
  payerUserId: string,
): SplitShare[] {
  if (amountMinor <= 0n) throw new SplitError('AMOUNT_INVALID');
  if (!shares.length || shares.length > 200)
    throw new SplitError('SHARES_INVALID');
  if (new Set(shares.map((s) => s.userId)).size !== shares.length)
    throw new SplitError('SHARES_DUPLICATE');
  const values = shares.map((s) => s.value);
  if (
    method === 'EQUAL'
      ? values.some((v) => v !== undefined)
      : values.some((v) => v === undefined || v < 0n)
  )
    throw new SplitError('SHARE_VALUE_INVALID');
  if (method === 'FIXED') {
    if (values.reduce<bigint>((a, v) => a + v!, 0n) !== amountMinor)
      throw new SplitError('SPLIT_TOTAL_MISMATCH');
    return shares.map((s) => ({
      userId: s.userId,
      input: s.value!,
      shareMinor: s.value!,
    }));
  }
  const weights =
    method === 'EQUAL' ? shares.map(() => 1n) : (values as bigint[]);
  const total = weights.reduce((a, w) => a + w, 0n);
  if (method === 'PERCENT' && total !== PERCENT_BASIS)
    throw new SplitError('PERCENT_TOTAL_INVALID');
  if (total <= 0n) throw new SplitError('WEIGHT_TOTAL_INVALID');
  const allocated = weights.map((w) => (amountMinor * w) / total);
  let remainder = amountMinor - allocated.reduce((a, v) => a + v, 0n);
  // Each floor loses less than one unit, so the remainder is below the share count.
  for (const i of remainderOrder(shares, payerUserId)) {
    if (remainder === 0n) break;
    if (weights[i] === 0n) continue;
    allocated[i]! += 1n;
    remainder -= 1n;
  }
  if (remainder !== 0n) throw new SplitError('SPLIT_TOTAL_MISMATCH');
  return shares.map((s, i) => ({
    userId: s.userId,
    input: method === 'EQUAL' ? null : s.value!,
    shareMinor: allocated[i]!,
  }));
}
export type LedgerBalance = {
  userId: string;
  currency: string;
  paidMinor: bigint;
  shareMinor: bigint;
  settledOutMinor: bigint;
  settledInMinor: bigint;
};
/** Effective approved revisions and confirmed settlements only; never mixes currencies. */
export function balances(
  revisions: {
    currency: string;
    payerUserId: string | null;
    amountMinor: bigint;
    shares: { userId: string | null; shareMinor: bigint }[];
  }[],
  settlements: {
    currency: string;
    payerUserId: string | null;
    payeeUserId: string | null;
    amountMinor: bigint;
  }[],
) {
  const rows = new Map<string, LedgerBalance>();
  const row = (userId: string, currency: string) => {
    const key = currency + ':' + userId;
    let r = rows.get(key);
    if (!r) {
      r = {
        userId,
        currency,
        paidMinor: 0n,
        shareMinor: 0n,
        settledOutMinor: 0n,
        settledInMinor: 0n,
      };
      rows.set(key, r);
    }
    return r;
  };
  for (const r of revisions) {
    if (r.payerUserId)
      row(r.payerUserId, r.currency).paidMinor += r.amountMinor;
    for (const s of r.shares)
      if (s.userId) row(s.userId, r.currency).shareMinor += s.shareMinor;
  }
  for (const s of settlements) {
    if (s.payerUserId)
      row(s.payerUserId, s.currency).settledOutMinor += s.amountMinor;
    if (s.payeeUserId)
      row(s.payeeUserId, s.currency).settledInMinor += s.amountMinor;
  }
  return [...rows.values()]
    .map((r) => {
      // Positive net: others owe this person; negative: this person owes.
      const net =
        r.paidMinor - r.shareMinor + r.settledOutMinor - r.settledInMinor;
      return {
        ...r,
        netMinor: net,
        receivableMinor: net > 0n ? net : 0n,
        owedMinor: net < 0n ? -net : 0n,
      };
    })
    .sort((a, b) =>
      a.currency === b.currency
        ? a.userId.localeCompare(b.userId)
        : a.currency.localeCompare(b.currency),
    );
}
