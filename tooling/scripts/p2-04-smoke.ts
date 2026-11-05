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
import { taskToolsCompiledSmoke } from '../testing/task-tools-compiled-smoke.ts';
import { projectExecutionCompiledSmoke } from '../testing/project-execution-compiled-smoke.ts';
import {
  projectCollaborationCompiledSmoke,
  verifyProjectCollaborationRestart,
} from '../testing/project-collaboration-compiled-smoke.ts';

const base = isolatedTestDatabaseUrl(process.env);
async function runtime(environment: NodeJS.ProcessEnv, initialize = false) {
  const schema = environment.P204_SCHEMA;
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
      {
        connectionString: base,
        options: '-c timezone=UTC -c search_path=' + schema,
      },
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
        'Owned compiled P2-04 migration failed (credentials withheld)',
      );
    const root = fs.mkdtempSync(path.resolve('.tools/p2-04-restart-'));
    const environment = {
      ...process.env,
      NODE_ENV: 'test',
      P204_SCHEMA: new URL(sandbox.url).searchParams.get('schema')!,
      BETTER_AUTH_URL: 'http://localhost:3000',
      BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
      STORAGE_ROOT: path.join(root, 'files'),
      SHARED_CONTROL_ROOT: path.join(root, 'control'),
      SHARED_CONTROL_KEYS: JSON.stringify({
        smoke: randomBytes(48).toString('base64url'),
      }),
      SHARED_CONTROL_ACTIVE_KEY_ID: 'smoke',
      SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-COMPILED-P204-ONLY',
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
      memberCookie = await login(recipient),
      projectId = randomUUID(),
      taskId = randomUUID(),
      goalId = randomUUID();
    const http = () => request(context!.app.getHttpServer());
    await http()
      .post('/api/v1/projects')
      .set('Cookie', ownerCookie)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .send({
        id: projectId,
        title: 'Compiled work Project',
        retentionPolicyVersion: policy,
      })
      .expect(201);
    await http()
      .post('/api/v1/projects/' + projectId + '/tasks')
      .set('Cookie', ownerCookie)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .send({ id: taskId, title: 'Source Task, never copied' })
      .expect(201);
    await http()
      .post('/api/v1/projects/' + projectId + '/goals')
      .set('Cookie', ownerCookie)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .send({
        id: goalId,
        title: 'Source Goal',
        horizon: 'SHORT_TERM',
        timezone: 'UTC',
      })
      .expect(201);
    const offer = await context.service.createInvitation(
      owner,
      projectId,
      {
        kind: 'MEMBERSHIP',
        memberRole: 'MEMBER',
        recipient: { userId: recipient.userId },
      },
      randomUUID(),
    );
    const admitted = await context.service.decideInvitation(
      recipient,
      offer.invitation.id,
      offer.proof!,
      1,
      true,
    );
    if (!('membership' in admitted))
      throw new Error('Expected admitted member');
    const taskPath = '/api/v1/projects/' + projectId + '/tasks/' + taskId;
    await http()
      .put(taskPath + '/schedule')
      .set('Cookie', ownerCookie)
      .set('Origin', origin)
      .set('If-Match', '"1"')
      .send({
        plannedStartAt: '2026-11-04T23:30:00Z',
        dueAt: '2026-11-05T00:30:00Z',
        scheduledDate: null,
      })
      .expect(200);
    const assignmentId = randomUUID();
    await http()
      .post(taskPath + '/assignments')
      .set('Cookie', ownerCookie)
      .set('Origin', origin)
      .set('If-Match', '"2"')
      .set('Idempotency-Key', randomUUID())
      .send({
        id: assignmentId,
        recipientAccessId: admitted.membership.id,
        recipientGeneration: admitted.membership.generation,
        kind: 'PRIMARY',
      })
      .expect(201);
    const pending = await http()
      .get('/api/v1/me/work/assignments')
      .set('Cookie', memberCookie)
      .expect(200);
    assert.equal(pending.body.items.length, 1);
    assert.equal(pending.body.items[0].preview.id, taskId);
    assert.equal(pending.body.items[0].task, undefined);
    const before = await http()
      .get('/api/v1/me/work/tasks?projectId=' + projectId)
      .set('Cookie', memberCookie)
      .expect(200);
    assert.deepEqual(before.body.items, []);
    const block = await http()
      .post('/api/v1/calendar/time-blocks')
      .set('Cookie', memberCookie)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .send({
        title: 'Private user-controlled title',
        schedule: {
          kind: 'TIMED',
          timezone: 'Asia/Tehran',
          localStart: '2026-11-05T09:00',
          localEnd: '2026-11-05T10:00',
        },
      })
      .expect(201);
    const blockPath =
      '/api/v1/me/calendar/time-blocks/' + block.body.id + '/shared-task';
    await http()
      .put(blockPath)
      .set('Cookie', memberCookie)
      .set('Origin', origin)
      .set('If-Match', '"1"')
      .send({ spaceId: projectId, taskId, sourceRevision: 2 })
      .expect(200);
    const acceptPath = taskPath + '/assignments/' + assignmentId + '/accept';
    await http()
      .post(acceptPath)
      .set('Cookie', memberCookie)
      .set('Origin', origin)
      .set('If-Match', '"1"')
      .send({})
      .expect(201);
    const taskTools = process.argv.includes('--p2-05')
      ? await taskToolsCompiledSmoke(
          context.app,
          projectId,
          ownerCookie,
          memberCookie,
          admitted.membership,
        )
      : null;
    // The optional P2-05 exercise adds a separate burst to this owned fixture.
    if (taskTools) await context.client.sharedRateLimit.deleteMany();
    const execution = process.argv.includes('--p2-06')
      ? await projectExecutionCompiledSmoke(
          context.app,
          projectId,
          ownerCookie,
          memberCookie,
          admitted.membership,
          assignmentId,
        )
      : null;
    if (execution) await context.client.sharedRateLimit.deleteMany();
    const content = process.argv.includes('--p2-07')
      ? await projectCollaborationCompiledSmoke(
          context.app,
          projectId,
          ownerCookie,
        )
      : null;
    if (content) await context.client.sharedRateLimit.deleteMany();
    await context.app.close();
    context = undefined;
    const child = spawnSync(
      process.execPath,
      ['tooling/scripts/p2-04-smoke.ts', '--worker-pass'],
      { env: environment, encoding: 'utf8', timeout: 30000 },
    );
    if (child.status !== 0)
      throw new Error(
        'Compiled fresh worker bootstrap failed; captured output withheld',
      );
    context = await runtime(environment);
    if (content)
      await verifyProjectCollaborationRestart(
        context.app,
        projectId,
        ownerCookie,
        content,
      );
    if (execution) {
      const report = await http()
        .get(
          '/api/v1/projects/' +
            projectId +
            '/reports/snapshots/' +
            execution.snapshotId,
        )
        .set('Cookie', ownerCookie)
        .expect(200);
      assert.equal(report.body.report.recordedSeconds, 3600);
      const history = await http()
        .get(
          '/api/v1/projects/' +
            projectId +
            '/register-items/' +
            execution.riskId +
            '/history',
        )
        .set('Cookie', ownerCookie)
        .expect(200);
      assert.equal(history.body.items.length, 1);
      const plan = await http()
        .get(
          '/api/v1/projects/' + projectId + '/change-plans/' + execution.planId,
        )
        .set('Cookie', ownerCookie)
        .expect(200);
      assert.equal(plan.body.state, 'APPLIED');
    }
    if (taskTools) {
      const plan = await http()
        .get(
          '/api/v1/projects/' +
            projectId +
            '/reschedule-previews/' +
            taskTools.previewId,
        )
        .set('Cookie', ownerCookie)
        .expect(200);
      assert.equal(plan.body.state, 'APPLIED');
      const binding = await http()
        .get(
          '/api/v1/projects/' +
            projectId +
            '/tasks/' +
            taskTools.taskId +
            '/workflow',
        )
        .set('Cookie', ownerCookie)
        .expect(200);
      assert.equal(binding.body.binding.version, 1);
    }
    const tasks = await http()
      .get('/api/v1/me/work/tasks?projectId=' + projectId)
      .set('Cookie', memberCookie)
      .expect(200);
    assert.equal(tasks.body.items[0].id, taskId);
    const goals = await http()
      .get('/api/v1/me/work/goals?projectId=' + projectId)
      .set('Cookie', memberCookie)
      .expect(200);
    assert.equal(goals.body.items[0].id, goalId);
    const overlays = await http()
      .get(
        '/api/v1/me/calendar/overlays?from=2026-11-05&to=2026-11-06&timezone=Asia%2FTehran',
      )
      .set('Cookie', memberCookie)
      .expect(200);
    assert.equal(overlays.body.items[0].id, taskId);
    await http()
      .post(acceptPath)
      .set('Cookie', memberCookie)
      .set('Origin', origin)
      .set('If-Match', '"1"')
      .send({})
      .expect(201);
    assert.equal(
      await context.client.sharedAssignmentNotification.count({
        where: { assignmentId, kind: 'ACCEPTED' },
      }),
      1,
    );
    const inbox = await http()
      .get('/api/v1/me/work/notifications')
      .set('Cookie', memberCookie)
      .expect(200);
    assert.equal(inbox.body.items[0].assignmentId, assignmentId);
    await http()
      .post('/api/v1/me/work/notifications/' + inbox.body.items[0].id + '/read')
      .set('Cookie', memberCookie)
      .set('Origin', origin)
      .set('If-Match', '"1"')
      .send({ spaceId: projectId })
      .expect(201);
    await http()
      .post(taskPath + '/assignments/' + assignmentId + '/revoke')
      .set('Cookie', ownerCookie)
      .set('Origin', origin)
      .set('If-Match', '"2"')
      .send({})
      .expect(201);
    const removed = await http()
      .get('/api/v1/me/work/tasks?projectId=' + projectId)
      .set('Cookie', memberCookie)
      .expect(200);
    assert.deepEqual(removed.body.items, []);
    await context.service.changeMembership(
      owner,
      projectId,
      admitted.membership.id,
      admitted.membership.revision,
      { state: 'REVOKED', memberRole: 'MEMBER' },
    );
    const unavailable = await http()
      .get(blockPath)
      .set('Cookie', memberCookie)
      .expect(200);
    assert.equal(unavailable.body.availability, 'UNAVAILABLE');
    assert.equal(unavailable.body.source, null);
    const retained = await http()
      .get('/api/v1/calendar/time-blocks/' + block.body.id)
      .set('Cookie', memberCookie)
      .expect(200);
    assert.equal(retained.body.title, 'Private user-controlled title');
    await http()
      .delete(blockPath)
      .set('Cookie', memberCookie)
      .set('Origin', origin)
      .set('If-Match', '"2"')
      .send({})
      .expect(200);
    assert.equal(await context.client.task.count({ where: { id: taskId } }), 1);
    assert.equal(
      await context.client.task.count({
        where: { createdByUserId: recipient.userId },
      }),
      0,
    );
    fs.writeFileSync(
      path.join(root, 'report.json'),
      JSON.stringify(
        {
          compiledApiRestart: 'PASS',
          freshWorkerBootstrap: 'PASS',
          assignmentConsentReplay: 'PASS',
          authorizedSourceProjections: 'PASS',
          calendarAndInboxDurability: 'PASS',
          sourceRevocationPrivateBlockRetention: 'PASS',
          sourceCopies: 0,
          activation: 'SYNTHETIC_OWNED_SCHEMA_ONLY',
        },
        null,
        2,
      ) + '\n',
    );
    process.stdout.write(
      'PASS: compiled P2-04 API restart and fresh worker, consent replay, source projections, local-date overlay/inbox durability and private block retention after revocation; no Task copies.\n',
    );
  } finally {
    await context?.app.close();
    await sandbox.close();
  }
}
