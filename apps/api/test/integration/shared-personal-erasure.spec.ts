import 'reflect-metadata';
import { beforeAll, afterAll, it, expect, vi } from 'vitest';
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
import { SharedKernel } from '../../src/modules/spaces/public/index.js';
import { PersonalLifecycle } from '../../src/modules/account/public/index.js';
import { testApplication } from '../support/application.js';
import { migrationSandbox } from '../../../../tooling/testing/migration-sandbox.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';

let sandbox: Awaited<ReturnType<typeof migrationSandbox>>,
  app: NestExpressApplication,
  client: PrismaClient;
const origin = 'http://localhost:3000',
  password = 'synthetic-isolated-shared-erasure-password';
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
      'Isolated erasure schema replay failed (credentials withheld)',
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
  const root = fs.mkdtempSync(path.resolve('.tools/p2-private-erasure-'));
  app = await testApplication({
    databaseUrl: base,
    databaseInstance: database,
    environment: {
      STORAGE_ROOT: path.join(root, 'files'),
      SHARED_CONTROL_ROOT: path.join(root, 'shared-control'),
      SHARED_CONTROL_KEYS: JSON.stringify({
        erasure: randomBytes(48).toString('base64url'),
      }),
      SHARED_CONTROL_ACTIVE_KEY_ID: 'erasure',
      SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-ISOLATED-ONLY',
      PERSONAL_ERASURE_POLICY_VERSION: 'synthetic-personal-policy',
    },
  });
  await app.get(SharedControl).initialize();
}, 30000);
afterAll(async () => {
  vi.restoreAllMocks();
  await app?.close();
  await client?.$disconnect();
  await sandbox?.close();
});
it('purges unrelated Personal content before shared metadata failure, then resumes identity erasure with retained custody/hold', async () => {
  const email = randomUUID() + '@example.test';
  const signup = await request(app.getHttpServer())
    .post('/api/v1/auth/sign-up/email')
    .set('Origin', origin)
    .send({ email, password, name: 'Synthetic erasure fixture' })
    .expect(200);
  const userId = signup.body.user.id as string;
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
  const cookie = (login.headers['set-cookie'] as unknown as string[])
    .map((c) => c.split(';')[0])
    .join('; ');
  const call = (route: string) =>
    request(app.getHttpServer())
      .post('/api/v1' + route)
      .set('Origin', origin)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID());
  const task = await call('/tasks')
    .send({ title: 'Private content must not wait for shared metadata' })
    .expect(201);
  const session = await client.authSession.findFirstOrThrow({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    }),
    personal = await client.space.findFirstOrThrow({
      where: { ownerUserId: userId, kind: 'PERSONAL' },
    });
  const version = 'synthetic-' + randomUUID(),
    rule = {
      retainAfterClosureSeconds: 0,
      audience: ['OWNER'],
      exportAuthority: ['OWNER'],
      disposalAction: 'PURGE',
    };
  await client.sharedRetentionPolicy.create({
    data: {
      version,
      approvalReference: 'SYNTHETIC-ONLY',
      configuration: {
        policyVersion: version,
        approvalReference: 'SYNTHETIC-ONLY',
        accountableOperator: 'synthetic fixture operator',
        applicableContexts: ['PROJECT'],
        marketScope: 'isolated test',
        sharedRecoverySeconds: 2592000,
        classRules: {
          workContent: rule,
          commentsHistory: rule,
          filesDerivatives: rule,
          exports: rule,
          accessAuditLifecycle: rule,
        },
        obligations: [],
        holds: [
          {
            id: randomUUID(),
            basis: 'synthetic test hold, no legal assertion',
            authority: 'synthetic operator',
            scope: 'shared work only',
            nextReviewAt: '2030-01-01T00:00:00Z',
            state: 'ACTIVE',
            releaseEvidence: null,
          },
        ],
        backupPolicyReference: 'synthetic-independent-current-control',
      },
    },
  });
  const kernel = app.get(SharedKernel),
    shared = await kernel.provision(
      {
        userId,
        sessionId: session.id,
        requestId: randomUUID(),
        correlationId: randomUUID(),
      },
      randomUUID(),
      version,
    );
  const settings = await client.userSettings.findUniqueOrThrow({
    where: { userId },
  });
  const challenge = await call('/me/deletion-request')
    .send({
      password,
      accountRevision: settings.revision,
      retentionAcknowledged: true,
      policyVersion: 'synthetic-personal-policy',
    })
    .expect(201);
  await call('/me/deletion-request/confirm')
    .set('X-Deletion-Proof', challenge.body.confirmationProof as string)
    .send({ jobId: challenge.body.job.id, revision: 1 })
    .expect(201);
  const jobId = challenge.body.job.id as string;
  await client.accountDeletionJob.update({
    where: { id: jobId },
    data: { eraseAfter: new Date(0), nextAt: new Date(0) },
  });
  const lifecycle = app.get(PersonalLifecycle),
    fault = vi
      .spyOn(kernel, 'prepareIdentityErasure')
      .mockRejectedValueOnce(new Error('synthetic shared metadata failure'));
  await lifecycle.consume();
  fault.mockRestore();
  expect(
    await client.task.count({ where: { id: task.body.id as string } }),
  ).toBe(0);
  expect(await client.user.count({ where: { id: userId } })).toBe(1);
  const interrupted = await client.accountDeletionJob.findUniqueOrThrow({
    where: { id: jobId },
  });
  expect(interrupted.progress).toEqual({ stage: 'IDENTITY' });
  expect(interrupted.failureCode).toBe('ERASURE_INCOMPLETE');
  for (let attempt = 0; attempt < 4; attempt++) {
    await client.accountDeletionJob.update({
      where: { id: jobId },
      data: { nextAt: new Date(0) },
    });
    await lifecycle.consume();
    if (
      (
        await client.accountDeletionJob.findUniqueOrThrow({
          where: { id: jobId },
        })
      ).state === 'ERASED'
    )
      break;
  }
  expect(
    (
      await client.accountDeletionJob.findUniqueOrThrow({
        where: { id: jobId },
      })
    ).state,
  ).toBe('ERASED');
  expect(await client.user.count({ where: { id: userId } })).toBe(0);
  expect(await client.space.count({ where: { id: personal.id } })).toBe(0);
  expect(await client.sharedExitWork.count({ where: { userId } })).toBe(0);
  expect(
    (
      await client.sharedCustody.findUniqueOrThrow({
        where: { spaceId: shared.spaceId },
      })
    ).state,
  ).toBe('CLOSING_GRACE');
  expect(
    (
      await client.sharedActor.findUniqueOrThrow({
        where: { id: shared.actorId },
      })
    ).userId,
  ).toBeNull();
  expect(
    await client.sharedAuditEvent.count({ where: { spaceId: shared.spaceId } }),
  ).toBeGreaterThan(0);
  expect(await client.sharedRetentionPolicy.count({ where: { version } })).toBe(
    1,
  );
}, 30000);
