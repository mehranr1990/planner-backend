import { beforeEach, afterEach, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import {
  encryptBackup,
  copyEncryptedBackup,
  verifyEncryptedBackup,
  decryptBackup,
} from './encrypted-backup.js';
import { signBackup } from '../lifecycle/backup-manifest.js';
import { PersonalEvidenceKeys } from '../lifecycle/personal-evidence-keys.js';
let root: string;
const keys = new PersonalEvidenceKeys({
  BETTER_AUTH_SECRET: 'unit-test-only-backup-key-at-least-32-characters',
});
const key = randomBytes(32),
  hash = (v: Buffer) => createHash('sha256').update(v).digest('hex');
beforeEach(async () => {
  await fs.mkdir('.tools', { recursive: true });
  root = await fs.mkdtemp(path.resolve('.tools/p3-encryption-'));
});
afterEach(async () => {
  if (!root.startsWith(path.resolve('.tools') + path.sep))
    throw new Error('Unsafe fixture root');
  await fs.rm(root, { recursive: true, force: true });
});
async function fixture() {
  const source = path.join(root, 'source');
  await fs.mkdir(source);
  const values = {
    'planner.dump': randomBytes(100000),
    'files.tar.gz': randomBytes(50000),
    'control.tar.gz': randomBytes(16000),
  };
  for (const [name, value] of Object.entries(values))
    await fs.writeFile(path.join(source, name), value);
  const now = new Date(),
    envelope = signBackup(keys, {
      version: 1,
      capturedAt: now.toISOString(),
      expiresAt: new Date(+now + 3 * 86400000).toISOString(),
      checkpoint: 'a'.repeat(64),
      artifacts: ['planner.dump', 'files.tar.gz'].map((name) => ({
        name,
        sha256: hash(values[name as keyof typeof values]),
      })),
    });
  await fs.writeFile(
    path.join(source, 'manifest.json'),
    JSON.stringify(envelope),
  );
  return { source, values };
}
it('encrypts, authenticates, copies, decrypts and honors the frozen shorter retention without rewriting the signed source', async () => {
  const { source, values } = await fixture(),
    original = await fs.readFile(path.join(source, 'manifest.json'));
  const destination = path.join(root, 'encrypted'),
    offHost = path.join(root, 'copy'),
    restored = path.join(root, 'restored'),
    deadline = new Date(Date.now() + 86400000);
  const bundle = await encryptBackup({
    runId: randomUUID(),
    source,
    destination,
    key,
    keys,
    expiresNoLaterThan: deadline,
  });
  expect(bundle.expiresAt).toBe(deadline.toISOString());
  expect(await fs.readFile(path.join(source, 'manifest.json'))).toEqual(
    original,
  );
  expect(
    await fs.readFile(path.join(destination, 'planner.dump.enc')),
  ).not.toEqual(values['planner.dump']);
  expect(await copyEncryptedBackup(destination, offHost, key, keys)).toEqual(
    bundle,
  );
  await decryptBackup(offHost, restored, key, keys);
  expect(await fs.readFile(path.join(restored, 'planner.dump'))).toEqual(
    values['planner.dump'],
  );
  expect(await fs.readFile(path.join(restored, 'control.tar.gz'))).toEqual(
    values['control.tar.gz'],
  );
  await expect(
    copyEncryptedBackup(destination, offHost, key, keys),
  ).rejects.toThrow();
});
it('rejects a wrong key, encrypted tampering, changed signatures and overlapping roots', async () => {
  const { source } = await fixture(),
    destination = path.join(root, 'encrypted');
  await encryptBackup({
    runId: randomUUID(),
    source,
    destination,
    key,
    keys,
    expiresNoLaterThan: new Date(Date.now() + 86400000),
  });
  await expect(
    verifyEncryptedBackup(destination, randomBytes(32), keys),
  ).rejects.toThrow();
  await expect(
    copyEncryptedBackup(destination, destination, key, keys),
  ).rejects.toThrow();
  const file = path.join(destination, 'files.tar.gz.enc'),
    bytes = await fs.readFile(file);
  bytes[0] = bytes[0]! ^ 1;
  await fs.writeFile(file, bytes);
  await expect(verifyEncryptedBackup(destination, key, keys)).rejects.toThrow(
    'checksum',
  );
  const envelope = JSON.parse(
    await fs.readFile(path.join(destination, 'bundle.json'), 'utf8'),
  ) as { signature: string };
  envelope.signature = 'f'.repeat(64);
  await fs.writeFile(
    path.join(destination, 'bundle.json'),
    JSON.stringify(envelope),
  );
  await expect(verifyEncryptedBackup(destination, key, keys)).rejects.toThrow(
    'signature',
  );
});
