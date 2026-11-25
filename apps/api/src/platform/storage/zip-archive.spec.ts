import { it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { zipArchive } from './zip-archive.js';
async function bytes(stream: Readable) {
  const out: Buffer[] = [];
  for await (const chunk of stream) out.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(out);
}
it('writes standard UTF-8 stored ZIP records, CRC32, sizes and central offsets', async () => {
  const result = await bytes(
    zipArchive([
      {
        name: 'personal-data.json',
        open: async () => Readable.from('123456789'),
      },
    ]),
  );
  expect(result.readUInt32LE()).toBe(0x04034b50);
  const end = result.subarray(-22),
    central = result.readUInt32LE(result.length - 6);
  expect(end.readUInt32LE()).toBe(0x06054b50);
  expect(end.readUInt16LE(10)).toBe(1);
  expect(result.readUInt32LE(central)).toBe(0x02014b50);
  expect(result.readUInt32LE(central + 16)).toBe(0xcbf43926);
  expect(result.readUInt32LE(central + 24)).toBe(9);
  expect(result.readUInt32LE(central + 42)).toBe(0);
  expect(result.subarray(30, 48).toString()).toBe('personal-data.json');
  expect(result.subarray(48, 57).toString()).toBe('123456789');
});
it('rejects unsafe/duplicate paths and bounded archive overflow without a successful directory', async () => {
  const entry = { name: '../private', open: async () => Readable.from('x') };
  expect(() => zipArchive([entry])).toThrow('Unsafe');
  expect(() =>
    zipArchive([
      { ...entry, name: 'same' },
      { ...entry, name: 'same' },
    ]),
  ).toThrow('duplicate');
  await expect(
    bytes(zipArchive([{ ...entry, name: 'safe' }], 35)),
  ).rejects.toThrow('Payload Too Large');
});
it('closes a corrupt source and rejects incomplete archives', async () => {
  const source = Readable.from(
    (async function* () {
      yield Buffer.from('partial');
      throw new Error('Source unavailable');
    })(),
  );
  await expect(
    bytes(zipArchive([{ name: 'safe', open: async () => source }])),
  ).rejects.toThrow('Source unavailable');
  expect(source.destroyed).toBe(true);
});
