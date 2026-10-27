import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { FileUploadSchema, StoredFileSchema } from '@mehran/api-contracts';
import { parseEnvironment } from '../../bootstrap/environment.js';
import { LocalFileStorage } from './local-storage.js';
import { validContent } from './content-policy.js';
import { fileDownloadLink, verifyFileLink } from './download-links.js';
import { AuthorizedSpace } from '../authorization/authorized-space.js';

const configFor = (root: string) =>
  parseEnvironment({
    DATABASE_URL: 'postgresql://localhost/unused_test',
    BETTER_AUTH_URL: 'http://localhost:3000',
    BETTER_AUTH_SECRET: 'test-only-private-file-link-secret-32-characters',
    STORAGE_ROOT: root,
  });
const hash = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');
describe('private filesystem and boundary security', () => {
  let fixture: string;
  let root: string;
  let storage: LocalFileStorage;
  beforeEach(async () => {
    await fs.mkdir('.tools', { recursive: true });
    fixture = await fs.mkdtemp(path.resolve('.tools/storage-unit-'));
    root = path.join(fixture, 'private');
    storage = new LocalFileStorage(configFor(root));
    await storage.onModuleInit();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    if (
      !fixture.startsWith(path.resolve('.tools') + path.sep) ||
      !path.basename(fixture).startsWith('storage-unit-')
    )
      throw new Error('Unsafe fixture cleanup');
    await fs.rm(fixture, { recursive: true, force: true });
  });
  it('rejects path/header filenames, reserved names, overposting, unsupported MIME and invalid limits', () => {
    const valid = {
      filename: 'private note.txt',
      mimeType: 'text/plain',
      expectedSize: 5,
    };
    expect(FileUploadSchema.parse(valid)).toEqual(valid);
    for (const filename of [
      '../private.txt',
      'C:\\secret.txt',
      'NUL.txt',
      'a\r\nheader.txt',
      ' .hidden',
      'a.exe',
      'a.svg',
      'broken\ud800.txt',
    ])
      expect(() => FileUploadSchema.parse({ ...valid, filename })).toThrow();
    for (const extra of [
      { ownerUserId: randomUUID() },
      { spaceId: randomUUID() },
      { objectKey: randomUUID() },
      { actualSize: 5 },
      { mimeType: 'text/html' },
      { expectedSize: 0 },
      { expectedSize: 104857601 },
    ])
      expect(() => FileUploadSchema.parse({ ...valid, ...extra })).toThrow();
    expect(StoredFileSchema.shape).not.toHaveProperty('objectKey');
  });
  it('recognizes allowed signatures and rejects executable markup disguised as plain text', () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    expect(
      validContent('image/png', png, Buffer.from('49454e44ae426082', 'hex')),
    ).toBe(true);
    expect(
      validContent(
        'image/jpeg',
        Buffer.from('ffd8ff', 'hex'),
        Buffer.from('ffd9', 'hex'),
      ),
    ).toBe(true);
    expect(
      validContent(
        'application/pdf',
        Buffer.from('%PDF-1.7'),
        Buffer.from('%%EOF\n'),
      ),
    ).toBe(true);
    expect(
      validContent(
        'text/plain',
        Buffer.from('<svg onload="evil">'),
        Buffer.alloc(0),
      ),
    ).toBe(false);
    expect(
      validContent('image/png', Buffer.from('private text'), Buffer.alloc(0)),
    ).toBe(false);
  });
  it('streams UTF-8 bytes, verifies checksum, never uses names as paths, and deletes idempotently', async () => {
    const key = randomUUID(),
      attempt = randomUUID(),
      data = Buffer.from('private سلام\n');
    const written = await storage.write(
      key,
      attempt,
      Readable.from([data.subarray(0, 11), data.subarray(11)]),
      { size: data.length, mimeType: 'text/plain', sha256: hash(data) },
      new AbortController().signal,
    );
    expect(written).toEqual({ size: data.length, sha256: hash(data) });
    const chunks: Buffer[] = [];
    for await (const chunk of await storage.open(key, written))
      chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks)).toEqual(data);
    expect(await fs.readdir(root)).toEqual([key + '.blob']);
    await storage.remove(key, attempt);
    await storage.remove(key, attempt);
    expect(await fs.readdir(root)).toEqual([]);
  });
  it('rejects excess/short bytes, wrong hash/type, invalid UTF-8 and control bytes without staging residue', async () => {
    for (const [bytes, expected] of [
      [Buffer.from('abc'), { size: 2, mimeType: 'text/plain' }],
      [Buffer.from('abc'), { size: 4, mimeType: 'text/plain' }],
      [
        Buffer.from('abc'),
        { size: 3, mimeType: 'text/plain', sha256: 'a'.repeat(64) },
      ],
      [Buffer.from('abc'), { size: 3, mimeType: 'image/png' }],
      [Buffer.from([0xff]), { size: 1, mimeType: 'text/plain' }],
      [Buffer.from([0]), { size: 1, mimeType: 'text/plain' }],
    ] as const)
      await expect(
        storage.write(
          randomUUID(),
          randomUUID(),
          Readable.from([bytes]),
          expected,
          new AbortController().signal,
        ),
      ).rejects.toThrow('Private storage operation failed');
    expect(await fs.readdir(root)).toEqual([]);
  });
  it('cancels an active stream and removes partial bytes', async () => {
    const abort = new AbortController();
    const source = Readable.from(
      (async function* () {
        yield Buffer.from('abc');
        abort.abort();
        yield Buffer.from('def');
      })(),
    );
    await expect(
      storage.write(
        randomUUID(),
        randomUUID(),
        source,
        { size: 6, mimeType: 'text/plain' },
        abort.signal,
      ),
    ).rejects.toThrow();
    expect(await fs.readdir(root)).toEqual([]);
  });
  it('refuses traversal keys, external hardlinks and corrupt bytes', async () => {
    await expect(storage.remove('../outside')).rejects.toThrow();
    const key = randomUUID(),
      attempt = randomUUID(),
      data = Buffer.from('abc');
    const evidence = await storage.write(
      key,
      attempt,
      Readable.from([data]),
      { size: 3, mimeType: 'text/plain' },
      new AbortController().signal,
    );
    await fs.writeFile(path.join(root, key + '.blob'), 'def');
    await expect(storage.open(key, evidence)).rejects.toThrow();
    await fs.link(
      path.join(root, key + '.blob'),
      path.join(fixture, 'external'),
    );
    await expect(storage.open(key, evidence)).rejects.toThrow();
    await expect(storage.remove(key)).rejects.toThrow();
    expect(await fs.readFile(path.join(fixture, 'external'), 'utf8')).toBe(
      'def',
    );
  });
  it('recovers its own publication hard-link pair after a crash', async () => {
    const key = randomUUID(),
      attempt = randomUUID();
    await fs.writeFile(path.join(root, `${key}.${attempt}.part`), 'private');
    await fs.link(
      path.join(root, `${key}.${attempt}.part`),
      path.join(root, key + '.blob'),
    );
    await storage.remove(key, attempt);
    expect(await fs.readdir(root)).toEqual([]);
  });
  it('rejects a symlink/junction storage root with a safe startup failure', async () => {
    const alias = path.join(fixture, 'alias');
    await fs.symlink(root, alias, 'junction');
    await expect(
      new LocalFileStorage(configFor(alias)).onModuleInit(),
    ).rejects.toThrow('Private storage initialization failed');
  });
  it('binds short-lived signatures to the owner, space, file and expiry', () => {
    const actor = {
      userId: randomUUID(),
      requestId: randomUUID(),
      correlationId: randomUUID(),
    };
    const scope = AuthorizedSpace.personal(actor, {
      id: randomUUID(),
      kind: 'PERSONAL',
      ownerUserId: actor.userId,
    });
    const id = randomUUID(),
      config = configFor(root);
    const link = fileDownloadLink(config, scope, id);
    const query = Object.fromEntries(
      new URL(link.url, 'http://localhost').searchParams,
    ) as { expires: string; signature: string };
    expect(() => verifyFileLink(config, scope, id, query)).not.toThrow();
    expect(() => verifyFileLink(config, scope, randomUUID(), query)).toThrow();
    expect(() =>
      verifyFileLink(config, scope, id, {
        ...query,
        signature: '0'.repeat(64),
      }),
    ).toThrow();
    vi.spyOn(Date, 'now').mockReturnValue(Number(query.expires) * 1000);
    expect(() => verifyFileLink(config, scope, id, query)).toThrow();
  });
});
