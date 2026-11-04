import 'reflect-metadata';
import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureApp } from '../../apps/api/dist/bootstrap/configure-app.js';
import { ProjectsService } from '../../apps/api/dist/modules/projects/public/index.js';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../apps/api/dist/generated/prisma/client.js';
import { AppModule } from '../../apps/api/dist/app.module.js';
import { parseEnvironment } from '../../apps/api/dist/bootstrap/environment.js';
import { DatabaseService } from '../../apps/api/dist/platform/database/database.service.js';
import { AuthService } from '../../apps/api/dist/platform/auth/auth.service.js';
import { ErasureControl } from '../../apps/api/dist/platform/storage/public/index.js';
import { SharedControl } from '../../apps/api/dist/platform/storage/shared-control.js';
import {
  SharedKernel,
  CollaborationService,
  ResourceGrants,
} from '../../apps/api/dist/modules/spaces/public/index.js';
import { migrationSandbox } from '../testing/migration-sandbox.ts';
import { isolatedTestDatabaseUrl } from '../testing/test-database.ts';

const base = isolatedTestDatabaseUrl(process.env);
async function runtime(environment: NodeJS.ProcessEnv, initialize = false) {
  const schema = environment.P203_SCHEMA;
  if (!schema || !/^p003_[a-f0-9]{32}$/.test(schema))
    throw new Error('Owned compiled smoke namespace required');
  const config = parseEnvironment({
    ...environment,
    DATABASE_URL: base,
    LOG_LEVEL: 'silent',
    MAIL_MODE: 'sink',
  });
  const client = new PrismaClient({
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
  const module = await Test.createTestingModule({
    imports: [AppModule.register(config)],
  })
    .overrideProvider(DatabaseService)
    .useValue(database)
    .compile();
  const app = module.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    bufferLogs: true,
  });
  const shared = app.get(SharedControl);
  if (initialize) {
    await app.get(ErasureControl).initialize();
    await shared.initialize();
  }
  await configureApp(app);
  return {
    app,
    client,
    kernel: app.get(SharedKernel),
    service: app.get(CollaborationService),
    projects: app.get(ProjectsService),
    grants: app.get(ResourceGrants),
    auth: app.get(AuthService),
  };
}
if (process.argv.includes('--worker-pass')) {
  const context = await runtime(process.env);
  try {
    await context.grants.maintain();
  } finally {
    await context.app.close();
  }
} else {
  const sandbox = await migrationSandbox(process.env);
  let context: Awaited<ReturnType<typeof runtime>> | undefined;
  try {
    const migration = spawnSync(
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
    if (migration.status !== 0)
      throw new Error(
        'Owned compiled P2-03 migration failed (credentials withheld)',
      );
    const root = fs.mkdtempSync(path.resolve('.tools/p2-03-restart-'));
    const environment = {
      ...process.env,
      NODE_ENV: 'test',
      P203_SCHEMA: new URL(sandbox.url).searchParams.get('schema')!,
      BETTER_AUTH_URL: 'http://localhost:3000',
      BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
      STORAGE_ROOT: path.join(root, 'files'),
      SHARED_CONTROL_ROOT: path.join(root, 'control'),
      SHARED_CONTROL_KEYS: JSON.stringify({
        smoke: randomBytes(48).toString('base64url'),
      }),
      SHARED_CONTROL_ACTIVE_KEY_ID: 'smoke',
      SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-COMPILED-P203-ONLY',
    };
    context = await runtime(environment, true);
    const credential = await (
      await context.auth.auth.$context
    ).password.hash('synthetic-compiled-password-123!');
    const person = async () => {
      const userId = randomUUID(),
        sessionId = randomUUID();
      await context!.client.user.create({
        data: {
          id: userId,
          name: 'Synthetic compiled collaboration',
          email: userId + '@example.test',
          emailVerified: true,
        },
      });
      await context!.client.space.create({
        data: { id: randomUUID(), ownerUserId: userId, kind: 'PERSONAL' },
      });
      await context!.client.userSettings.create({ data: { userId } });
      await context!.client.authAccount.create({
        data: {
          id: randomUUID(),
          userId,
          accountId: userId,
          providerId: 'credential',
          password: credential,
        },
      });
      await context!.client.authSession.create({
        data: {
          id: sessionId,
          userId,
          token: randomUUID(),
          expiresAt: new Date(Date.now() + 86400000),
        },
      });
      return {
        userId,
        sessionId,
        requestId: randomUUID(),
        correlationId: randomUUID(),
      };
    };
    const owner = await person(),
      recipient = await person(),
      other = await person(),
      policy = 'synthetic-' + randomUUID(),
      rule = {
        retainAfterClosureSeconds: 0,
        audience: ['OWNER'],
        exportAuthority: ['OWNER'],
        disposalAction: 'PURGE',
      };
    await context.client.sharedRetentionPolicy.create({
      data: {
        version: policy,
        approvalReference: 'SYNTHETIC-ONLY',
        configuration: {
          policyVersion: policy,
          approvalReference: 'SYNTHETIC-ONLY',
          accountableOperator: 'synthetic operator',
          applicableContexts: ['PROJECT'],
          marketScope: 'isolated compiled restart',
          sharedRecoverySeconds: 2592000,
          classRules: {
            workContent: rule,
            commentsHistory: rule,
            filesDerivatives: rule,
            exports: rule,
            accessAuditLifecycle: rule,
          },
          obligations: [],
          holds: [],
          backupPolicyReference: 'synthetic current control',
        },
      },
    });

    const origin = 'http://localhost:3000',
      password = 'synthetic-compiled-password-123!';
    const login = async (person: { userId: string }) => {
      const response = await request(context!.app.getHttpServer())
        .post('/api/v1/auth/sign-in/email')
        .set('Origin', origin)
        .send({ email: person.userId + '@example.test', password })
        .expect(200);
      return (response.headers['set-cookie'] as unknown as string[])
        .map((c) => c.split(';')[0])
        .join('; ');
    };
    const ownerCookie = await login(owner),
      guestCookie = await login(recipient),
      projectId = randomUUID();
    const created = await request(context.app.getHttpServer())
      .post('/api/v1/projects')
      .set('Cookie', ownerCookie)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .send({
        id: projectId,
        title: 'Compiled independent Project',
        retentionPolicyVersion: policy,
      })
      .expect(201);
    assert.equal(created.body.association.kind, 'INDEPENDENT');
    const task = await request(context.app.getHttpServer())
      .post('/api/v1/projects/' + projectId + '/tasks')
      .set('Cookie', ownerCookie)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .send({ id: randomUUID(), title: 'Compiled shared Task' })
      .expect(201);
    const goal = await request(context.app.getHttpServer())
      .post('/api/v1/projects/' + projectId + '/goals')
      .set('Cookie', ownerCookie)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .send({
        id: randomUUID(),
        title: 'Compiled shared Goal',
        horizon: 'LONG_TERM',
        timezone: 'UTC',
      })
      .expect(201);
    const offer = await request(context.app.getHttpServer())
      .post('/api/v1/projects/' + projectId + '/resource-invitations')
      .set('Cookie', ownerCookie)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .send({
        id: randomUUID(),
        recipientUserId: recipient.userId,
        target: { kind: 'TASK', id: task.body.id },
        capabilities: ['read', 'update'],
        grantExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      })
      .expect(201);
    const accepted = await request(context.app.getHttpServer())
      .post('/api/v1/resource-invitations/' + offer.body.offer.id + '/accept')
      .set('Cookie', guestCookie)
      .set('Origin', origin)
      .set('If-Match', '"1"')
      .set('X-Invitation-Proof', offer.body.proof)
      .send({})
      .expect(201);
    assert.equal(accepted.body.admission.memberRole, null);
    const patchKey = randomUUID(),
      patch = { title: 'Committed before process restart' };
    await request(context.app.getHttpServer())
      .patch('/api/v1/projects/' + projectId + '/tasks/' + task.body.id)
      .set('Cookie', guestCookie)
      .set('Origin', origin)
      .set('If-Match', '"1"')
      .set('Idempotency-Key', patchKey)
      .send(patch)
      .expect(200);
    await request(context.app.getHttpServer())
      .get('/api/v1/projects/' + projectId + '/tasks')
      .set('Cookie', guestCookie)
      .expect(404);
    const pending = await context.projects.grantOffer(
      owner,
      projectId,
      {
        id: randomUUID(),
        recipientUserId: other.userId,
        target: { kind: 'GOAL', id: goal.body.id },
        capabilities: ['read'],
        grantExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
      randomUUID(),
    );
    await context.client
      .$executeRaw`UPDATE "ResourceGrantOffer" SET "createdAt"=statement_timestamp()-interval '8 days',"expiresAt"=statement_timestamp()-interval '1 day' WHERE id=${pending.offer.id}::uuid`;
    await context.app.close();
    context = undefined;
    for (let pass = 0; pass < 2; pass++) {
      const child = spawnSync(
        process.execPath,
        ['tooling/scripts/p2-03-smoke.ts', '--worker-pass'],
        {
          env: environment,
          encoding: 'utf8',
          windowsHide: true,
          timeout: 30000,
        },
      );
      if (child.status !== 0)
        throw new Error(
          'Compiled Project maintenance restart failed (credentials withheld)',
        );
    }
    context = await runtime(environment);
    await request(context.app.getHttpServer())
      .get('/api/v1/projects/' + projectId + '/tasks/' + task.body.id)
      .set('Cookie', guestCookie)
      .expect(200);
    const replay = await request(context.app.getHttpServer())
      .patch('/api/v1/projects/' + projectId + '/tasks/' + task.body.id)
      .set('Cookie', guestCookie)
      .set('Origin', origin)
      .set('If-Match', '"1"')
      .set('Idempotency-Key', patchKey)
      .send(patch)
      .expect(200);
    assert.equal(replay.body.revision, 2);
    assert.equal(
      await context.client.taskChange.count({
        where: { taskId: task.body.id },
      }),
      2,
    );
    assert.equal(
      (
        await context.client.sharedMutationReceipt.findFirstOrThrow({
          where: { spaceId: projectId, operation: 'project.task.update' },
        })
      ).statusCode,
      200,
    );
    const safeOffer = await request(context.app.getHttpServer())
      .get(
        '/api/v1/projects/' +
          projectId +
          '/resource-invitations/' +
          offer.body.offer.id,
      )
      .set('Cookie', ownerCookie)
      .expect(200);
    assert.equal(safeOffer.body.grantId, accepted.body.grant.id);
    assert.equal(
      (
        await context.client.resourceGrantOffer.findUniqueOrThrow({
          where: { id: pending.offer.id },
        })
      ).proofHash,
      null,
    );
    assert.equal(
      await context.client.sharedAuditEvent.count({
        where: { spaceId: projectId, action: 'grant.offer.expire' },
      }),
      1,
    );
    const durableGoal = await request(context.app.getHttpServer())
      .get('/api/v1/projects/' + projectId + '/goals/' + goal.body.id)
      .set('Cookie', ownerCookie)
      .expect(200);
    assert.equal(durableGoal.body.horizon, 'LONG_TERM');
    await request(context.app.getHttpServer())
      .post('/api/v1/projects/' + projectId + '/archive')
      .set('Cookie', ownerCookie)
      .set('Origin', origin)
      .set('If-Match', '"1"')
      .send({})
      .expect(201);
    await request(context.app.getHttpServer())
      .patch('/api/v1/projects/' + projectId + '/tasks/' + task.body.id)
      .set('Cookie', guestCookie)
      .set('Origin', origin)
      .set('If-Match', '"2"')
      .set('Idempotency-Key', randomUUID())
      .send({ title: 'Must stay frozen' })
      .expect(404);
    await request(context.app.getHttpServer())
      .post('/api/v1/projects/' + projectId + '/restore')
      .set('Cookie', ownerCookie)
      .set('Origin', origin)
      .set('If-Match', '"2"')
      .send({})
      .expect(201);
    await request(context.app.getHttpServer())
      .post('/api/v1/projects/' + projectId + '/deletion-request')
      .set('Cookie', ownerCookie)
      .set('Origin', origin)
      .set('If-Match', '"3"')
      .send({ password })
      .expect(201);
    const lifecycle = await request(context.app.getHttpServer())
      .get('/api/v1/projects/' + projectId + '/lifecycle')
      .set('Cookie', ownerCookie)
      .expect(200);
    assert.equal(lifecycle.body.state, 'CLOSING_GRACE');
    await request(context.app.getHttpServer())
      .get('/api/v1/projects/' + projectId + '/tasks/' + task.body.id)
      .set('Cookie', guestCookie)
      .expect(404);
    assert.equal(
      await context.client.task.count({ where: { id: task.body.id } }),
      1,
    );
    assert.equal(
      await context.client.goal.count({ where: { id: goal.body.id } }),
      1,
    );
    fs.writeFileSync(
      path.join(root, 'report.json'),
      JSON.stringify(
        {
          compiledHttpApiRestart: 'PASS',
          ownerFacadeDurability: 'PASS',
          safeReceiptReplay: 'PASS',
          workerExpiryOnce: 'PASS',
          archiveRestoreControlledClosure: 'PASS',
          activation: 'SYNTHETIC_OWNED_SCHEMA_ONLY',
        },
        null,
        2,
      ) + '\n',
    );
    process.stdout.write(
      'PASS: compiled Project HTTP API restart, unified source durability, fenced guest replay, worker expiry once, archive/restore and retained controlled closure.\n',
    );
  } finally {
    await context?.app.close();
    await sandbox.close();
  }
}
