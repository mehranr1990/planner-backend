import {
  CompanyLifecycleService,
  CompanyAssociationsService,
  CompanyCleanupService,
} from '../../apps/api/dist/modules/companies/public/index.js';
import { CompanyAccess } from '../../apps/api/dist/modules/spaces/public/index.js';
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
import { spawnSync, spawn } from 'node:child_process';
import { once } from 'node:events';
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
const workerSmoke = process.env.P406_WORKER_SMOKE === '1';
if (workerSmoke)
  assert.match(new URL(base).pathname, /^\/p406_[a-f0-9]{32}_test$/);
async function workerPass(
  environment: NodeJS.ProcessEnv,
  done?: () => Promise<boolean>,
) {
  const worker = spawn(process.execPath, ['apps/api/dist/worker.js'], {
    env: { ...environment, DATABASE_URL: base, JOBS_POLL_SECONDS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  worker.stdout.on('data', (chunk) => {
    output += String(chunk);
  });
  worker.stderr.on('data', (chunk) => {
    output += String(chunk);
  });
  try {
    for (let n = 0; n < 300; n++) {
      if (worker.exitCode !== null) break;
      if (
        output.includes('Planner notification worker ready') &&
        (!done || (await done()))
      )
        return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Compiled worker did not reach its durable checkpoint');
  } finally {
    if (worker.exitCode === null) {
      const exited = once(worker, 'exit');
      worker.kill();
      await exited;
    }
  }
}
async function runtime(environment: NodeJS.ProcessEnv, initialize = false) {
  const schema = environment.P406_SCHEMA;
  if (
    !schema ||
    (!/^p003_[a-f0-9]{32}$/.test(schema) &&
      !(workerSmoke && schema === 'public'))
  )
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
  password = 'synthetic-settlement-restart-only-123!';

if (process.argv.includes('--resume-pass')) {
  const ctx = await runtime(process.env);
  try {
    const api = request(ctx.app.getHttpServer()),
      id = process.env.P406_COMPANY!,
      scope = process.env.P406_SCOPE!,
      source = process.env.P406_SOURCE!,
      closed = process.env.P406_CLOSED!,
      cookie = process.env.P406_OWNER_COOKIE!,
      association = process.env.P406_ASSOCIATION!;
    const co = await api
      .get('/api/v1/companies/' + id)
      .set('Cookie', cookie)
      .expect(200);
    assert.equal(co.body.state, 'ARCHIVED');
    await api
      .post('/api/v1/companies/' + id + '/restore')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('If-Match', '"2"')
      .send({})
      .expect(200);
    const root = '/api/v1/companies/' + id + '/contexts/' + scope;
    const stale = await api
      .get(root + '/attachments')
      .set('Cookie', cookie)
      .expect(200);
    assert.deepEqual(stale.body.items, []);
    await api
      .post(root + '/associations/PROJECT/' + association + '/revoke')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('If-Match', '"4"')
      .send({ side: 'COMPANY' })
      .expect(200);
    const project = await api
      .get('/api/v1/projects/' + source)
      .set('Cookie', cookie)
      .expect(200);
    assert.equal(project.body.spaceId, source);
    if (workerSmoke) {
      await workerPass(
        process.env,
        async () =>
          (
            await ctx.client.sharedLifecycleJob.findFirstOrThrow({
              where: { custodyId: closed },
              orderBy: { generation: 'desc' },
            })
          ).state === 'DELETED',
      );
      assert.equal(
        await ctx.client.company.findUnique({ where: { id: closed } }),
        null,
      );
      process.stdout.write(
        'PASS: actual compiled worker.js stopped and restarted; durable Company disposal completed via its registered queue consumer.\n',
      );
    }
    const cleanup = ctx.app.get(CompanyCleanupService);
    for (
      let i = 0;
      i < 80 &&
      (await ctx.client.sharedCustody.findUnique({
        where: { spaceId: closed },
      }));
      i++
    )
      await cleanup.consume();
    assert.equal(
      await ctx.client.company.findUnique({ where: { id: closed } }),
      null,
    );
    assert.equal(
      (
        await ctx.client.sharedLifecycleJob.findFirstOrThrow({
          where: { custodyId: closed },
          orderBy: { generation: 'desc' },
        })
      ).state,
      'DELETED',
    );
    assert.equal(
      (await ctx.client.project.findUniqueOrThrow({ where: { id: source } }))
        .spaceId,
      source,
    );
  } finally {
    await ctx.app.close();
  }
} else {
  const sandbox = workerSmoke
    ? { url: base + '?schema=public', close: async () => {} }
    : await migrationSandbox(process.env);
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
      'Owned lifecycle smoke migrations failed; credentials withheld',
    );
    const root = fs.mkdtempSync(path.resolve('.tools/p4-06-restart-')),
      env = {
        ...process.env,
        NODE_ENV: 'test',
        P406_SCHEMA: new URL(sandbox.url).searchParams.get('schema')!,
        BETTER_AUTH_URL: origin,
        BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
        STORAGE_ROOT: path.join(root, 'files'),
        SHARED_CONTROL_ROOT: path.join(root, 'control'),
        SHARED_CONTROL_KEYS: JSON.stringify({
          smoke: randomBytes(48).toString('base64url'),
        }),
        SHARED_CONTROL_ACTIVE_KEY_ID: 'smoke',
        SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-COMPILED-P406-ONLY',
      };
    ctx = await runtime(env, true);
    if (workerSmoke) await workerPass(env);
    const api = request(ctx.app.getHttpServer());
    async function person() {
      const email = randomUUID() + '@example.test';
      const signup = await api
        .post('/api/v1/auth/sign-up/email')
        .set('Origin', origin)
        .send({ name: 'Synthetic lifecycle fixture', email, password })
        .expect(200);
      const userId = signup.body.user.id as string;
      await ctx!.client.user.update({
        where: { id: userId },
        data: { emailVerified: true },
      });
      const login = await api
        .post('/api/v1/auth/sign-in/email')
        .set('Origin', origin)
        .send({ email, password })
        .expect(200);
      const session = await ctx!.client.authSession.findFirstOrThrow({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
      return {
        userId,
        cookie: (login.headers['set-cookie'] as unknown as string[])
          .map((v) => v.split(';')[0])
          .join('; '),
        actor: {
          userId,
          sessionId: session.id,
          requestId: randomUUID(),
          correlationId: randomUUID(),
        },
      };
    }
    const owner = await person(),
      helper = await person(),
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
          applicableContexts: ['COMPANY', 'PROJECT', 'TEAM'],
          marketScope: 'isolated compiled lifecycle restart',
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
          backupPolicyReference: 'synthetic independent current control',
        },
      },
    });
    const co = await ctx.companies.create(
        owner.actor,
        {
          id: randomUUID(),
          title: 'Restart Company',
          retentionPolicyVersion: policy,
        },
        randomUUID(),
      ),
      dept = await ctx.companies.createContext(
        owner.actor,
        co.id,
        null,
        { id: randomUUID(), title: 'Explicit child' },
        randomUUID(),
      );
    const access = ctx.app.get(CompanyAccess);
    for (const [who, role, scope, by] of [
      [helper, 'ORG_ADMIN', co.id, owner],
      [owner, 'MEMBER', dept.id, helper],
    ] as const) {
      const offer = await ctx.companies.invite(
        by.actor,
        co.id,
        scope,
        { memberRole: role, recipient: { userId: who.userId } },
        randomUUID(),
      );
      await access.decide(
        who.actor,
        offer.invitation.id,
        offer.proof!,
        1,
        true,
      );
    }
    const source = await ctx.projects.create(
      owner.actor,
      {
        id: randomUUID(),
        title: 'Preserved independent root',
        retentionPolicyVersion: policy,
      },
      randomUUID(),
    );
    const associations = ctx.app.get(CompanyAssociationsService);
    const proposal = await associations.create(
      owner.actor,
      co.id,
      dept.id,
      { id: randomUUID(), kind: 'PROJECT', sourceId: source.id },
      randomUUID(),
    );
    await associations.change(
      owner.actor,
      co.id,
      dept.id,
      'PROJECT',
      proposal.id,
      1,
      'accept',
    );
    await associations.change(
      owner.actor,
      co.id,
      dept.id,
      'PROJECT',
      proposal.id,
      2,
      'request-attachment',
    );
    await associations.change(
      owner.actor,
      co.id,
      dept.id,
      'PROJECT',
      proposal.id,
      3,
      'accept-attachment',
    );
    const life = ctx.app.get(CompanyLifecycleService);
    await life.change(owner.actor, co.id, 1, 'archive');
    const closed = await ctx.companies.create(
      owner.actor,
      {
        id: randomUUID(),
        title: 'Durable disposal',
        retentionPolicyVersion: policy,
      },
      randomUUID(),
    );
    await life.change(owner.actor, closed.id, 1, 'delete', password);
    await ctx.client.sharedLifecycleJob.updateMany({
      where: { spaceId: closed.id },
      data: {
        effectiveDepartureAt: new Date(Date.now() - 31 * 86400000),
        recoveryDeadline: new Date(Date.now() - 86400000),
        nextAt: new Date(0),
      },
    });
    await ctx.app.close();
    ctx = undefined;
    const child = spawnSync(
      process.execPath,
      ['tooling/scripts/p4-06-smoke.ts', '--resume-pass'],
      {
        env: {
          ...env,
          P406_COMPANY: co.id,
          P406_SCOPE: dept.id,
          P406_SOURCE: source.id,
          P406_CLOSED: closed.id,
          P406_ASSOCIATION: proposal.id,
          P406_OWNER_COOKIE: owner.cookie,
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
        'Compiled Company lifecycle restart failed; synthetic log retained',
      );
    }
    if (workerSmoke)
      process.stdout.write(
        'PASS: actual compiled worker.js starts, stops, restarts and completes durable Company disposal through the registered queue consumer in a new isolated test database.\n',
      );
    process.stdout.write(
      'PASS: fresh compiled API and Company lifecycle consumer preserve archive state, invalidate stale attachments after restore, revoke only metadata, preserve independent Project custody and resume durable controlled Company disposal.\n',
    );
  } finally {
    await ctx?.app.close();
    await sandbox.close();
  }
}
