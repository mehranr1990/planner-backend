import { describe, expect, it } from 'vitest';
import { deflateSync, crc32 } from 'node:zlib';
import { safeCommunicationContent } from './communication-content.js';
function chunk(name: string, data: Buffer) {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const payload = Buffer.concat([Buffer.from(name), data]),
    check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(payload));
  return Buffer.concat([size, payload, check]);
}
function png(w = 1, h = 1, extra: Buffer[] = []) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w);
  header.writeUInt32BE(h, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    ...extra,
    chunk('IDAT', deflateSync(Buffer.from([0, 0, 0, 0, 255]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
describe('P5-06 bounded communication media security', () => {
  it('accepts a minimal structural grayscale JPEG and rejects EXIF/comment injection', () => {
    const marker = (n: number, payload: Buffer) => {
      const header = Buffer.from([255, n, 0, 0]);
      header.writeUInt16BE(payload.length + 2, 2);
      return Buffer.concat([header, payload]);
    };
    const counts = Buffer.alloc(16);
    counts[0] = 1;
    const image = Buffer.concat([
      Buffer.from([255, 216]),
      marker(0xdb, Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 1)])),
      marker(0xc0, Buffer.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0])),
      marker(
        0xc4,
        Buffer.concat([
          Buffer.from([0]),
          counts,
          Buffer.from([0, 0x10]),
          counts,
          Buffer.from([0]),
        ]),
      ),
      marker(0xda, Buffer.from([1, 1, 0, 0, 63, 0])),
      Buffer.from([0x3f, 255, 217]),
    ]);
    expect(safeCommunicationContent('image/jpeg', image)).toBe(true);
    for (const type of [0xe1, 0xed, 0xfe])
      expect(
        safeCommunicationContent(
          'image/jpeg',
          Buffer.concat([
            image.subarray(0, 2),
            marker(type, Buffer.from('private metadata')),
            image.subarray(2),
          ]),
        ),
      ).toBe(false);
  });
  it('accepts an intact RGBA image without changing the original bytes', () => {
    const b = png(),
      original = Buffer.from(b);
    expect(safeCommunicationContent('image/png', b)).toBe(true);
    expect(b).toEqual(original);
  });
  it('rejects metadata, unknown chunks, corrupt CRC and trailing active content', () => {
    for (const name of ['eXIf', 'iTXt', 'tEXt', 'zTXt', 'iCCP', 'acTL'])
      expect(
        safeCommunicationContent(
          'image/png',
          png(1, 1, [chunk(name, Buffer.from('private metadata'))]),
        ),
      ).toBe(false);
    const b = png();
    b[29] = b[29]! ^ 1;
    expect(safeCommunicationContent('image/png', b)).toBe(false);
    expect(
      safeCommunicationContent(
        'image/png',
        Buffer.concat([png(), Buffer.from('<script>active</script>')]),
      ),
    ).toBe(false);
  });
  it('rejects pixel bombs, impossible dimensions and inconsistent decompressed scanlines', () => {
    for (const [w, h] of [
      [20001, 1],
      [16000, 16000],
      [0, 1],
      [100, 1],
    ])
      expect(safeCommunicationContent('image/png', png(w, h))).toBe(false);
  });
  it('validates the structure and ordering of permitted numeric PNG ancillary chunks', () => {
    const physical = Buffer.alloc(9);
    physical.writeUInt32BE(1);
    physical.writeUInt32BE(1, 4);
    physical[8] = 1;
    expect(
      safeCommunicationContent(
        'image/png',
        png(1, 1, [chunk('pHYs', physical)]),
      ),
    ).toBe(true);
    expect(
      safeCommunicationContent(
        'image/png',
        png(1, 1, [chunk('pHYs', Buffer.alloc(1024, 65))]),
      ),
    ).toBe(false);
    expect(
      safeCommunicationContent(
        'image/png',
        png(1, 1, [chunk('tRNS', Buffer.alloc(8))]),
      ),
    ).toBe(false);
    expect(
      safeCommunicationContent(
        'image/png',
        png(1, 1, [chunk('sRGB', Buffer.from([4]))]),
      ),
    ).toBe(false);
  });
  it('rejects image signatures without a valid bounded image structure', () => {
    expect(
      safeCommunicationContent(
        'image/jpeg',
        Buffer.from('ffd8ffe1000645786966ffd9', 'hex'),
      ),
    ).toBe(false);
    expect(
      safeCommunicationContent(
        'image/png',
        Buffer.from('89504e470d0a1a0a0000000049454e44ae426082', 'hex'),
      ),
    ).toBe(false);
  });
  it('rejects active and compressed-object PDF features, including escaped names', () => {
    for (const token of [
      '/JavaScript',
      '/J#53',
      '/Launch',
      '/OpenAction',
      '/AA',
      '/RichMedia',
      '/EmbeddedFile',
      '/XFA',
      '/Encrypt',
      '/ObjStm',
    ])
      expect(
        safeCommunicationContent(
          'application/pdf',
          Buffer.from('%PDF-1.7\n' + token + ' 1\n%%EOF'),
        ),
      ).toBe(false);
    expect(
      safeCommunicationContent(
        'application/pdf',
        Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF'),
      ),
    ).toBe(true);
  });
  it('rejects invalid UTF-8, control bytes and active text without rejecting ordinary text', () => {
    expect(
      safeCommunicationContent('text/plain', Buffer.from('سلام\nplain text')),
    ).toBe(true);
    for (const b of [
      Buffer.from([255]),
      Buffer.from('a\0b'),
      Buffer.from('prefix <script>active</script>'),
    ])
      expect(safeCommunicationContent('text/plain', b)).toBe(false);
  });
  it('bounds original bytes and rejects unsupported formats', () => {
    expect(
      safeCommunicationContent(
        'text/plain',
        Buffer.alloc(20 * 1024 * 1024 + 1, 65),
      ),
    ).toBe(false);
    expect(
      safeCommunicationContent('image/svg+xml', Buffer.from('<svg/>')),
    ).toBe(false);
  });
});
