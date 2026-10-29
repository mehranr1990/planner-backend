export const addDates = (date: string, days = 1) =>
  new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000)
    .toISOString()
    .slice(0, 10);
export function rounded(n: bigint, d: bigint, places = 6): string {
  if (d === 0n) throw new RangeError('ZERO_DENOMINATOR');
  const negative = n < 0n !== d < 0n;
  n = n < 0n ? -n : n;
  d = d < 0n ? -d : d;
  const unit = 10n ** BigInt(places),
    v = (n * unit * 2n + d) / (2n * d);
  return (
    (negative && v !== 0n ? '-' : '') +
    (v / unit).toString() +
    '.' +
    (v % unit).toString().padStart(places, '0')
  );
}
export function fixed(value: string): bigint {
  const negative = value.startsWith('-');
  const [a, b = ''] = value.replace(/^-/, '').split('.');
  if (b.length > 6) throw new RangeError('INVALID_PRECISION');
  const n = BigInt(a!) * 1000000n + BigInt(b.padEnd(6, '0'));
  return negative ? -n : n;
}
export function comparison(current: string | null, previous: string | null) {
  if (current === null || previous === null)
    return {
      absoluteChange: null,
      percentageChange: null,
      reason: 'NO_OBSERVATION' as const,
    };
  const c = fixed(current),
    p = fixed(previous),
    delta = c - p;
  return {
    absoluteChange: rounded(delta, 1000000n),
    percentageChange: p === 0n ? null : rounded(delta * 100n, p < 0n ? -p : p),
    reason: p === 0n ? ('NO_BASELINE' as const) : null,
  };
}
export function buckets(
  from: string,
  to: string,
  grouping: 'DAY' | 'WEEK' | 'MONTH',
  firstDayOfWeek: number,
) {
  const result = [];
  let start = from;
  while (start < to) {
    let boundary: string, nominal: string;
    if (grouping === 'DAY') {
      nominal = start;
      boundary = addDates(start);
    } else if (grouping === 'WEEK') {
      const weekday = new Date(start + 'T00:00:00Z').getUTCDay();
      nominal = addDates(start, -((weekday - firstDayOfWeek + 7) % 7));
      boundary = addDates(nominal, 7);
    } else {
      nominal = start.slice(0, 7) + '-01';
      const d = new Date(nominal + 'T00:00:00Z');
      d.setUTCMonth(d.getUTCMonth() + 1);
      boundary = d.toISOString().slice(0, 10);
    }
    const end = boundary < to ? boundary : to;
    result.push({
      from: start,
      to: end,
      partial: start !== nominal || end !== boundary,
    });
    start = end;
  }
  return result;
}
