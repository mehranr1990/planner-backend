import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../../apps/api/dist/app.module.js';
import { parseEnvironment } from '../../apps/api/dist/bootstrap/environment.js';
import { configureApp } from '../../apps/api/dist/bootstrap/configure-app.js';
import { DatabaseService } from '../../apps/api/dist/platform/database/database.service.js';
import { AuthService } from '../../apps/api/dist/platform/auth/auth.service.js';
import { ErasureControl } from '../../apps/api/dist/platform/storage/public/index.js';
import { SharedControl } from '../../apps/api/dist/platform/storage/shared-control.js';
import { PrismaClient } from '../../apps/api/dist/generated/prisma/client.js';
import { installJobSchema } from '../../apps/api/dist/platform/jobs/schema.js';
import { NotificationWorker } from '../../apps/api/dist/modules/notifications/public/index.js';
import { ProjectsService } from '../../apps/api/dist/modules/projects/public/index.js';
import {
  AnnouncementsService,
  AnnouncementSchedulesService,
} from '../../apps/api/dist/modules/meetings/public/index.js';
import { migrationSandbox } from '../testing/migration-sandbox.ts';
import { isolatedTestDatabaseUrl } from '../testing/test-database.ts';

// Compiled production modules and a real pg-boss queue, confined to two newly
// owned schemas in mehran_test. No worker ever sees configured domain data.
const base = isolatedTestDatabaseUrl(process.env);
assert.equal(new URL(base).pathname, '/mehran_test');
const sandbox = await migrationSandbox(process.env),
  schema = new URL(sandbox.url).searchParams.get('schema')!,
  jobsSchema = 'planner_jobs_test_' + randomUUID().replaceAll('-', ''),
  root = fs.mkdtempSync(path.resolve('.tools/p5-gap-smoke-')),
  pool = new Pool({ connectionString: base, max: 1 });
let app: NestExpressApplication | undefined,
  worker: NotificationWorker | undefined,
  client: PrismaClient | undefined,
  jobsOwned = false;
