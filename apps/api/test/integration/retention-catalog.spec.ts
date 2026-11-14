import 'reflect-metadata';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import request from 'supertest';
import { PrismaPg } from '@prisma/adapter-pg';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import type { DatabaseService } from '../../src/platform/database/database.service.js';
import { IdentityMailService } from '../../src/platform/auth/mail.service.js';
import { SharedControl } from '../../src/platform/storage/shared-control.js';
import { testApplication } from '../support/application.js';
import { migrationSandbox } from '../../../../tooling/testing/migration-sandbox.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import {
  RETENTION_CATALOG_V1,
  seedRetentionCatalog,
} from '../../../../tooling/retention/catalog-v1.ts';

let sandbox: Awaited<ReturnType<typeof migrationSandbox>>,
  app: NestExpressApplication,
  client: PrismaClient,
  cookie: string;
const origin = 'http://localhost:3000',
  password = 'synthetic-isolated-retention-catalog-password',
  versions = RETENTION_CATALOG_V1.map((p) => p.policyVersion);
beforeAll(async () => {
  sandbox = await migrationSandbox(process.env);
  const result = spawnSync(
    process.execPath,
    [
      'node_modules/prisma/build/index.js',
      'migrate',
      'deploy',
      '--config',
      'prisma.config.ts',
    ],
    { env: { ...process.env, DATABASE_URL: sandbox.url }, encoding: 'utf8' },
  );
  if (result.status !== 0)
    throw new Error(
      'Isolated retention schema replay failed (credentials withheld)',
    );
  const schema = new URL(sandbox.url).searchParams.get('schema')!,
    base = isolatedTestDatabaseUrl(process.env);
  client = new PrismaClient({
    adapter: new PrismaPg(
      { connectionString: base, options: '-c search_path=' + schema },
      { schema },
    ),
  });
  const database: DatabaseService = {
    client,
    checkConnection: async () => {
      await client.$queryRaw`SELECT 1`;
    },
    onApplicationShutdown: () => client.$disconnect(),
  };
  const root = fs.mkdtempSync(path.resolve('.tools/retention-catalog-'));
  app = await testApplication({
    databaseUrl: base,
    databaseInstance: database,
    environment: {
      STORAGE_ROOT: path.join(root, 'files'),
      SHARED_CONTROL_ROOT: path.join(root, 'shared-control'),
      SHARED_CONTROL_KEYS: JSON.stringify({
        retention: randomBytes(48).toString('base64url'),
      }),
      SHARED_CONTROL_ACTIVE_KEY_ID: 'retention',
      SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-ISOLATED-ONLY',
      PERSONAL_ERASURE_POLICY_VERSION: 'synthetic-personal-policy',
    },
  });
  await app.get(SharedControl).initialize();
  const email = randomUUID() + '@example.test';
  await request(app.getHttpServer())
    .post('/api/v1/auth/sign-up/email')
    .set('Origin', origin)
    .send({ email, password, name: 'Synthetic retention fixture' })
    .expect(200);
  const link = new URL(
    app.get(IdentityMailService).latestForTest(email, 'verify-email')!.url,
  );
  link.searchParams.delete('callbackURL');
  await request(app.getHttpServer())
    .get(link.pathname + link.search)
    .expect(200);
  const login = await request(app.getHttpServer())
    .post('/api/v1/auth/sign-in/email')
    .set('Origin', origin)
    .send({ email, password })
    .expect(200);
  cookie = (login.headers['set-cookie'] as unknown as string[])
    .map((c) => c.split(';')[0])
    .join('; ');
}, 60000);
afterAll(async () => {
  await app?.close();
  await client?.$disconnect();
  await sandbox?.close();
});
const catalog = (context: string) =>
  request(app.getHttpServer())
    .get('/api/v1/retention-policies')
    .query({ context })
    .set('Origin', origin)
    .set('Cookie', cookie);

