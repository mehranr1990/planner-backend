/** Strict canonical PCM WAV policy, not a decoder or antivirus. */
export function validWav(head: Uint8Array, size: number | undefined): boolean {
  if (size === undefined || size < 46 || size > 10485760 || head.length < 44)
    return false;
  const text = (from: number, to: number) =>
    String.fromCharCode(...head.slice(from, to));
  if (
    text(0, 4) !== 'RIFF' ||
    text(8, 12) !== 'WAVE' ||
    text(12, 16) !== 'fmt ' ||
    text(36, 40) !== 'data'
  )
    return false;
  const v = new DataView(head.buffer, head.byteOffset, head.byteLength),
    channels = v.getUint16(22, true),
    rate = v.getUint32(24, true),
    align = v.getUint16(32, true),
    length = v.getUint32(40, true);
  return (
    v.getUint32(4, true) + 8 === size &&
    v.getUint32(16, true) === 16 &&
    v.getUint16(20, true) === 1 &&
    [1, 2].includes(channels) &&
    rate >= 8000 &&
    rate <= 96000 &&
    v.getUint16(34, true) === 16 &&
    align === channels * 2 &&
    v.getUint32(28, true) === rate * align &&
    length > 0 &&
    length % align === 0 &&
    length + 44 === size
  );
}
