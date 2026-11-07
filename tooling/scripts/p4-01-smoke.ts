import { CompaniesService } from '../../apps/api/dist/modules/companies/public/index.js';
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
  const schema = environment.P401_SCHEMA;
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
    companies: app.get(CompaniesService),
    grants: app.get(ResourceGrants),
    auth: app.get(AuthService),
  };
}

const origin = 'http://localhost:3000',
  password = 'synthetic-compiled-company-password-123!';
if (process.argv.includes('--resume-pass')) {
  const ctx = await runtime(process.env);
  try {
    const api = request(ctx.app.getHttpServer()),
      co = process.env.P401_COMPANY!,
      unit = process.env.P401_UNIT!,
      owner = process.env.P401_OWNER_COOKIE!,
      member = process.env.P401_MEMBER_COOKIE!;
    const response = await api
      .get('/api/v1/companies/' + co + '/units/' + unit)
      .set('Cookie', member)
      .expect(200);
    assert.equal(response.body.title, 'Compiled Unit');
    const policy = await api
      .get('/api/v1/companies/' + co + '/contexts/' + unit + '/policy')
      .set('Cookie', owner)
      .expect(200);
    assert.deepEqual(
      policy.body.chain.map((p: { version: number }) => p.version),
      [1, 2, 2],
    );
    await api
      .put('/api/v1/companies/' + co + '/contexts/' + co + '/policy')
      .set('Cookie', owner)
      .set('Origin', origin)
      .set('If-Match', '"1"')
      .send({
        rules: [
          {
            key: 'structure.read',
            mode: 'MANDATORY',
            roles: ['OWNER', 'ORG_ADMIN'],
            overrideDefault: false,
          },
        ],
      })
      .expect(200);
    await api
      .get('/api/v1/companies/' + co + '/units/' + unit)
      .set('Cookie', member)
      .expect(404);
    await api
      .get('/api/v1/companies/' + process.env.P401_OTHER_COMPANY)
      .set('Cookie', member)
      .expect(404);
    await api
      .get('/api/v1/projects/' + process.env.P401_PROJECT)
      .set('Cookie', member)
      .expect(404);
    assert.equal(
      (
        await ctx.client.task.findUniqueOrThrow({
          where: { id: process.env.P401_PROJECT_TASK! },
        })
      ).spaceId,
      process.env.P401_PROJECT,
    );
    assert.equal(
      (
        await ctx.client.sharedCustody.findUniqueOrThrow({
          where: { spaceId: process.env.P401_TEAM! },
        })
      ).kind,
      'TEAM',
    );
    await ctx.service.maintain();
    assert.equal(
      (
        await ctx.client.contextInvitation.findUniqueOrThrow({
          where: { id: process.env.P401_EXPIRED! },
        })
      ).state,
      'EXPIRED',
    );
    await api
      .get('/api/v1/company-invitations/preview')
      .set('X-Invitation-Proof', process.env.P401_EXPIRED_PROOF!)
      .expect(404);
  } finally {
    await ctx.app.close();
  }
} else {
  const sandbox = await migrationSandbox(process.env);
  let ctx: Awaited<ReturnType<typeof runtime>> | undefined;
  try {
    const r = spawnSync(
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
      r.status,
      0,
      'Owned Company smoke migration failed; credentials withheld',
    );
    const root = fs.mkdtempSync(path.resolve('.tools/p4-01-restart-')),
      env = {
        ...process.env,
        NODE_ENV: 'test',
        P401_SCHEMA: new URL(sandbox.url).searchParams.get('schema')!,
        BETTER_AUTH_URL: origin,
        BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
        STORAGE_ROOT: path.join(root, 'files'),
        SHARED_CONTROL_ROOT: path.join(root, 'control'),
        SHARED_CONTROL_KEYS: JSON.stringify({
          smoke: randomBytes(48).toString('base64url'),
        }),
        SHARED_CONTROL_ACTIVE_KEY_ID: 'smoke',
        SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-COMPILED-P401-ONLY',
      };
    ctx = await runtime(env, true);
    const api = request(ctx.app.getHttpServer());
    async function person() {
      const email = randomUUID() + '@example.test',
        signup = await api
          .post('/api/v1/auth/sign-up/email')
          .set('Origin', origin)
          .send({ name: 'Synthetic Company fixture', email, password })
          .expect(200),
        id = signup.body.user.id as string;
      await ctx!.client.user.update({
        where: { id },
        data: { emailVerified: true },
      });
      const login = await api
        .post('/api/v1/auth/sign-in/email')
        .set('Origin', origin)
        .send({ email, password })
        .expect(200);
      return {
        id,
        cookie: (login.headers['set-cookie'] as unknown as string[])
          .map((c) => c.split(';')[0])
          .join('; '),
      };
    }
    const owner = await person(),
      member = await person(),
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
          applicableContexts: ['PROJECT', 'TEAM', 'COMPANY'],
          marketScope: 'isolated compiled Company restart',
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
    const post = (url: string, body: object, cookie = owner.cookie) =>
      api
        .post('/api/v1/' + url)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .set('Idempotency-Key', randomUUID())
        .send(body);
    const co = randomUUID(),
      department = randomUUID(),
      unit = randomUUID();
    await post('companies', {
      id: co,
      title: 'Compiled Company',
      retentionPolicyVersion: policy,
    }).expect(201);
    await post('companies/' + co + '/departments', {
      id: department,
      title: 'Compiled Department',
    }).expect(201);
    await post('companies/' + co + '/departments/' + department + '/units', {
      id: unit,
      title: 'Compiled Unit',
    }).expect(201);
    for (const scope of [co, unit]) {
      const offer = await post(
        'companies/' + co + '/contexts/' + scope + '/invitations',
        { memberRole: 'MEMBER', recipient: { userId: member.id } },
      ).expect(201);
      await api
        .post(
          '/api/v1/company-invitations/' + offer.body.invitation.id + '/accept',
        )
        .set('Cookie', member.cookie)
        .set('Origin', origin)
        .set('If-Match', '"1"')
        .set('X-Invitation-Proof', offer.body.proof)
        .send({})
        .expect(200);
    }
    const put = (scope: string, rules: object[]) =>
      api
        .put('/api/v1/companies/' + co + '/contexts/' + scope + '/policy')
        .set('Cookie', owner.cookie)
        .set('Origin', origin)
        .set('If-Match', '"1"')
        .send({ rules });
    await put(department, [
      {
        key: 'structure.read',
        mode: 'DEFAULT',
        roles: ['OWNER', 'ORG_ADMIN'],
        overrideDefault: false,
      },
    ]).expect(200);
    await put(unit, [
      {
        key: 'structure.read',
        mode: 'DEFAULT',
        roles: [
          'OWNER',
          'ORG_ADMIN',
          'DEPT_MANAGER',
          'TEAM_LEAD',
          'MEMBER',
          'VIEWER',
        ],
        overrideDefault: true,
      },
    ]).expect(200);
    const actor = {
      userId: owner.id,
      sessionId: (
        await ctx.client.authSession.findFirstOrThrow({
          where: { userId: owner.id },
          orderBy: { createdAt: 'desc' },
        })
      ).id,
      requestId: randomUUID(),
      correlationId: randomUUID(),
    };
    const other = await ctx.companies.create(
        actor,
        {
          id: randomUUID(),
          title: 'Other Company',
          retentionPolicyVersion: policy,
        },
        randomUUID(),
      ),
      project = await ctx.projects.create(
        actor,
        {
          id: randomUUID(),
          title: 'Independent Project',
          retentionPolicyVersion: policy,
        },
        randomUUID(),
      ),
      task = await ctx.projects.createTask(
        actor,
        project.id,
        { id: randomUUID(), title: 'Independent source', priority: 'NONE' },
        randomUUID(),
      ),
      team = await ctx.teams.create(
        actor,
        {
          id: randomUUID(),
          title: 'Independent Team',
          retentionPolicyVersion: policy,
        },
        randomUUID(),
      );
    const expired = await ctx.companies.invite(
        actor,
        co,
        co,
        {
          memberRole: 'VIEWER',
          recipient: { email: randomUUID() + '@example.test' },
        },
        randomUUID(),
      ),
      deadline = new Date(Date.now() - 86400000);
    await ctx.client.contextInvitation.update({
      where: { id: expired.invitation.id },
      data: {
        createdAt: new Date(deadline.getTime() - 604800000),
        expiresAt: deadline,
      },
    });
    await ctx.app.close();
    ctx = undefined;
    const child = spawnSync(
      process.execPath,
      ['tooling/scripts/p4-01-smoke.ts', '--resume-pass'],
      {
        env: {
          ...env,
          P401_COMPANY: co,
          P401_UNIT: unit,
          P401_OWNER_COOKIE: owner.cookie,
          P401_MEMBER_COOKIE: member.cookie,
          P401_OTHER_COMPANY: other.id,
          P401_PROJECT: project.id,
          P401_PROJECT_TASK: task.id,
          P401_TEAM: team.id,
          P401_EXPIRED: expired.invitation.id,
          P401_EXPIRED_PROOF: expired.proof!,
        },
        encoding: 'utf8',
      },
    );
    if (child.status !== 0) {
      fs.writeFileSync(
        path.join(root, 'child-error.log'),
        child.stdout + child.stderr,
      );
      throw new Error(
        'Compiled Company restart failed; owned synthetic log retained',
      );
    }
    fs.writeFileSync(
      path.join(root, 'report.json'),
      JSON.stringify(
        {
          compiledApiFreshProcess: 'PASS',
          explicitChildAdmission: 'PASS',
          policyInheritanceAndMandatoryRestriction: 'PASS',
          crossCompanyIsolation: 'PASS',
          independentProjectTeamCustody: 'PASS',
          existingSharedMaintenanceAfterRestart: 'PASS',
          activation: 'SYNTHETIC_OWNED_SCHEMA_ONLY',
        },
        null,
        2,
      ) + '\n',
    );
    process.stdout.write(
      'PASS: fresh compiled Company API, explicit child admission, inherited default override, mandatory denial, cross-company isolation, independent Project/Team preservation and existing Shared expiry maintenance after restart.\n',
    );
  } finally {
    await ctx?.app.close();
    await sandbox.close();
  }
}