it('dry run writes nothing; apply is idempotent and touches no Space, job or custody state', async () => {
  const before = await Promise.all([
    client.sharedCustody.count(),
    client.sharedLifecycleJob.count(),
  ]);
  expect(
    (await seedRetentionCatalog(client, false)).map((r) => r.status),
  ).toEqual(['PLANNED', 'PLANNED', 'PLANNED']);
  expect(await client.sharedRetentionPolicy.count()).toBe(0);
  expect((await catalog('PROJECT').expect(200)).body.items).toEqual([]);
  expect(
    (await seedRetentionCatalog(client, true)).map((r) => r.status),
  ).toEqual(['INSERTED', 'INSERTED', 'INSERTED']);
  const rows = await client.sharedRetentionPolicy.findMany({
    orderBy: { version: 'asc' },
  });
  expect(rows.map((r) => r.version)).toEqual([...versions].sort());
  expect(
    (await seedRetentionCatalog(client, true)).map((r) => r.status),
  ).toEqual(['UNCHANGED', 'UNCHANGED', 'UNCHANGED']);
  expect(
    await client.sharedRetentionPolicy.findMany({
      orderBy: { version: 'asc' },
    }),
  ).toEqual(rows);
  expect(
    await Promise.all([
      client.sharedCustody.count(),
      client.sharedLifecycleJob.count(),
    ]),
  ).toEqual(before);
});
it('serves seeded defaults per Space type and none for Company or Social Group', async () => {
  const items = async (context: string) =>
    (
      (await catalog(context).expect(200)).body.items as { version: string }[]
    ).map((i) => i.version);
  expect(await items('PROJECT')).toEqual(['mp-rpc-v1.0-work']);
  expect(await items('TEAM')).toEqual(['mp-rpc-v1.0-work']);
  expect(await items('CONVERSATION')).toEqual(['mp-rpc-v1.0-conversation']);
  expect(await items('MEETING')).toEqual(['mp-rpc-v1.0-meeting']);
  expect(await items('COMPANY')).toEqual([]);
  expect(await items('SOCIAL_GROUP')).toEqual([]);
  const body = (await catalog('MEETING').expect(200)).body.items[0];
  expect(body.classRules.workContent).toEqual({
    retainAfterClosureSeconds: 5 * 365 * 86400,
    disposalAction: 'PURGE',
  });
  // Holds, obligations and operator details are never disclosed.
  expect(JSON.stringify(body)).not.toMatch(
    /holds|obligations|accountableOperator/,
  );
  await request(app.getHttpServer())
    .get('/api/v1/retention-policies')
    .query({ context: 'PROJECT' })
    .set('Origin', origin)
    .expect(401);
});
it('never overwrites an approved policy: a differing row aborts the seed and the table stays immutable', async () => {
  await expect(
    client.$executeRaw`UPDATE "SharedRetentionPolicy" SET "approvalReference"='tampered' WHERE version='mp-rpc-v1.0-work'`,
  ).rejects.toThrow();
  await client.$transaction(async (tx) => {
    await tx.$executeRaw`DELETE FROM "SharedRetentionPolicy" WHERE version='mp-rpc-v1.0-meeting'`;
    const p = structuredClone(RETENTION_CATALOG_V1[2]!);
    p.classRules.workContent.retainAfterClosureSeconds = 1;
    await tx.sharedRetentionPolicy.create({
      data: {
        version: p.policyVersion,
        approvalReference: p.approvalReference,
        configuration: p,
      },
    });
  });
  const result = await seedRetentionCatalog(client, true);
  expect(result.find((r) => r.version === 'mp-rpc-v1.0-meeting')!.status).toBe(
    'CONFLICT',
  );
  const row = await client.sharedRetentionPolicy.findUniqueOrThrow({
    where: { version: 'mp-rpc-v1.0-meeting' },
  });
  expect(
    (
      row.configuration as {
        classRules: { workContent: { retainAfterClosureSeconds: number } };
      }
    ).classRules.workContent.retainAfterClosureSeconds,
  ).toBe(1);
});
