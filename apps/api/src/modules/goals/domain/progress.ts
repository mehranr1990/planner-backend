export type Ratio = { n: bigint; d: bigint };
const scale = 1000000n;
export function units(value: string): bigint {
  const negative = value.startsWith('-'),
    raw = negative ? value.slice(1) : value;
  const [w, f = ''] = raw.split('.');
  const n = BigInt(w!) * scale + BigInt(f.padEnd(6, '0'));
  return negative ? -n : n;
}
function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a || 1n;
}
export function ratio(n: bigint, d: bigint): Ratio {
  if (d === 0n) throw new Error('ZERO_DENOMINATOR');
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}
export function output(v: Ratio): string {
  const negative = v.n < 0n,
    n = negative ? -v.n : v.n;
  let q = (n * scale) / v.d;
  if (((n * scale) % v.d) * 2n >= v.d) q++;
  const f = String(q % scale)
    .padStart(6, '0')
    .replace(/0+$/, '');
  return (
    (negative && q !== 0n ? '-' : '') + String(q / scale) + (f ? '.' + f : '')
  );
}
export function metric(
  current: string,
  baseline: string,
  target: string,
): Ratio {
  return ratio(
    100n * (units(current) - units(baseline)),
    units(target) - units(baseline),
  );
}
export function percentage(n: number, d: number): Ratio {
  return d === 0 ? ratio(0n, 1n) : ratio(100n * BigInt(n), BigInt(d));
}
export function calculate(
  mode: 'MANUAL' | 'METRIC' | 'WEIGHTED',
  manual: string,
  sources: Array<{ weight: string; value: Ratio }>,
) {
  let raw = ratio(units(manual), scale),
    weightSum = 0n;
  if (mode === 'METRIC') {
    if (sources.length !== 1) throw new Error('METRIC_REQUIRED');
    raw = sources[0]!.value;
  }
  if (mode === 'WEIGHTED') {
    let total = ratio(0n, 1n);
    for (const s of sources) {
      const w = units(s.weight);
      if (w <= 0n || w > 1000000n * scale) throw new Error('INVALID_WEIGHT');
      weightSum += w;
      total = ratio(
        total.n * s.value.d + s.value.n * w * total.d,
        total.d * s.value.d,
      );
    }
    raw =
      weightSum === 0n ? ratio(0n, 1n) : ratio(total.n, total.d * weightSum);
  }
  const visible =
    raw.n < 0n ? ratio(0n, 1n) : raw.n > 100n * raw.d ? ratio(100n, 1n) : raw;
  return {
    rawPercentage: output(raw),
    percentage: output(visible),
    weightSum: output(ratio(weightSum, scale)),
    reason:
      mode === 'WEIGHTED' && sources.length === 0
        ? ('NO_SOURCES' as const)
        : ('CALCULATED' as const),
  };
}
