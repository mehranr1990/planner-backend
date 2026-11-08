import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { migrationSandbox } from '../../../../tooling/testing/migration-sandbox.js';
import type { Prisma } from '../../src/generated/prisma/client.js';
import {
  snapshotCustodyGraph,
  moveCustodyGraph,
} from '../../src/platform/database/custody-graph.js';
import type { CustodyGraphScope } from '../../src/platform/database/custody-graph.js';
let sandbox: Awaited<ReturnType<typeof migrationSandbox>>;
let tx: Prisma.TransactionClient;
const source = randomUUID(),
  company = randomUUID(),
  other = randomUUID();
const tables = [
  {
    table: 'CustodyGraphFixture',
    select: ['spaceId', 'sourceSpaceId'],
    move: ['spaceId', 'sourceSpaceId'],
  },
];
let open = true;
const scope: CustodyGraphScope = {
  sourceSpaceId: source,
  destinationSpaceId: company,
  transferId: randomUUID(),
  verify: (actual, moving) => {
    if (actual !== tx || !open)
      throw Error('Closed or foreign custody graph authority');
    if (moving && !writable) throw Error('Read-only custody preview');
  },
};
let writable = false;
beforeAll(async () => {
  sandbox = await migrationSandbox(process.env);
  tx = {
    $queryRawUnsafe: async (sql: string, ...args: unknown[]) =>
      (await sandbox.query(sql, args)).rows,
    $executeRawUnsafe: async (sql: string, ...args: unknown[]) =>
      (await sandbox.query(sql, args)).rowCount,
  } as unknown as Prisma.TransactionClient;
  await sandbox.query(
    'CREATE TABLE "CustodyGraphFixture"(id uuid PRIMARY KEY,"spaceId" uuid NOT NULL,"sourceSpaceId" uuid NOT NULL,body text NOT NULL)',
  );
}, 30000);
afterAll(async () => {
  open = false;
  await sandbox?.close();
});
it('seals bodies and preserves independently owned rows while changing only selected custody locators', async () => {
  const local = randomUUID(),
    incoming = randomUUID(),
    unrelated = randomUUID();
  const secret = 'sealed participant record ' + randomUUID();
  await sandbox.query(
    'INSERT INTO "CustodyGraphFixture" VALUES($1,$4,$4,$7),($2,$5,$4,$8),($3,$5,$6,$9)',
    [
      local,
      incoming,
      unrelated,
      source,
      other,
      company,
      secret,
      'independent Team reference',
      'unrelated',
    ],
  );
  const parts = await snapshotCustodyGraph(tx, scope, tables);
  expect(parts[0]!.rows.map((r) => r.key.id).sort()).toEqual(
    [local, incoming].sort(),
  );
  expect(JSON.stringify(parts)).not.toContain(secret);
  expect(parts[0]!.rows.every((r) => /^[a-f0-9]{64}$/.test(r.digest))).toBe(
    true,
  );
  await expect(moveCustodyGraph(tx, scope, tables)).rejects.toThrow(
    'Read-only',
  );
  writable = true;
  await moveCustodyGraph(tx, scope, tables);
  writable = false;
  const rows = (
    await sandbox.query('SELECT * FROM "CustodyGraphFixture" ORDER BY id')
  ).rows as {
    id: string;
    spaceId: string;
    sourceSpaceId: string;
    body: string;
  }[];
  expect(rows.find((r) => r.id === local)).toEqual({
    id: local,
    spaceId: company,
    sourceSpaceId: company,
    body: secret,
  });
  expect(rows.find((r) => r.id === incoming)).toEqual({
    id: incoming,
    spaceId: other,
    sourceSpaceId: company,
    body: 'independent Team reference',
  });
  expect(rows.find((r) => r.id === unrelated)).toEqual({
    id: unrelated,
    spaceId: other,
    sourceSpaceId: company,
    body: 'unrelated',
  });
});
it('refuses foreign transaction authority and rejects an oversized graph without moving any row', async () => {
  await expect(
    snapshotCustodyGraph({} as Prisma.TransactionClient, scope, tables),
  ).rejects.toThrow('foreign');
  await sandbox.query(
    'INSERT INTO "CustodyGraphFixture" SELECT md5(n::text)::uuid,$1,$2,\'bounded fixture\' FROM generate_series(1,2001) n',
    [source, other],
  );
  await expect(snapshotCustodyGraph(tx, scope, tables)).rejects.toMatchObject({
    response: { code: 'CUSTODY_GRAPH_LIMIT' },
  });
  expect(
    (
      await sandbox.query(
        'SELECT count(*)::int n FROM "CustodyGraphFixture" WHERE "spaceId"=$1',
        [source],
      )
    ).rows[0].n,
  ).toBe(2001);
});
