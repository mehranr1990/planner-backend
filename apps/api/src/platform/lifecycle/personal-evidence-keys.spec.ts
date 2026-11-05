import 'reflect-metadata';
import { it, expect } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PersonalEvidenceKeys } from './personal-evidence-keys.js';
import { signBackup, verifyBackup } from './backup-manifest.js';
import { ErasureControl } from '../storage/erasure-control.js';
import { parseEnvironment } from '../../bootstrap/environment.js';
const material = () =>
  Object.fromEntries(
    ['control', 'identity', 'backup', 'capability'].map((p) => [
      p,
      randomBytes(48).toString('base64url'),
    ]),
  ) as Record<'control' | 'identity' | 'backup' | 'capability', string>;
it('keeps v1 controls, digests and issued recovery capabilities valid while independent keys rotate', async () => {
  const secret = randomBytes(48).toString('base64url'),
    root = fs.mkdtempSync(path.resolve('.tools/personal-key-migration-'));
  const config = parseEnvironment({
    DATABASE_URL: 'postgresql://unused@localhost/unused',
    BETTER_AUTH_URL: 'http://localhost:3000',
    BETTER_AUTH_SECRET: secret,
    STORAGE_ROOT: path.join(root, 'files'),
    ERASURE_CONTROL_ROOT: path.join(root, 'control'),
  });
  const legacy = new ErasureControl(config);
  await legacy.initialize();
  const id = randomUUID(),
    identity = randomUUID(),
    space = randomUUID(),
    now = new Date();
  const record = {
    jobId: id,
    identityDigest: legacy.digest('identity', identity),
    spaceDigest: legacy.digest('space', space),
    state: 'CLOSED' as const,
    at: now.toISOString(),
    eraseAfter: new Date(now.getTime() + 7 * 86400000).toISOString(),
    policyVersion: 'SYNTHETIC',
    recoveryHash: 'a'.repeat(64),
  };
  await legacy.append(record);
  const a = material(),
    b = material();
  const rotatedConfig = {
    ...config,
    BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
    PERSONAL_EVIDENCE_LEGACY_KEY: secret,
    PERSONAL_EVIDENCE_KEYS: JSON.stringify({ a, b }),
    PERSONAL_EVIDENCE_ACTIVE_KEY_ID: 'a',
  };
  const rotated = new ErasureControl(rotatedConfig);
  await rotated.onModuleInit();
  expect(await rotated.records()).toEqual([record]);
  expect(
    rotated.matchesDigest('identity', identity, record.identityDigest),
  ).toBe(true);
  expect(rotated.keys.capabilities(id, 'recovery')).toContain(
    legacy.keys.capability(id, 'recovery'),
  );
  const next = {
    ...record,
    jobId: randomUUID(),
    digestKeyId: 'a',
    identityDigest: rotated.digest('identity', identity),
  };
  await rotated.append(next);
  const later = new ErasureControl({
    ...rotatedConfig,
    PERSONAL_EVIDENCE_ACTIVE_KEY_ID: 'b',
  });
  await later.onModuleInit();
  expect(await later.records()).toHaveLength(2);
  expect(later.matchesDigest('identity', identity, next.identityDigest)).toBe(
    true,
  );
  expect(later.keys.capabilities(id, 'recovery')).toContain(
    rotated.keys.capability(id, 'recovery'),
  );
  const retired = new ErasureControl({
    ...rotatedConfig,
    PERSONAL_EVIDENCE_KEYS: JSON.stringify({ b }),
    PERSONAL_EVIDENCE_ACTIVE_KEY_ID: 'b',
  });
  await retired.onModuleInit();
  await expect(retired.records()).rejects.toThrow(
    'Unknown Personal evidence key ID',
  );
  const noLegacy = new ErasureControl({
    ...rotatedConfig,
    PERSONAL_EVIDENCE_LEGACY_KEY: undefined,
  });
  await noLegacy.onModuleInit();
  await expect(noLegacy.records()).rejects.toThrow('missing legacy');
});
it('binds purpose and key ID, rejects substitution and verifies legacy plus rotated backup manifests', () => {
  const old = randomBytes(48).toString('base64url'),
    a = material(),
    b = material();
  const keys = new PersonalEvidenceKeys({
    BETTER_AUTH_SECRET: 'synthetic-auth-secret-at-least-32-characters',
    PERSONAL_EVIDENCE_KEYS: JSON.stringify({ a, b }),
    PERSONAL_EVIDENCE_ACTIVE_KEY_ID: 'b',
    PERSONAL_EVIDENCE_LEGACY_KEY: old,
  });
  const signed = keys.sign('control', 'test', 'legacy:');
  expect(() => keys.verify('backup', 'test', signed, 'legacy:')).toThrow();
  expect(() =>
    keys.verify('control', 'test', { ...signed, keyId: 'a' }, 'legacy:'),
  ).toThrow();
  expect(() => keys.verify('control', 'tampered', signed, 'legacy:')).toThrow();
  const now = Date.now(),
    manifest = {
      version: 1 as const,
      capturedAt: new Date(now - 1000).toISOString(),
      expiresAt: new Date(now + 86400000).toISOString(),
      checkpoint: 'a'.repeat(64),
      artifacts: [
        { name: 'db.dump', sha256: 'b'.repeat(64) },
        { name: 'files.tar', sha256: 'c'.repeat(64) },
      ],
    },
    actual = Object.fromEntries(
      manifest.artifacts.map((v) => [v.name, v.sha256]),
    );
  expect(verifyBackup(keys, signBackup(old, manifest), actual)).toEqual(
    manifest,
  );
  const fresh = signBackup(keys, manifest);
  expect(fresh.version).toBe(2);
  expect(verifyBackup(keys, fresh, actual)).toEqual(manifest);
  expect(
    () =>
      new PersonalEvidenceKeys({
        BETTER_AUTH_SECRET: old,
        PERSONAL_EVIDENCE_KEYS: JSON.stringify({ a: { ...a, control: old } }),
        PERSONAL_EVIDENCE_ACTIVE_KEY_ID: 'a',
      }),
  ).toThrow('values withheld');
  expect(
    () =>
      new PersonalEvidenceKeys({
        BETTER_AUTH_SECRET: old,
        PERSONAL_EVIDENCE_KEYS: JSON.stringify({
          a: { ...a, backup: a.control },
        }),
        PERSONAL_EVIDENCE_ACTIVE_KEY_ID: 'a',
      }),
  ).toThrow();
});
