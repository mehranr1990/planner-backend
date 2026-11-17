import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { migrationSandbox } from '../../../../tooling/testing/migration-sandbox.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import { CollaborationLimit } from '../../src/modules/spaces/application/collaboration-limit.js';
import type { DatabaseService } from '../../src/platform/database/database.service.js';
import type { SharedControl } from '../../src/platform/storage/shared-control.js';

let sandbox: Awaited<ReturnType<typeof migrationSandbox>>;
let client: PrismaClient;
let limit: CollaborationLimit;
const key = (s: string) => createHash('sha256').update(s).digest('hex');
beforeAll(async () => {
  sandbox = await migrationSandbox(process.env);
  // Exact current limiter table, exclusively owned test schema; no business data.
  await sandbox.query(`CREATE TABLE "SharedRateLimit" (
    "keyHash" char(64) PRIMARY KEY CHECK ("keyHash" ~ '^[0-9a-f]{64}$'),
    "windowAt" timestamptz(3) NOT NULL, requests INTEGER NOT NULL CHECK (requests>0),
    "expiresAt" timestamptz(3) NOT NULL)`);
  const schema = new URL(sandbox.url).searchParams.get('schema')!;
  client = new PrismaClient({
    adapter: new PrismaPg(
      {
        connectionString: isolatedTestDatabaseUrl(process.env),
        options: '-c search_path=' + schema,
        max: 8,
      },
      { schema },
    ),
  });
  limit = new CollaborationLimit(
    { client } as DatabaseService,
    { opaqueRateKey: key } as SharedControl,
  );
});
afterAll(async () => {
  await client?.$disconnect();
  await sandbox?.close();
});

it('atomically admits exactly the configured concurrent burst and returns DB-time retry seconds', async () => {
  const subject = randomUUID();
  const results = await Promise.allSettled(
    Array.from({ length: 25 }, () => limit.take(subject, 20)),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(20);
  const denied = results.filter((r) => r.status === 'rejected');
  expect(denied).toHaveLength(5);
  for (const r of denied) {
    const state = (r.reason as { state: { reset: number; remaining: number } })
      .state;
    expect(state.remaining).toBe(0);
    expect(state.reset).toBeGreaterThanOrEqual(1);
    expect(state.reset).toBeLessThanOrEqual(60);
  }
  const rows = await client.$queryRaw<
    { reset: number; requests: number }[]
  >`SELECT requests, GREATEST(1,ceil(extract(epoch FROM ("windowAt"+interval '1 minute'-clock_timestamp()))))::integer AS reset FROM "SharedRateLimit" WHERE "keyHash"=${key(subject)}`;
  expect(rows[0]!.requests).toBe(25);
  for (const r of denied) {
    const state = (r.reason as { state: { reset: number } }).state;
    expect(Math.abs(state.reset - rows[0]!.reset)).toBeLessThanOrEqual(1);
  }
});

it('resets a past window without waiting and preserves the independent counter', async () => {
  const a = randomUUID(),
    b = randomUUID();
  await limit.take(a, 1);
  await limit.take(b, 1);
  await client.$executeRaw`UPDATE "SharedRateLimit" SET "windowAt"=date_trunc('minute',clock_timestamp())-interval '1 minute' WHERE "keyHash"=${key(a)}`;
  await expect(limit.take(a, 1)).resolves.toMatchObject({ remaining: 0 });
  await expect(limit.take(b, 1)).rejects.toMatchObject({
    state: { limit: 1, remaining: 0 },
  });
});

it('charges one actor and one IP count per admitted request in real PostgreSQL', async () => {
  const actor = randomUUID(),
    ip = randomUUID();
  await limit.request(ip, actor, false, {
    method: 'GET',
    route: '/projects/:id/tasks',
  });
  for (const subject of [
    'http:v2:projects:read:actor:' + actor,
    'http:v2:projects:read:ip:' + ip,
  ]) {
    const row = await client.sharedRateLimit.findUniqueOrThrow({
      where: { keyHash: key(subject) },
    });
    expect(row.requests).toBe(1);
  }
});