try {
  const deployed = spawnSync(
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
  assert.equal(
    deployed.status,
    0,
    'Owned-schema deploy failed; credentials withheld',
  );
  const config = parseEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: base,
    LOG_LEVEL: 'silent',
    DB_HEALTH_TIMEOUT_MS: '5000',
    BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
    BETTER_AUTH_URL: 'http://localhost:3000',
    CORS_ORIGINS: 'http://localhost:3000',
    MAIL_MODE: 'sink',
    MAIL_SINK_DIR: path.join(root, 'mail'),
    STORAGE_ROOT: path.join(root, 'files'),
    ERASURE_CONTROL_ROOT: path.join(root, 'erasure'),
    SHARED_CONTROL_ROOT: path.join(root, 'control'),
    SHARED_CONTROL_KEYS: JSON.stringify({
      k1: randomBytes(48).toString('base64url'),
    }),
    SHARED_CONTROL_ACTIVE_KEY_ID: 'k1',
    SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-P5-GAP-SMOKE-ONLY',
    JOBS_SCHEMA: jobsSchema,
    JOBS_POLL_SECONDS: '1',
  });
  client = new PrismaClient({
    adapter: new PrismaPg(
      {
        connectionString: base,
        options: '-c search_path=' + schema + ' -c timezone=UTC',
        max: 5,
      },
      { schema },
    ),
  });
  const db = client;
  const module = await Test.createTestingModule({
    imports: [AppModule.register(config)],
  })
    .overrideProvider(DatabaseService)
    .useValue({
      client: db,
      checkConnection: () => db.$queryRaw`SELECT 1`,
      onApplicationShutdown: () => db.$disconnect(),
    })
    .compile();
  await module.get(ErasureControl).initialize();
  await module.get(SharedControl).initialize();
  app = module.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    logger: false,
  });
  await configureApp(app);
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl(),
    origin = 'http://localhost:3000';
  assert.equal((await fetch(url + '/health/ready')).status, 200);
  const userId = randomUUID(),
    email = randomUUID() + '@example.test',
    password = 'Synthetic-gap-smoke-password-123!';
  await db.user.create({
    data: {
      id: userId,
      email,
      emailVerified: true,
      name: 'Synthetic gap smoke',
    },
  });
  await db.space.create({
    data: { id: randomUUID(), kind: 'PERSONAL', ownerUserId: userId },
  });
  await db.userSettings.create({ data: { userId } });
  await db.authAccount.create({
    data: {
      id: randomUUID(),
      accountId: userId,
      userId,
      providerId: 'credential',
      password: await (
        await app.get(AuthService).auth.$context
      ).password.hash(password),
    },
  });
  const login = await fetch(url + '/api/v1/auth/sign-in/email', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const session = await db.authSession.findFirstOrThrow({ where: { userId } }),
    actor = {
      userId,
      sessionId: session.id,
      requestId: randomUUID(),
      correlationId: randomUUID(),
    };
  const version = 'synthetic-gap-' + randomUUID(),
    rule = {
      retainAfterClosureSeconds: 0,
      audience: ['OWNER', 'ADMIN'],
      exportAuthority: ['OWNER'],
      disposalAction: 'PURGE',
    };
  await db.sharedRetentionPolicy.create({
    data: {
      version,
      approvalReference: 'SYNTHETIC-ONLY',
      configuration: {
        policyVersion: version,
        approvalReference: 'SYNTHETIC-ONLY',
        accountableOperator: 'synthetic operator',
        applicableContexts: ['PROJECT'],
        marketScope: 'isolated schema',
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
        backupPolicyReference: 'synthetic controls',
      },
    },
  });
  const source = await app.get(ProjectsService).create(
      actor,
      {
        id: randomUUID(),
        title: 'Smoke source',
        retentionPolicyVersion: version,
      },
      randomUUID(),
    ),
    announcements = app.get(AnnouncementsService),
    schedules = app.get(AnnouncementSchedulesService);
  const a = await announcements.create(
    actor,
    { id: randomUUID(), kind: 'PROJECT', sourceId: source.id },
    randomUUID(),
  );
  const v = await announcements.createVersion(
    actor,
    a.id,
    {
      id: randomUUID(),
      title: 'Scheduled smoke',
      text: 'Synthetic content',
      attachments: [],
      acknowledgement: false,
    },
    randomUUID(),
  );
  const schedulePath =
    '/api/v1/announcements/' + a.id + '/versions/' + v.id + '/schedule';
  const unscheduled = await fetch(url + schedulePath, {
    headers: { Cookie: cookie },
  });
  assert.equal(unscheduled.status, 200);
  assert.equal(await unscheduled.json(), null);
  const response = await fetch(url + schedulePath, {
    method: 'POST',
    headers: {
      Origin: origin,
      Cookie: cookie,
      'Content-Type': 'application/json',
      'If-Match': '"1"',
      'Idempotency-Key': randomUUID(),
    },
    body: JSON.stringify({
      scheduledAt: new Date(Date.now() + 3600000).toISOString(),
      timezone: 'UTC',
      audience: { audience: 'ALL' },
    }),
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('etag'), '"2"');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(url + schedulePath)).status, 401);
  assert.equal(
    (
      await pool.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [
        jobsSchema,
      ])
    ).rowCount,
    0,
  );
  await installJobSchema(base, jobsSchema);
  jobsOwned = true;
  const activeWorker = app.get<NotificationWorker>(NotificationWorker);
  worker = activeWorker;
  await activeWorker.start(() => schedules.consume());
  await activeWorker.stop();
  // Controlled due-time fixture: simulate elapsed time while the worker is stopped.
  await db.announcementSchedule.update({
    where: { versionId: v.id },
    data: { scheduledAt: new Date(Date.now() - 1000) },
  });
  await activeWorker.start(() => schedules.consume());
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (
      (await db.announcementVersion.findUniqueOrThrow({ where: { id: v.id } }))
        .state === 'PUBLISHED'
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(
    (await db.announcementVersion.findUniqueOrThrow({ where: { id: v.id } }))
      .state,
    'PUBLISHED',
  );
  await activeWorker.stop();
  await activeWorker.start(() => schedules.consume());
  await activeWorker.stop();
  assert.equal(
    await db.sharedOutboxEvent.count({
      where: {
        action: 'announcement.scheduled.publish',
        SharedAuditEvent: { resourceId: v.id },
      },
    }),
    1,
  );
  assert.equal(
    await db.announcementTarget.count({ where: { versionId: v.id } }),
    1,
  );
  process.stdout.write(
    'PASS: compiled API health/auth/schedule headers and real pg-boss worker stop/restart recover one publication with no duplicate effects; only owned mehran_test schemas used.\n',
  );
} finally {
  await worker?.stop();
  await app?.close();
  await client?.$disconnect();
  if (jobsOwned && /^planner_jobs_test_[a-f0-9]{32}$/.test(jobsSchema))
    await pool.query('DROP SCHEMA "' + jobsSchema + '" CASCADE');
  await pool.end();
  await sandbox.close();
}
