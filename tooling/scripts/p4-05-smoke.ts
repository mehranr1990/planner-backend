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
  const schema = environment.P405_SCHEMA;
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
  password = 'synthetic-settlement-restart-only-123!';
if (process.argv.includes('--resume-pass')) {
  const ctx = await runtime(process.env);
  try {
    const api = request(ctx.app.getHttpServer()),
      root =
        '/api/v1/companies/' +
        process.env.P405_COMPANY +
        '/contexts/' +
        process.env.P405_COMPANY,
      owner = process.env.P405_OWNER_COOKIE!,
      member = process.env.P405_MEMBER_COOKIE!,
      reviewer = process.env.P405_REVIEWER_COOKIE!;
    const query = {
      fromDate: '2026-11-01',
      toDate: '2026-12-01',
      timezone: 'UTC',
    };
    const doc = await api
      .get(root + '/knowledge/documents/' + process.env.P405_DOCUMENT)
      .set('Cookie', member)
      .expect(200);
    assert.equal(doc.body.title, 'Restart guide');
    const download = await api
      .get(
        root +
          '/knowledge/documents/' +
          process.env.P405_DOCUMENT +
          '/versions/' +
          process.env.P405_VERSION +
          '/download',
      )
      .set('Cookie', member)
      .expect(200);
    assert.equal(download.body.toString(), 'Durable knowledge bytes');
    await api
      .get(root + '/reports/operations')
      .set('Cookie', owner)
      .query(query)
      .expect(200);
    await api
      .get(root + '/reports/finance')
      .set('Cookie', member)
      .query(query)
      .expect(403);
    const finance = await api
      .get(root + '/reports/finance')
      .set('Cookie', owner)
      .query(query)
      .expect(200);
    assert.equal(finance.body.budgets[0].limit, '100.10');
    assert.equal(finance.body.budgets[0].variance, '100.10');
    const portfolio = await api
      .get(root + '/reports/portfolio')
      .set('Cookie', owner)
      .query(query)
      .expect(200);
    assert.equal(
      portfolio.body.projects[0].projectId,
      process.env.P405_PROJECT,
    );
    const hidden = await api
      .get(root + '/reports/portfolio')
      .set('Cookie', reviewer)
      .query(query)
      .expect(200);
    assert.deepEqual(hidden.body.projects, []);
    const out = await api
      .post(root + '/exports')
      .set('Cookie', owner)
      .set('Origin', origin)
      .send({ ...query, dataset: 'KNOWLEDGE', format: 'JSON' })
      .expect(200);
    assert.equal(out.body.data.items[0].title, 'Restart guide');
    assert.match(out.headers['cache-control'] ?? '', /no-store/);
    const audit = await api
      .get(root + '/audit')
      .set('Cookie', owner)
      .query({ limit: 100 })
      .expect(200);
    assert.ok(
      audit.body.items.some(
        (r: { action: string }) =>
          r.action === 'company.knowledge.version.publish',
      ),
    );
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
    const fixtureRoot = fs.mkdtempSync(path.resolve('.tools/p4-05-restart-')),
      env = {
        ...process.env,
        NODE_ENV: 'test',
        P405_SCHEMA: new URL(sandbox.url).searchParams.get('schema')!,
        BETTER_AUTH_URL: origin,
        BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
        STORAGE_ROOT: path.join(fixtureRoot, 'files'),
        SHARED_CONTROL_ROOT: path.join(fixtureRoot, 'control'),
        SHARED_CONTROL_KEYS: JSON.stringify({
          smoke: randomBytes(48).toString('base64url'),
        }),
        SHARED_CONTROL_ACTIVE_KEY_ID: 'smoke',
        SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-COMPILED-P405-ONLY',
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
          applicableContexts: ['COMPANY', 'PROJECT'],
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
    const company = await post('companies', {
        id: randomUUID(),
        title: 'Knowledge restart Company',
        retentionPolicyVersion: policy,
      }).expect(201),
      id = company.body.id as string,
      base = 'companies/' + id + '/contexts/' + id;
    for (const [who, role] of [
      [member, 'MEMBER'],
      [reviewer, 'ORG_ADMIN'],
    ] as const) {
      const offer = await post(base + '/invitations', {
        memberRole: role,
        recipient: { userId: who.id },
      }).expect(201);
      await api
        .post(
          '/api/v1/company-invitations/' + offer.body.invitation.id + '/accept',
        )
        .set('Cookie', who.cookie)
        .set('Origin', origin)
        .set('If-Match', '"1"')
        .set('X-Invitation-Proof', offer.body.proof)
        .send({})
        .expect(200);
    }
    const folder = await post(base + '/knowledge/folders', {
      id: randomUUID(),
      parentId: null,
      title: 'Guides',
    }).expect(201);
    const doc = await post(base + '/knowledge/documents', {
      id: randomUUID(),
      folderId: folder.body.id,
      title: 'Restart guide',
      description: null,
    }).expect(201);
    const version = await post(
      base + '/knowledge/documents/' + doc.body.id + '/versions',
      {
        id: randomUUID(),
        filename: 'guide.txt',
        mimeType: 'text/plain',
        expectedSize: 23,
      },
    ).expect(201);
    const ready = await api
      .post(
        '/api/v1/' +
          base +
          '/knowledge/documents/' +
          doc.body.id +
          '/versions/' +
          version.body.id +
          '/complete',
      )
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .set('If-Match', '"1"')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('Durable knowledge bytes'))
      .expect(200);
    await api
      .post(
        '/api/v1/' +
          base +
          '/knowledge/documents/' +
          doc.body.id +
          '/versions/' +
          version.body.id +
          '/publish',
      )
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .set('If-Match', '"' + ready.body.revision + '"')
      .send({ documentRevision: 1 })
      .expect(200);
    await post(base + '/finance/budgets', {
      id: randomUUID(),
      title: 'Exact budget',
      amount: '100.10',
      currency: 'USD',
      startDate: '2026-01-01',
      endDate: '2027-01-01',
      timezone: 'UTC',
      projectReferenceId: null,
    }).expect(201);
    const project = await post('projects', {
      id: randomUUID(),
      title: 'Independent source',
      retentionPolicyVersion: policy,
    }).expect(201);
    await post(base + '/finance/project-references', {
      id: randomUUID(),
      projectId: project.body.id,
    }).expect(201);
    await ctx.app.close();
    ctx = undefined;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(60000, 60050 - (Date.now() % 60000))),
    );
    const child = spawnSync(
      process.execPath,
      ['tooling/scripts/p4-05-smoke.ts', '--resume-pass'],
      {
        env: {
          ...env,
          P405_COMPANY: id,
          P405_DOCUMENT: doc.body.id,
          P405_VERSION: version.body.id,
          P405_PROJECT: project.body.id,
          P405_OWNER_COOKIE: owner.cookie,
          P405_MEMBER_COOKIE: member.cookie,
          P405_REVIEWER_COOKIE: reviewer.cookie,
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
        'Compiled knowledge restart failed; synthetic log retained',
      );
    }
    process.stdout.write(
      'PASS: fresh compiled process preserves Company knowledge bytes, published version history, exact budgets, Company planning, independently authorized Project portfolio, scoped export and redacted audit.\n',
    );
  } finally {
    await ctx?.app.close();
    await sandbox.close();
  }
}
