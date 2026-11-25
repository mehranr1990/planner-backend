import { Readable } from 'node:stream';
import { PayloadTooLargeException } from '@nestjs/common';
export type ZipEntry = { name: string; open: () => Promise<Readable> };
const table = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
/** Streaming ZIP STORE, UTF-8 names and data descriptors; no temporary public files.
 * ZIP64 is deliberately excluded by the 512 MiB/1,000-entry portability limits. */
export function zipArchive(
  entries: ZipEntry[],
  maxBytes = 512 * 1024 * 1024,
): Readable {
  if (entries.length > 1000)
    throw new PayloadTooLargeException({ code: 'EXPORT_ARCHIVE_LIMIT' });
  const names = new Set<string>();
  for (const e of entries) {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9_./-]{0,199}$/.test(e.name) ||
      e.name.split('/').some((p) => !p || p === '.' || p === '..') ||
      names.has(e.name)
    )
      throw new Error('Unsafe or duplicate archive entry');
    names.add(e.name);
  }
  return Readable.from(
    (async function* () {
      let offset = 0;
      const directory: Buffer[] = [];
      const reserve = (bytes: number) => {
        offset += bytes;
        if (offset > maxBytes)
          throw new PayloadTooLargeException({ code: 'EXPORT_ARCHIVE_LIMIT' });
      };
      for (const entry of entries) {
        const name = Buffer.from(entry.name, 'utf8'),
          start = offset,
          header = Buffer.alloc(30);
        header.writeUInt32LE(0x04034b50);
        header.writeUInt16LE(20, 4);
        header.writeUInt16LE(0x808, 6);
        header.writeUInt16LE(0x21, 12);
        header.writeUInt16LE(name.length, 26);
        const source = await entry.open();
        let crc = 0xffffffff,
          size = 0;
        try {
          reserve(header.length + name.length);
          yield header;
          yield name;
          for await (const value of source) {
            const data = Buffer.isBuffer(value)
              ? value
              : Buffer.from(value as Uint8Array);
            size += data.length;
            reserve(data.length);
            for (const byte of data)
              crc = table[(crc ^ byte) & 255]! ^ (crc >>> 8);
            yield data;
          }
        } finally {
          source.destroy();
        }
        crc = (crc ^ 0xffffffff) >>> 0;
        const descriptor = Buffer.alloc(16);
        descriptor.writeUInt32LE(0x08074b50);
        descriptor.writeUInt32LE(crc, 4);
        descriptor.writeUInt32LE(size, 8);
        descriptor.writeUInt32LE(size, 12);
        reserve(16);
        yield descriptor;
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0x808, 8);
        central.writeUInt16LE(0x21, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(size, 20);
        central.writeUInt32LE(size, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt32LE(start, 42);
        directory.push(central, name);
      }
      const start = offset;
      for (const chunk of directory) {
        reserve(chunk.length);
        yield chunk;
      }
      const end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50);
      end.writeUInt16LE(entries.length, 8);
      end.writeUInt16LE(entries.length, 10);
      end.writeUInt32LE(offset - start, 12);
      end.writeUInt32LE(start, 16);
      reserve(end.length);
      yield end;
    })(),
  );
}
