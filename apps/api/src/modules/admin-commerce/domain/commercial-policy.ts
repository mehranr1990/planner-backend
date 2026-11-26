export const dayMs = 86_400_000;
export function minor(value: string | { toString(): string }): bigint {
  const text = value.toString();
  if (!/^-?(0|[1-9][0-9]{0,23})$/.test(text))
    throw new Error('INVALID_MINOR_UNITS');
  return BigInt(text);
}
export function bounded(value: bigint): string {
  if (value <= -(10n ** 24n) || value >= 10n ** 24n)
    throw new Error('MONEY_RANGE');
  return value.toString();
}
export function percent(value: bigint, basisPoints: number): bigint {
  if (
    value < 0n ||
    !Number.isInteger(basisPoints) ||
    basisPoints < 0 ||
    basisPoints > 10000
  )
    throw new Error('INVALID_RATE');
  return (value * BigInt(basisPoints) + 5000n) / 10000n;
}
export function unusedCredit(
  amount: bigint,
  start: Date,
  end: Date | null,
  now: Date,
): bigint {
  if (!end || now >= end || now < start) return 0n;
  return (
    (amount * BigInt(end.getTime() - now.getTime())) /
    BigInt(end.getTime() - start.getTime())
  );
}
export type SubscriptionClock = {
  state: string;
  startsAt: Date;
  endsAt: Date | null;
  pausedAt: Date | null;
  pauseClock: string | null;
  graceDays: number;
  cancelAtEnd: boolean;
};
export function effectiveSubscription(
  s: SubscriptionClock,
  now = new Date(),
): 'SCHEDULED' | 'ACTIVE' | 'PAUSED' | 'GRACE' | 'EXPIRED' | 'CANCELED' {
  if (s.state === 'CANCELED') return 'CANCELED';
  if (s.startsAt > now) return 'SCHEDULED';
  if (s.state === 'PAUSED') {
    if (s.pauseClock === 'FREEZE' || !s.endsAt) return 'PAUSED';
    if (
      now.getTime() <
      s.endsAt.getTime() + (s.cancelAtEnd ? 0 : s.graceDays * dayMs)
    )
      return 'PAUSED';
    return 'EXPIRED';
  }
  if (s.endsAt && s.endsAt <= now) {
    if (
      !s.cancelAtEnd &&
      now.getTime() < s.endsAt.getTime() + s.graceDays * dayMs
    )
      return 'GRACE';
    return 'EXPIRED';
  }
  if (s.state === 'PAUSED') return 'PAUSED';
  return 'ACTIVE';
}
export function resolveAllowance(
  base: bigint,
  additions: bigint[],
  caps: bigint[],
): bigint {
  const value = additions.reduce((n, v) => n + v, base);
  return caps.reduce((n, v) => (v < n ? v : n), value);
}
