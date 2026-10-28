/** Exact scaled-unit arithmetic; no binary floating-point amount operations. */
export function units(value: string, scale: number, positive = false): bigint {
  if (
    !Number.isInteger(scale) ||
    scale < 0 ||
    scale > 4 ||
    !/^[-]?(?:0|[1-9][0-9]{0,27})(?:\.[0-9]{1,4})?$/.test(value)
  )
    throw new RangeError('INVALID_AMOUNT');
  const negative = value.startsWith('-'),
    [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  if (fraction.length > scale) throw new RangeError('INVALID_PRECISION');
  const n =
    BigInt(whole!) * 10n ** BigInt(scale) +
    BigInt(fraction.padEnd(scale, '0') || '0');
  const result = negative ? -n : n;
  if (positive && result <= 0n)
    throw new RangeError('POSITIVE_AMOUNT_REQUIRED');
  return result;
}
export function amount(n: bigint, scale: number): string {
  const sign = n < 0n ? '-' : '',
    raw = (n < 0n ? -n : n).toString().padStart(scale + 1, '0');
  return sign + (scale ? raw.slice(0, -scale) + '.' + raw.slice(-scale) : raw);
}
export function rateRatio(value: string): {
  numerator: bigint;
  denominator: bigint;
} {
  if (!/^(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,12})?$/.test(value))
    throw new RangeError('INVALID_RATE');
  const [w, f = ''] = value.split('.'),
    n = BigInt(w! + f);
  if (n <= 0n) throw new RangeError('INVALID_RATE');
  return { numerator: n, denominator: 10n ** BigInt(f.length) };
}
export function converted(
  source: bigint,
  sourceScale: number,
  destScale: number,
  rate: string,
): bigint {
  const r = rateRatio(rate),
    n = source * r.numerator * 10n ** BigInt(destScale),
    d = r.denominator * 10n ** BigInt(sourceScale);
  if (n <= 0n) throw new RangeError('INVALID_AMOUNT');
  const q = n / d;
  return q + ((n % d) * 2n >= d ? 1n : 0n);
}
export function ratioPercent(progress: bigint, target: bigint): string {
  if (target <= 0n) throw new RangeError('INVALID_TARGET');
  const n = progress * 10000n;
  return amount(n / target, 2);
}
