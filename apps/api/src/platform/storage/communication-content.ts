import { inflateSync } from 'node:zlib';
import { validContent } from './content-policy.js';
/** Bounded structural inspection. Original bytes stay immutable. This is not
 * malware-engine clearance, a full JPEG decoder or a complete PDF interpreter. */
const maxPixels = 16_000_000,
  maxDimension = 20_000,
  maxBytes = 20 * 1024 * 1024;
function dimensions(w: number, h: number) {
  return (
    w > 0 &&
    h > 0 &&
    w <= maxDimension &&
    h <= maxDimension &&
    w * h <= maxPixels
  );
}
function crc(bytes: Buffer) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function png(b: Buffer) {
  let at = 8,
    w = 0,
    h = 0,
    channels = 0,
    depth = 0,
    color = 0,
    paletteColors = 0,
    ended = false,
    sawData = false,
    sawPalette = false;
  const data: Buffer[] = [],
    metadata = new Set<string>();
  while (at < b.length) {
    if (at + 12 > b.length) return false;
    const size = b.readUInt32BE(at),
      end = at + 12 + size;
    if (end > b.length) return false;
    const name = b.toString('ascii', at + 4, at + 8),
      v = b.subarray(at + 8, at + 8 + size);
    if (
      crc(b.subarray(at + 4, at + 8 + size)) !== b.readUInt32BE(at + 8 + size)
    )
      return false;
    if (at === 8 && name !== 'IHDR') return false;
    if (name === 'IHDR') {
      if (at !== 8 || size !== 13) return false;
      w = v.readUInt32BE(0);
      h = v.readUInt32BE(4);
      depth = v[8]!;
      color = v[9]!;
      channels =
        ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color] ??
        0;
      if (
        !dimensions(w, h) ||
        !channels ||
        v[10] !== 0 ||
        v[11] !== 0 ||
        v[12] !== 0 ||
        !([0, 3].includes(color)
          ? [1, 2, 4, 8, 16].includes(depth) && !(color === 3 && depth === 16)
          : [8, 16].includes(depth))
      )
        return false;
    } else if (name === 'PLTE') {
      if (
        sawPalette ||
        sawData ||
        !size ||
        size % 3 ||
        size > 768 ||
        [0, 4].includes(color) ||
        (color === 3 && size / 3 > 2 ** depth)
      )
        return false;
      sawPalette = true;
      paletteColors = size / 3;
    } else if (name === 'IDAT') {
      sawData = true;
      data.push(v);
    } else if (name === 'IEND') {
      if (size || !sawData || end !== b.length) return false;
      ended = true;
      break;
    } else {
      if (
        !['tRNS', 'sRGB', 'gAMA', 'cHRM', 'pHYs'].includes(name) ||
        sawData ||
        metadata.has(name)
      )
        return false;
      metadata.add(name);
      if (
        name === 'tRNS' &&
        !(
          (color === 0 && size === 2) ||
          (color === 2 && size === 6) ||
          (color === 3 && sawPalette && size > 0 && size <= paletteColors)
        )
      )
        return false;
      if (name === 'sRGB' && (sawPalette || size !== 1 || v[0]! > 3))
        return false;
      if (name === 'gAMA' && (sawPalette || size !== 4 || !v.readUInt32BE(0)))
        return false;
      if (name === 'cHRM' && (sawPalette || size !== 32)) return false;
      if (
        name === 'pHYs' &&
        (size !== 9 || v[8]! > 1 || !v.readUInt32BE(0) || !v.readUInt32BE(4))
      )
        return false;
    }
    at = end;
  }
  if (!ended || !w || (b[25] === 3 && !sawPalette)) return false;
  const row = Math.ceil((w * channels * depth) / 8),
    expected = (row + 1) * h;
  if (expected > 128 * 1024 * 1024) return false;
  // Node's info option returns the engine's consumed input count; the pinned
  // Node types retain the buffer-only overload for this synchronous function.
  const decoded = inflateSync(Buffer.concat(data), {
    maxOutputLength: expected + 1,
    info: true,
  }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
  if (
    decoded.buffer.length !== expected ||
    decoded.engine.bytesWritten !== data.reduce((n, x) => n + x.length, 0)
  )
    return false;
  for (let i = 0; i < h; i++)
    if (decoded.buffer[i * (row + 1)]! > 4) return false;
  return true;
}
function jpeg(b: Buffer) {
  let at = 2,
    frame = false,
    scan = false,
    quant = false,
    huffman = false,
    entropy = false;
  while (at < b.length) {
    if (b[at++] !== 255) return false;
    while (b[at] === 255) at++;
    const marker = b[at++];
    if (marker === undefined) return false;
    if (marker === 0xd9) return frame && scan && entropy && at === b.length;
    if (
      marker === 0x00 ||
      marker === 0xd8 ||
      (marker >= 0xd0 && marker <= 0xd7)
    )
      return false;
    if (at + 2 > b.length) return false;
    const size = b.readUInt16BE(at);
    if (size < 2 || at + size > b.length) return false;
    const v = b.subarray(at + 2, at + size);
    if (marker >= 0xe0 && marker <= 0xef) {
      if (marker === 0xe0) {
        if (
          !v.subarray(0, 5).equals(Buffer.from('JFIF\0')) ||
          v.length < 14 ||
          v.length !== 14 + 3 * v[12]! * v[13]!
        )
          return false;
      } else if (marker === 0xee) {
        if (v.length !== 12 || v.toString('ascii', 0, 5) !== 'Adobe')
          return false;
      } else return false;
    } else if (marker === 0xfe) return false;
    else if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (
        frame ||
        v.length < 6 ||
        v[0] !== 8 ||
        !dimensions(v.readUInt16BE(3), v.readUInt16BE(1)) ||
        ![1, 3, 4].includes(v[5]!) ||
        v.length !== 6 + 3 * v[5]!
      )
        return false;
      frame = true;
    } else if (marker === 0xdb) {
      let p = 0;
      while (p < v.length) {
        const table = v[p++]!;
        if (table >> 4 > 1 || (table & 15) > 3) return false;
        const bytes = table >> 4 ? 128 : 64;
        if (p + bytes > v.length) return false;
        p += bytes;
      }
      if (!p) return false;
      quant = true;
    } else if (marker === 0xc4) {
      let p = 0;
      while (p < v.length) {
        if (p + 17 > v.length) return false;
        const table = v[p++]!;
        if (table >> 4 > 1 || (table & 15) > 3) return false;
        let count = 0,
          available = 1;
        for (let i = 0; i < 16; i++) {
          const n = v[p++]!;
          count += n;
          available = available * 2 - n;
          if (available < 0) return false;
        }
        if (!count || count > 256 || p + count > v.length) return false;
        p += count;
      }
      if (!p) return false;
      huffman = true;
    } else if (marker === 0xdd) {
      if (v.length !== 2) return false;
    } else if (marker === 0xda) {
      if (
        !frame ||
        !quant ||
        !huffman ||
        v.length < 4 ||
        !v[0] ||
        v.length !== 4 + 2 * v[0]!
      )
        return false;
      scan = true;
      at += size;
      while (at < b.length) {
        if (b[at++] !== 255) {
          entropy = true;
          continue;
        }
        const start = at - 1;
        while (b[at] === 255) at++;
        const code = b[at];
        if (
          code === 0 ||
          (code !== undefined && code >= 0xd0 && code <= 0xd7)
        ) {
          entropy = true;
          at++;
          continue;
        }
        at = start;
        break;
      }
      continue;
    } else return false;
    at += size;
  }
  return false;
}
export function safeCommunicationContent(mime: string, input: Uint8Array) {
  const b = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (
    !b.length ||
    b.length > maxBytes ||
    !validContent(mime, b.subarray(0, 65536), b.subarray(-65536), b.length)
  )
    return false;
  try {
    if (mime === 'image/png') return png(b);
    if (mime === 'image/jpeg') return jpeg(b);
    if (mime === 'application/pdf') {
      const text = b
        .toString('latin1')
        .replace(/#[0-9a-f]{2}/gi, (x) =>
          String.fromCharCode(parseInt(x.slice(1), 16)),
        );
      return (
        !/\/(?:JavaScript|JS|Launch|OpenAction|AA|RichMedia|EmbeddedFile|Filespec|XFA|Encrypt|ObjStm|Metadata|AcroForm|URI|GoToR|SubmitForm|ImportData|Rendition|Movie|Sound)\b/i.test(
          text,
        ) && !/<(?:script|iframe|svg)\b/i.test(text)
      );
    }
    if (mime === 'text/plain') {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(b);
      return (
        !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) &&
        !/<(?:script|iframe|svg|html)\b/i.test(text)
      );
    }
    return mime === 'audio/wav';
  } catch {
    return false;
  }
}
