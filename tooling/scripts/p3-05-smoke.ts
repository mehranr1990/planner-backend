import { TeamCleanupService } from '../../apps/api/dist/modules/teams/public/index.js';
import { TeamsService } from '../../apps/api/dist/modules/teams/public/index.js';
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
  const schema = environment.P305_SCHEMA;
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
    teams: app.get(TeamsService),
    grants: app.get(ResourceGrants),
    auth: app.get(AuthService),
  };
}

const origin = 'http://localhost:3000',
  password = 'synthetic-compiled-password-123!';
if (
  process.argv.includes('--resume-pass') ||
  process.argv.includes('--consumer-pass')
) {
  const ctx = await runtime(process.env);
  try {
    const id = process.env.P305_TEAM!,
      source = process.env.P305_SOURCE!,
      cookie = process.env.P305_COOKIE!,
      api = request(ctx.app.getHttpServer());
    const post = (suffix: string, revision: number, body: object = {}) =>
      api
        .post('/api/v1/teams/' + id + '/' + suffix)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .set('If-Match', '"' + revision + '"')
        .send(body);
    if (process.argv.includes('--resume-pass')) {
      const t = await api
        .get('/api/v1/teams/' + id)
        .set('Cookie', cookie)
        .expect(200);
      assert.equal(t.body.state, 'ARCHIVED');
      await api
        .get('/api/v1/teams/' + id + '/tasks/' + source)
        .set('Cookie', cookie)
        .expect(200);
      await api
        .post('/api/v1/teams/' + id + '/tasks')
        .set('Cookie', cookie)
        .set('Origin', origin)
        .set('Idempotency-Key', randomUUID())
        .send({ id: randomUUID(), title: 'Denied archived mutation' })
        .expect(404);
      await post('restore', 2).expect(200);
      await post('delete', 3, { password }).expect(200);
      const job = await api
        .get('/api/v1/teams/' + id + '/lifecycle-job')
        .set('Cookie', cookie)
        .expect(200);
      const proof = await post(
        'lifecycle-job/recovery-proof',
        job.body.revision,
        { password },
      ).expect(200);
      await api
        .post('/api/v1/teams/' + id + '/lifecycle-job/recover')
        .set('Cookie', cookie)
        .set('Origin', origin)
        .set('If-Match', '"' + proof.body.revision + '"')
        .set('X-Deletion-Recovery', proof.body.proof)
        .send({ password, generation: proof.body.generation })
        .expect(200);
      await api
        .get('/api/v1/teams/' + id + '/tasks/' + source)
        .set('Cookie', cookie)
        .expect(200);
      await post('delete', 5, { password }).expect(200);
    } else {
      const cleanup = ctx.app.get(TeamCleanupService);
      let done = false;
      for (let n = 0; n < 120; n++) {
        const job = await ctx.client.sharedLifecycleJob.findFirstOrThrow({
          where: { custodyId: id },
          orderBy: { generation: 'desc' },
        });
        if (job.state === 'DELETED') {
          done = true;
          break;
        }
        await cleanup.consume();
      }
      assert.ok(done, 'Fresh consumer must finish persisted Team cleanup');
      assert.equal(await ctx.client.team.findUnique({ where: { id } }), null);
      assert.ok(
        await ctx.client.task.findUnique({
          where: { id: process.env.P305_PROJECT_SOURCE! },
        }),
      );
      await api
        .get('/api/v1/teams/' + id + '/tasks/' + source)
        .set('Cookie', cookie)
        .expect(404);
    }
  } finally {
    await ctx.app.close();
  }
} else {
  const sandbox = await migrationSandbox(process.env);
  let ctx: Awaited<ReturnType<typeof runtime>> | undefined;
  try {
    const migrated = spawnSync(
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
      migrated.status,
      0,
      'Owned smoke migration failed; credentials withheld',
    );
    const root = fs.mkdtempSync(path.resolve('.tools/p3-05-restart-'));
    const env = {
      ...process.env,
      NODE_ENV: 'test',
      P305_SCHEMA: new URL(sandbox.url).searchParams.get('schema')!,
      BETTER_AUTH_URL: origin,
      BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
      STORAGE_ROOT: path.join(root, 'files'),
      SHARED_CONTROL_ROOT: path.join(root, 'control'),
      SHARED_CONTROL_KEYS: JSON.stringify({
        smoke: randomBytes(48).toString('base64url'),
      }),
      SHARED_CONTROL_ACTIVE_KEY_ID: 'smoke',
      SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-COMPILED-P305-ONLY',
    };
    ctx = await runtime(env, true);
    const api = request(ctx.app.getHttpServer()),
      email = randomUUID() + '@example.test';
    const signup = await api
      .post('/api/v1/auth/sign-up/email')
      .set('Origin', origin)
      .send({ name: 'Synthetic lifecycle owner', email, password })
      .expect(200);
    const uid = signup.body.user.id as string;
    await ctx.client.user.update({
      where: { id: uid },
      data: { emailVerified: true },
    });
    const login = await api
        .post('/api/v1/auth/sign-in/email')
        .set('Origin', origin)
        .send({ email, password })
        .expect(200),
      cookie = (login.headers['set-cookie'] as unknown as string[])
        .map((c) => c.split(';')[0])
        .join('; ');
    const actor = {
        userId: uid,
        sessionId: (
          await ctx.client.authSession.findFirstOrThrow({
            where: { userId: uid },
            orderBy: { createdAt: 'desc' },
          })
        ).id,
        requestId: randomUUID(),
        correlationId: randomUUID(),
      },
      policy = 'synthetic-' + randomUUID(),
      rule = {
        retainAfterClosureSeconds: 0,
        audience: ['OWNER'],
        exportAuthority: ['OWNER'],
        disposalAction: 'PURGE',
      };
    await ctx.client.sharedRetentionPolicy.create({
      data: {
        version: policy,
        approvalReference: 'SYNTHETIC-ONLY',
        configuration: {
          policyVersion: policy,
          approvalReference: 'SYNTHETIC-ONLY',
          accountableOperator: 'synthetic operator',
          applicableContexts: ['PROJECT', 'TEAM'],
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
    const team = await ctx.teams.create(
        actor,
        {
          id: randomUUID(),
          title: 'Compiled lifecycle Team',
          retentionPolicyVersion: policy,
        },
        randomUUID(),
      ),
      p = await ctx.projects.create(
        actor,
        {
          id: randomUUID(),
          title: 'Independent preserved Project',
          retentionPolicyVersion: policy,
        },
        randomUUID(),
      ),
      pt = await ctx.projects.createTask(
        actor,
        p.id,
        { id: randomUUID(), title: 'Independent source', priority: 'NONE' },
        randomUUID(),
      );
    await ctx.teams.reference(actor, team.id, p.id, undefined, true);
    const source = randomUUID();
    await api
      .post('/api/v1/teams/' + team.id + '/tasks')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .send({ id: source, title: 'Durable lifecycle source' })
      .expect(201);
    await api
      .post('/api/v1/teams/' + team.id + '/archive')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('If-Match', '"1"')
      .send({})
      .expect(200);
    await ctx.app.close();
    ctx = undefined;
    const childEnv = {
      ...env,
      P305_TEAM: team.id,
      P305_SOURCE: source,
      P305_COOKIE: cookie,
      P305_PROJECT_SOURCE: pt.id,
    };
    const child = (mode: string) => {
      const r = spawnSync(
        process.execPath,
        ['tooling/scripts/p3-05-smoke.ts', mode],
        { env: childEnv, encoding: 'utf8' },
      );
      if (r.status !== 0) {
        fs.writeFileSync(
          path.join(root, 'child-error.log'),
          r.stdout + r.stderr,
        );
        throw new Error('Compiled P3-05 child failed; synthetic log retained');
      }
    };
    child('--resume-pass');
    ctx = await runtime(env);
    await ctx.client.sharedLifecycleJob.updateMany({
      where: { spaceId: team.id, state: 'CLOSING_GRACE' },
      data: {
        effectiveDepartureAt: new Date(Date.now() - 31 * 86400000),
        recoveryDeadline: new Date(Date.now() - 86400000),
        nextAt: new Date(0),
      },
    });
    await ctx.app.get(TeamCleanupService).consume();
    await ctx.app.get(TeamCleanupService).consume();
    await ctx.app.close();
    ctx = undefined;
    child('--consumer-pass');
    fs.writeFileSync(
      path.join(root, 'report.json'),
      JSON.stringify(
        {
          compiledApiFreshProcess: 'PASS',
          archiveRestoreRecovery: 'PASS',
          compiledLifecycleConsumerFreshProcess: 'PASS',
          persistedCleanupResume: 'PASS',
          independentProjectPreserved: 'PASS',
          activation: 'SYNTHETIC_OWNED_SCHEMA_ONLY',
        },
        null,
        2,
      ) + '\n',
    );
    process.stdout.write(
      'PASS: fresh compiled Team API archive/restore and proof recovery; fresh compiled Team lifecycle consumer resumes persisted cleanup and preserves independent Project source.\n',
    );
  } finally {
    await ctx?.app.close();
    await sandbox.close();
  }
}
