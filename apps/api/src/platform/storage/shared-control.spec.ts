import 'reflect-metadata';
import { it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { SharedControl } from './shared-control.js';
import { parseEnvironment } from '../../bootstrap/environment.js';
it('rechecks immutable evidence metadata and rejects tampering after signature verification was cached', async () => {
  const root = fs.mkdtempSync(path.resolve('.tools/control-integrity-'));
  const config = parseEnvironment({
    DATABASE_URL: 'postgresql://unused@localhost/unused',
    BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
    BETTER_AUTH_URL: 'http://localhost:3000',
    STORAGE_ROOT: path.join(root, 'files'),
    SHARED_CONTROL_ROOT: path.join(root, 'control'),
    SHARED_CONTROL_KEYS: JSON.stringify({
      k1: randomBytes(48).toString('base64url'),
    }),
    SHARED_CONTROL_ACTIVE_KEY_ID: 'k1',
  });
  const control = new SharedControl(config),
    spaceId = randomUUID();
  await control.initialize();
  await control.append({
    id: randomUUID(),
    spaceId,
    version: '2',
    action: 'membership.change',
    resourceId: randomUUID(),
    outcome: 'COMMITTED',
    at: new Date().toISOString(),
  });
  await expect(control.assertCurrent(spaceId, 1n)).rejects.toThrow();
  expect(await control.records()).toHaveLength(1);
  const file = fs
    .readdirSync(config.SHARED_CONTROL_ROOT!)
    .find((f) => !f.startsWith('00000000-0000-4000-8000-000000000031'))!;
  const filename = path.join(config.SHARED_CONTROL_ROOT!, file),
    envelope = JSON.parse(fs.readFileSync(filename, 'utf8'));
  envelope.signature = '0'.repeat(64);
  fs.writeFileSync(filename, JSON.stringify(envelope));
  await expect(control.records()).rejects.toThrow(
    'Invalid shared control signature',
  );
});

it('accepts only the exact signed staging/publication hard-link pair during atomic publication', async () => {
  const root = fs.mkdtempSync(path.resolve('.tools/control-publication-'));
  const config = parseEnvironment({
    DATABASE_URL: 'postgresql://unused@localhost/unused',
    BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
    BETTER_AUTH_URL: 'http://localhost:3000',
    STORAGE_ROOT: path.join(root, 'files'),
    SHARED_CONTROL_ROOT: path.join(root, 'control'),
    SHARED_CONTROL_KEYS: JSON.stringify({
      k1: randomBytes(48).toString('base64url'),
    }),
    SHARED_CONTROL_ACTIVE_KEY_ID: 'k1',
  });
  const control = new SharedControl(config),
    spaceId = randomUUID();
  await control.initialize();
  await control.append({
    id: randomUUID(),
    spaceId,
    version: '2',
    action: 'membership.change',
    resourceId: randomUUID(),
    outcome: 'COMMITTED',
    at: new Date().toISOString(),
  });
  expect(await control.records()).toHaveLength(1);
  const name = fs
      .readdirSync(config.SHARED_CONTROL_ROOT!)
      .find((name) => !name.startsWith('00000000-'))!,
    final = path.join(config.SHARED_CONTROL_ROOT!, name),
    part = path.join(
      config.SHARED_CONTROL_ROOT!,
      name.slice(0, -5) + '.' + randomUUID() + '.part',
    );
  fs.linkSync(final, part);
  expect(fs.lstatSync(final).nlink).toBe(2);
  // This is the precise filesystem state held between link() and unlink().
  expect(await control.records()).toHaveLength(1);
  await expect(control.assertCurrent(spaceId, 1n)).rejects.toThrow();
  const original = fs.readFileSync(final, 'utf8'),
    forged = JSON.parse(original);
  forged.signature = '0'.repeat(64);
  fs.writeFileSync(final, JSON.stringify(forged));
  await expect(control.records()).rejects.toThrow(
    'Invalid shared control signature',
  );
  fs.writeFileSync(final, original);
  fs.unlinkSync(part);
  expect(await control.records()).toHaveLength(1);
  const unexpected = path.join(root, 'unexpected-link');
  fs.linkSync(final, unexpected);
  fs.writeFileSync(part, 'unrelated staging inode');
  await expect(control.records()).rejects.toThrow(
    'Invalid shared control artifact',
  );
  fs.unlinkSync(part);
  fs.unlinkSync(unexpected);
  fs.linkSync(final, part);
  fs.linkSync(final, unexpected);
  expect(fs.lstatSync(final).nlink).toBe(3);
  await expect(control.records()).rejects.toThrow(
    'Invalid shared control artifact',
  );
  fs.unlinkSync(part);
  fs.unlinkSync(unexpected);
  expect(await control.records()).toHaveLength(1);
});
