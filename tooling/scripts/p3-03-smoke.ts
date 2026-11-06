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
  const schema = environment.P303_SCHEMA;
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
    teams: app.get(TeamsService),
    grants: app.get(ResourceGrants),
    auth: app.get(AuthService),
  };
}

if (process.argv.includes('--resume-pass')) {
  const context = await runtime(process.env);
  try {
    const api = request(context.app.getHttpServer()),
      q = { fromDate: '2030-01-07', toDate: '2030-01-14', timezone: 'UTC' },
      team = process.env.P303_TEAM!;
    const capacity = await api
      .get('/api/v1/teams/' + team + '/capacity')
      .query(q)
      .set('Cookie', process.env.P303_COOKIE!)
      .expect(200);
    assert.equal(capacity.body.items.length, 1);
    assert.equal(capacity.body.items[0].availableMinutes, 360);
    const full = await api
      .get('/api/v1/teams/' + team + '/dashboard')
      .query(q)
      .set('Cookie', process.env.P303_COOKIE!)
      .expect(200);
    assert.equal(full.body.portfolio.summary.taskCount, 2);
    assert.equal(full.body.portfolio.sources.length, 2);
    const limited = await api
      .get('/api/v1/teams/' + team + '/dashboard')
      .query(q)
      .set('Cookie', process.env.P303_MEMBER_COOKIE!)
      .expect(200);
    assert.equal(limited.body.portfolio.summary.taskCount, 1);
    assert.equal(limited.body.portfolio.sources.length, 1);
    assert.equal(limited.headers['cache-control'], 'no-store');
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
      throw Error(
        'Isolated Team work smoke migration failed (credentials withheld)',
      );
    const root = fs.mkdtempSync(path.resolve('.tools/p3-03-restart-'));
    const environment = {
      ...process.env,
      NODE_ENV: 'test',
      P303_SCHEMA: new URL(sandbox.url).searchParams.get('schema')!,
      BETTER_AUTH_URL: 'http://localhost:3000',
      BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
      STORAGE_ROOT: path.join(root, 'files'),
      SHARED_CONTROL_ROOT: path.join(root, 'control'),
      SHARED_CONTROL_KEYS: JSON.stringify({
        smoke: randomBytes(48).toString('base64url'),
      }),
      SHARED_CONTROL_ACTIVE_KEY_ID: 'smoke',
      SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-COMPILED-P303-ONLY',
    };
    context = await runtime(environment, true);
    const origin = 'http://localhost:3000',
      password = 'synthetic-compiled-password-123!';
    const person = async () => {
      const response = await request(context!.app.getHttpServer())
        .post('/api/v1/auth/sign-up/email')
        .set('Origin', origin)
        .send({
          name: 'Synthetic Team work',
          email: randomUUID() + '@example.test',
          password,
        })
        .expect(200);
      const user = await context!.client.user.findUniqueOrThrow({
        where: { id: response.body.user.id },
      });
      await context!.client.user.update({
        where: { id: user.id },
        data: { emailVerified: true },
      });
      const login = await request(context!.app.getHttpServer())
        .post('/api/v1/auth/sign-in/email')
        .set('Origin', origin)
        .send({ email: user.email, password })
        .expect(200);
      return {
        id: user.id,
        cookie: (login.headers['set-cookie'] as unknown as string[])
          .map((c) => c.split(';')[0])
          .join('; '),
      };
    };
    const owner = await person(),
      member = await person(),
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
    const api = () => request(context!.app.getHttpServer()),
      team = randomUUID(),
      project = randomUUID();
    const post = (url: string, body: object, key = randomUUID()) =>
      api()
        .post('/api/v1/' + url)
        .set('Cookie', owner.cookie)
        .set('Origin', origin)
        .set('Idempotency-Key', key)
        .send(body);
    await post('teams', {
      id: team,
      title: 'Capacity Team',
      retentionPolicyVersion: policy,
    }).expect(201);
    await post('projects', {
      id: project,
      title: 'Explicit Project',
      retentionPolicyVersion: policy,
    }).expect(201);
    await post('teams/' + team + '/tasks', {
      id: randomUUID(),
      title: 'Team source',
    }).expect(201);
    await post('projects/' + project + '/tasks', {
      id: randomUUID(),
      title: 'Project source',
    }).expect(201);
    await api()
      .put('/api/v1/teams/' + team + '/projects/' + project)
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .send({})
      .expect(200);
    const actor = async (userId: string) => ({
      userId,
      sessionId: (
        await context!.client.authSession.findFirstOrThrow({
          where: { userId },
          orderBy: { createdAt: 'desc' },
        })
      ).id,
      requestId: randomUUID(),
      correlationId: randomUUID(),
    });
    const offered = await context.service.createInvitation(
      await actor(owner.id),
      team,
      {
        kind: 'MEMBERSHIP',
        memberRole: 'LEAD',
        recipient: { userId: member.id },
      },
      randomUUID(),
    );
    await context.service.decideInvitation(
      await actor(member.id),
      offered.invitation.id,
      offered.proof!,
      1,
      true,
      'TEAM',
    );
    const seat = await context.client.contextAccess.findFirstOrThrow({
      where: { spaceId: team, SharedActor: { userId: member.id } },
    });
    const capacity = {
        id: randomUUID(),
        member: { accessId: seat.id, generation: seat.generation },
        date: '2030-01-07',
        timezone: 'UTC',
        availableMinutes: 360,
      },
      key = randomUUID();
    await post('teams/' + team + '/capacity', capacity, key).expect(201);
    await post('teams/' + team + '/capacity', capacity, key).expect(201);
    assert.equal(
      await context.client.teamCapacityDay.count({ where: { spaceId: team } }),
      1,
    );
    await context.app.close();
    context = undefined;
    const child = spawnSync(
      process.execPath,
      ['tooling/scripts/p3-03-smoke.ts', '--resume-pass'],
      {
        env: {
          ...environment,
          P303_TEAM: team,
          P303_COOKIE: owner.cookie,
          P303_MEMBER_COOKIE: member.cookie,
        },
        encoding: 'utf8',
      },
    );
    if (child.status !== 0) {
      fs.writeFileSync(
        path.join(root, 'child-error.log'),
        child.stdout + child.stderr,
      );
      throw Error(
        'Compiled Team analytics restart failed; synthetic log retained',
      );
    }
    fs.writeFileSync(
      path.join(root, 'report.json'),
      JSON.stringify(
        {
          compiledFreshProcess: 'PASS',
          capacityDurabilityAndIdempotency: 'PASS',
          authorizedDashboard: 'PASS',
          projectPrivacy: 'PASS',
          activation: 'SYNTHETIC_OWNED_SCHEMA_ONLY',
        },
        null,
        2,
      ) + '\n',
    );
    process.stdout.write(
      'PASS: compiled P3-03 HTTP API fresh-process restart, explicit capacity durability/idempotency, authorized dashboard and independent Project privacy.\n',
    );
  } finally {
    await context?.app.close();
    await sandbox.close();
  }
}
