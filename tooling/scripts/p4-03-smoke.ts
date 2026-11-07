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
  const schema = environment.P403_SCHEMA;
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
  password = 'synthetic-finance-restart-only-123!';
if (process.argv.includes('--resume-pass')) {
  const ctx = await runtime(process.env);
  try {
    const api = request(ctx.app.getHttpServer()),
      id = process.env.P403_COMPANY!,
      root = '/api/v1/companies/' + id + '/contexts/' + id,
      owner = process.env.P403_OWNER_COOKIE!,
      member = process.env.P403_MEMBER_COOKIE!,
      reviewer = process.env.P403_REVIEWER_COOKIE!;
    const expense = await api
      .get(root + '/expenses/' + process.env.P403_EXPENSE)
      .set('Cookie', member)
      .expect(200);
    assert.equal(expense.body.state, 'APPROVED');
    assert.equal(expense.body.current.amount, '20.00');
    const budget = await api
      .get(root + '/finance/budgets/' + process.env.P403_BUDGET)
      .set('Cookie', owner)
      .expect(200);
    assert.equal(budget.body.spent, '20.00');
    assert.equal(budget.body.reserved, '10.00');
    assert.equal(budget.body.available, '70.00');
    await api
      .get(root + '/finance/budgets')
      .set('Cookie', member)
      .expect(403);
    const receipt =
      root +
      '/expenses/' +
      process.env.P403_EXPENSE +
      '/revisions/' +
      process.env.P403_VERSION +
      '/receipts/' +
      process.env.P403_RECEIPT;
    const download = await api
      .get(receipt + '/download')
      .set('Cookie', reviewer)
      .expect(200);
    assert.equal(download.headers['content-type'], 'application/octet-stream');
    assert.ok(download.headers['content-disposition']);
    await api
      .post(receipt + '/remove')
      .set('Cookie', member)
      .set('Origin', origin)
      .set('If-Match', '"3"')
      .send({})
      .expect(409);
    await ctx.service.maintain();
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
      'Owned finance smoke migration failed; credentials withheld',
    );
    const fixtureRoot = fs.mkdtempSync(path.resolve('.tools/p4-03-restart-')),
      env = {
        ...process.env,
        NODE_ENV: 'test',
        P403_SCHEMA: new URL(sandbox.url).searchParams.get('schema')!,
        BETTER_AUTH_URL: origin,
        BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
        STORAGE_ROOT: path.join(fixtureRoot, 'files'),
        SHARED_CONTROL_ROOT: path.join(fixtureRoot, 'control'),
        SHARED_CONTROL_KEYS: JSON.stringify({
          smoke: randomBytes(48).toString('base64url'),
        }),
        SHARED_CONTROL_ACTIVE_KEY_ID: 'smoke',
        SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-COMPILED-P403-ONLY',
      };
    ctx = await runtime(env, true);
    const api = request(ctx.app.getHttpServer());
    async function person() {
      const email = randomUUID() + '@example.test';
      const signup = await api
        .post('/api/v1/auth/sign-up/email')
        .set('Origin', origin)
        .send({ name: 'Synthetic finance fixture', email, password })
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
      return {
        id: userId,
        cookie: (login.headers['set-cookie'] as unknown as string[])
          .map((c) => c.split(';')[0])
          .join('; '),
      };
    }
    const owner = await person(),
      member = await person(),
      reviewer = await person(),
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
          applicableContexts: ['COMPANY'],
          marketScope: 'isolated compiled finance restart',
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
    const id = randomUUID(),
      base = 'companies/' + id + '/contexts/' + id;
    await post('companies', {
      id,
      title: 'Compiled Company finance',
      retentionPolicyVersion: policy,
    }).expect(201);
    async function admit(
      person: { id: string; cookie: string },
      memberRole: string,
    ) {
      const invitation = await post(
        'companies/' + id + '/contexts/' + id + '/invitations',
        { memberRole, recipient: { userId: person.id } },
      ).expect(201);
      const result = await api
        .post(
          '/api/v1/company-invitations/' +
            invitation.body.invitation.id +
            '/accept',
        )
        .set('Cookie', person.cookie)
        .set('Origin', origin)
        .set('If-Match', '"1"')
        .set('X-Invitation-Proof', invitation.body.proof)
        .send({})
        .expect(200);
      return {
        accessId: result.body.membership.id,
        generation: result.body.membership.generation,
      };
    }
    await admit(member, 'MEMBER');
    const reviewerRef = await admit(reviewer, 'ORG_ADMIN');
    const category = await post(base + '/finance/categories', {
      id: randomUUID(),
      title: 'Travel',
    }).expect(201);
    const budget = await post(base + '/finance/budgets', {
      id: randomUUID(),
      title: 'Travel budget',
      amount: '100.00',
      currency: 'USD',
      startDate: '2026-01-01',
      endDate: '2027-01-01',
      timezone: 'UTC',
    }).expect(201);
    const commitment = await post(
      base + '/finance/budgets/' + budget.body.id + '/commitments',
      { id: randomUUID(), amount: '30.00' },
    ).expect(201);
    const expense = await post(
      base + '/expenses',
      {
        id: randomUUID(),
        amount: '20.00',
        currency: 'USD',
        categoryId: category.body.id,
        occurredDate: '2026-11-07',
        timezone: 'UTC',
        allocations: [
          {
            budgetId: budget.body.id,
            commitmentId: commitment.body.id,
            amount: '20.00',
          },
        ],
      },
      member.cookie,
    ).expect(201);
    const receipts =
        base +
        '/expenses/' +
        expense.body.id +
        '/revisions/' +
        expense.body.current.id +
        '/receipts',
      bytes = Buffer.from('%PDF-1.7\nsynthetic finance receipt\n%%EOF\n');
    const receipt = await post(
      receipts,
      {
        id: randomUUID(),
        filename: 'receipt.pdf',
        mimeType: 'application/pdf',
        expectedSize: bytes.length,
      },
      member.cookie,
    ).expect(201);
    await api
      .post('/api/v1/' + receipts + '/' + receipt.body.id + '/complete')
      .set('Cookie', member.cookie)
      .set('Origin', origin)
      .set('If-Match', '"1"')
      .set('Content-Type', 'application/octet-stream')
      .send(bytes)
      .expect(200);
    const submitted = await api
      .post('/api/v1/' + base + '/expenses/' + expense.body.id + '/submit')
      .set('Cookie', member.cookie)
      .set('Origin', origin)
      .set('If-Match', '"1"')
      .send({ reviewer: reviewerRef })
      .expect(200);
    await api
      .post('/api/v1/' + base + '/expenses/' + expense.body.id + '/decision')
      .set('Cookie', reviewer.cookie)
      .set('Origin', origin)
      .set('If-Match', '"' + submitted.body.revision + '"')
      .send({ decision: 'APPROVE' })
      .expect(200);
    await ctx.app.close();
    ctx = undefined;
    const child = spawnSync(
      process.execPath,
      ['tooling/scripts/p4-03-smoke.ts', '--resume-pass'],
      {
        env: {
          ...env,
          P403_COMPANY: id,
          P403_BUDGET: budget.body.id,
          P403_EXPENSE: expense.body.id,
          P403_VERSION: expense.body.current.id,
          P403_RECEIPT: receipt.body.id,
          P403_OWNER_COOKIE: owner.cookie,
          P403_MEMBER_COOKIE: member.cookie,
          P403_REVIEWER_COOKIE: reviewer.cookie,
        },
        encoding: 'utf8',
      },
    );
    if (child.status !== 0) {
      fs.writeFileSync(
        path.join(fixtureRoot, 'child-error.log'),
        child.stdout + child.stderr,
      );
      throw new Error(
        'Compiled finance restart failed; synthetic log retained',
      );
    }
    process.stdout.write(
      'PASS: fresh compiled API restart preserves approved expense, immutable receipt bytes, exact budget and commitment balances; denies member financial directory and submitted receipt mutation; existing Shared maintenance remains operational.\n',
    );
  } finally {
    await ctx?.app.close();
    await sandbox.close();
  }
}
