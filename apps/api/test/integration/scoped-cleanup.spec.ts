import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { migrationSandbox } from '../../../../tooling/testing/migration-sandbox.js';
import type { Prisma } from '../../src/generated/prisma/client.js';
import {
  sharedDeleteBatch,
  sharedVersionedDelete,
} from '../../src/platform/lifecycle/shared-cleanup.js';
import type { SharedCleanupScope } from '../../src/platform/lifecycle/shared-cleanup.js';

let sandbox: Awaited<ReturnType<typeof migrationSandbox>>;
let tx: Prisma.TransactionClient;
let open = true;
const company = randomUUID(),
  source = randomUUID(),
  sibling = randomUUID(),
  otherCompany = randomUUID();
const scope: SharedCleanupScope = {
  spaceId: company,
  scopeId: source,
  jobId: randomUUID(),
  lockedUsers: [],
  verify(actual) {
    if (!open || actual !== tx)
      throw Error('Foreign or expired cleanup authority');
  },
};
beforeAll(async () => {
  sandbox = await migrationSandbox(process.env);
  tx = {
    $queryRawUnsafe: async (sql: string, ...args: unknown[]) =>
      (await sandbox.query(sql, args)).rows,
    $executeRawUnsafe: async (sql: string, ...args: unknown[]) =>
      (await sandbox.query(sql, args)).rowCount,
  } as unknown as Prisma.TransactionClient;
  await sandbox.query(
    'CREATE TABLE "ScopedCleanupRoot"(id uuid PRIMARY KEY,"spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"currentVersion" int NOT NULL,body text NOT NULL)',
  );
  await sandbox.query(
    'CREATE TABLE "ScopedCleanupChild"(id uuid PRIMARY KEY,"spaceId" uuid NOT NULL,"rootId" uuid NOT NULL REFERENCES "ScopedCleanupRoot"(id),body text NOT NULL)',
  );
  await sandbox.query(
    'CREATE TABLE "ScopedCleanupVersion"("spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"rootId" uuid NOT NULL,version int NOT NULL,body text NOT NULL,PRIMARY KEY("rootId",version),FOREIGN KEY("rootId") REFERENCES "ScopedCleanupRoot"(id) DEFERRABLE INITIALLY DEFERRED)',
  );
}, 30000);
afterAll(async () => {
  open = false;
  await sandbox?.close();
});

it('deletes only the authorized source and its joined children within shared physical custody', async () => {
  const roots = [randomUUID(), randomUUID(), randomUUID()];
  for (const [i, id] of roots.entries()) {
    const spaceId = i === 2 ? otherCompany : company,
      scopeId = i === 0 ? source : sibling;
    await sandbox.query(
      'INSERT INTO "ScopedCleanupRoot" VALUES($1,$2,$3,1,$4)',
      [id, spaceId, scopeId, 'sealed root ' + i],
    );
    await sandbox.query(
      'INSERT INTO "ScopedCleanupChild" VALUES($1,$2,$3,$4)',
      [randomUUID(), spaceId, id, 'sealed child ' + i],
    );
  }
  expect(
    await sharedDeleteBatch(tx, scope, ['ScopedCleanupChild'], {
      ScopedCleanupChild: { table: 'ScopedCleanupRoot', foreignKey: 'rootId' },
    }),
  ).toBe(false);
  expect(
    await sharedDeleteBatch(tx, scope, ['ScopedCleanupChild'], {
      ScopedCleanupChild: { table: 'ScopedCleanupRoot', foreignKey: 'rootId' },
    }),
  ).toBe(true);
  expect(await sharedDeleteBatch(tx, scope, ['ScopedCleanupRoot'])).toBe(false);
  expect(
    (
      await sandbox.query(
        'SELECT id,body FROM "ScopedCleanupRoot" ORDER BY body',
      )
    ).rows,
  ).toEqual([
    { id: roots[1], body: 'sealed root 1' },
    { id: roots[2], body: 'sealed root 2' },
  ]);
  expect(
    (await sandbox.query('SELECT body FROM "ScopedCleanupChild" ORDER BY body'))
      .rows,
  ).toEqual([{ body: 'sealed child 1' }, { body: 'sealed child 2' }]);
});

it('keeps sibling current versions and immutable historical bodies during bounded source version disposal', async () => {
  const roots = [randomUUID(), randomUUID()];
  for (const [i, id] of roots.entries()) {
    const scopeId = i === 0 ? source : sibling;
    await sandbox.query(
      'INSERT INTO "ScopedCleanupRoot" VALUES($1,$2,$3,2,$4)',
      [id, company, scopeId, 'versioned root ' + i],
    );
    await sandbox.query(
      'INSERT INTO "ScopedCleanupVersion" VALUES($1,$2,$3,1,$4),($1,$2,$3,2,$5)',
      [company, scopeId, id, 'sealed old ' + i, 'sealed current ' + i],
    );
  }
  expect(
    await sharedVersionedDelete(
      tx,
      scope,
      'ScopedCleanupRoot',
      'ScopedCleanupVersion',
      'rootId',
    ),
  ).toBe(false);
  expect(
    (
      await sandbox.query(
        'SELECT body FROM "ScopedCleanupVersion" ORDER BY body',
      )
    ).rows,
  ).toEqual([
    { body: 'sealed current 0' },
    { body: 'sealed current 1' },
    { body: 'sealed old 1' },
  ]);
  expect(
    await sharedVersionedDelete(
      tx,
      scope,
      'ScopedCleanupRoot',
      'ScopedCleanupVersion',
      'rootId',
    ),
  ).toBe(false);
  expect(
    (
      await sandbox.query(
        'SELECT body FROM "ScopedCleanupVersion" ORDER BY body',
      )
    ).rows,
  ).toEqual([{ body: 'sealed current 1' }, { body: 'sealed old 1' }]);
});

it('rejects foreign or expired authority and untrusted table identifiers before a delete', async () => {
  const before = (
    await sandbox.query('SELECT count(*)::int count FROM "ScopedCleanupRoot"')
  ).rows;
  await expect(
    sharedDeleteBatch({} as Prisma.TransactionClient, scope, [
      'ScopedCleanupRoot',
    ]),
  ).rejects.toThrow('Foreign');
  await expect(
    sharedDeleteBatch(tx, scope, ['ScopedCleanupRoot; DROP TABLE x']),
  ).rejects.toThrow('Invalid');
  open = false;
  await expect(
    sharedVersionedDelete(
      tx,
      scope,
      'ScopedCleanupRoot',
      'ScopedCleanupVersion',
      'rootId',
    ),
  ).rejects.toThrow('expired');
  open = true;
  expect(
    (await sandbox.query('SELECT count(*)::int count FROM "ScopedCleanupRoot"'))
      .rows,
  ).toEqual(before);
});
