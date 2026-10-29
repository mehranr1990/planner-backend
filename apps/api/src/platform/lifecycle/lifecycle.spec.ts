import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ExportBudget } from './personal-data.js';
import { signBackup, verifyBackup } from './backup-manifest.js';
import { AuthorizedSpace } from '../authorization/authorized-space.js';
import { signCursor, readCursor } from '../sync/cursor.js';
const secret = 'test-only-lifecycle-proof-secret-32-characters',
  userId = randomUUID(),
  spaceId = randomUUID(),
  epoch = randomUUID(),
  now = Date.parse('2026-10-29T00:00:00Z');
const scope = AuthorizedSpace.personal(
  { userId, requestId: randomUUID(), correlationId: randomUUID() },
  { id: spaceId, ownerUserId: userId, kind: 'PERSONAL' },
);
describe('P1-12 cursor, retention and bounded portability proofs', () => {
  const claim = {
    v: 1 as const,
    u: userId,
    s: spaceId,
    e: epoch,
    phase: 'INCREMENTAL' as const,
    sequence: '42',
    entity: 0,
    after: null,
    issued: now,
  };
  it('binds valid sync cursors to actor, Space, epoch and retained sequence', () => {
    const signed = signCursor(secret, claim);
    expect(readCursor(secret, signed, scope, epoch, 42n, now)).toEqual(claim);
    expect(() =>
      readCursor(secret, signed, scope, randomUUID(), 0n, now),
    ).toThrow();
    expect(() => readCursor(secret, signed, scope, epoch, 43n, now)).toThrow();
  });
  it('rejects expired, future and tampered cursor proofs deterministically', () => {
    expect(() =>
      readCursor(
        secret,
        signCursor(secret, claim),
        scope,
        epoch,
        0n,
        now + 30 * 86400000 + 1,
      ),
    ).toThrow();
    expect(() =>
      readCursor(
        secret,
        signCursor(secret, { ...claim, issued: now + 60001 }),
        scope,
        epoch,
        0n,
        now,
      ),
    ).toThrow();
    expect(() =>
      readCursor(
        secret,
        signCursor(secret, claim) + 'x',
        scope,
        epoch,
        0n,
        now,
      ),
    ).toThrow();
  });
  it('rejects a correctly signed cursor belonging to another actor or Space', () => {
    expect(() =>
      readCursor(
        secret,
        signCursor(secret, { ...claim, u: randomUUID() }),
        scope,
        epoch,
        0n,
        now,
      ),
    ).toThrow();
    expect(() =>
      readCursor(
        secret,
        signCursor(secret, { ...claim, s: randomUUID() }),
        scope,
        epoch,
        0n,
        now,
      ),
    ).toThrow();
  });
  it('preserves exact decimal strings and every bounded page in a complete export', async () => {
    const budget = new ExportBudget();
    let reads = 0;
    await budget.collect(
      'money',
      async (after: number | undefined) => {
        reads++;
        return after === undefined
          ? [{ id: 1, amount: '9007199254740993.12' }]
          : after === 1
            ? [{ id: 2, amount: '0.01' }]
            : [];
      },
      (v) => v.id,
    );
    expect(reads).toBe(3);
    expect(budget.count).toBe(2);
    expect(budget.sections.money).toEqual([
      { id: 1, amount: '9007199254740993.12' },
      { id: 2, amount: '0.01' },
    ]);
  });
  it('fails oversized record and byte exports without silently dropping data', () => {
    const budget = new ExportBudget();
    budget.count = 100000;
    expect(() => budget.add('overflow', [{ id: 1 }])).toThrow();
    const bytes = new ExportBudget();
    bytes.bytes = 50 * 1024 * 1024;
    expect(() => bytes.add('overflow', [{ body: 'private' }])).toThrow();
  });
  const artifacts = [
      { name: 'database.dump.age', sha256: 'a'.repeat(64) },
      { name: 'private-files.tar.age', sha256: 'b'.repeat(64) },
    ],
    actual = Object.fromEntries(artifacts.map((v) => [v.name, v.sha256]));
  const manifest = {
    version: 1 as const,
    capturedAt: new Date(now - 1000).toISOString(),
    expiresAt: new Date(now + 86400000).toISOString(),
    checkpoint: 'c'.repeat(64),
    artifacts,
  };
  it('verifies signed backup expiry, checkpoint and exact artifact digests', () => {
    expect(
      verifyBackup(secret, signBackup(secret, manifest), actual, new Date(now)),
    ).toEqual(manifest);
  });
  it('rejects expired backups, retention beyond 30 days and future captures', () => {
    for (const value of [
      { ...manifest, expiresAt: new Date(now - 1).toISOString() },
      { ...manifest, expiresAt: new Date(now + 30 * 86400000).toISOString() },
      { ...manifest, capturedAt: new Date(now + 1).toISOString() },
    ])
      expect(() =>
        verifyBackup(secret, signBackup(secret, value), actual, new Date(now)),
      ).toThrow();
  });
  it('rejects unsigned or changed backups, absent artifacts and duplicate names', () => {
    const signed = signBackup(secret, manifest);
    expect(() =>
      verifyBackup(secret, { manifest }, actual, new Date(now)),
    ).toThrow();
    expect(() =>
      verifyBackup(
        secret,
        { ...signed, signature: '0'.repeat(64) },
        actual,
        new Date(now),
      ),
    ).toThrow();
    expect(() =>
      verifyBackup(
        secret,
        signed,
        { ...actual, 'database.dump.age': '0'.repeat(64) },
        new Date(now),
      ),
    ).toThrow();
    expect(() =>
      verifyBackup(
        secret,
        signBackup(secret, {
          ...manifest,
          artifacts: [artifacts[0]!, artifacts[0]!],
        }),
        actual,
        new Date(now),
      ),
    ).toThrow();
  });
});
