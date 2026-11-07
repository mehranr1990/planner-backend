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
  const schema = environment.P402_SCHEMA;
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
  password = 'synthetic-staff-restart-only-123!';
if (process.argv.includes('--resume-pass')) {
  const ctx = await runtime(process.env);
  try {
    const api = request(ctx.app.getHttpServer()),
      id = process.env.P402_COMPANY!,
      base = '/api/v1/companies/' + id + '/contexts/' + id,
      owner = process.env.P402_OWNER_COOKIE!,
      member = process.env.P402_MEMBER_COOKIE!,
      viewer = process.env.P402_VIEWER_COOKIE!,
      reviewer = process.env.P402_REVIEWER_COOKIE!;
    const profile = await api
      .get(base + '/staff-profiles/' + process.env.P402_PROFILE)
      .set('Cookie', member)
      .expect(200);
    assert.ok(profile.body.workEmail);
    const available = await api
      .get(base + '/availability')
      .set('Cookie', member)
      .expect(200);
    assert.equal(available.body.items[0].availableMinutes, 120);
    await api
      .get(base + '/employee-cases/' + process.env.P402_CASE)
      .set('Cookie', viewer)
      .expect(404);
    const entries = await api
      .get(base + '/employee-cases/' + process.env.P402_CASE + '/entries')
      .set('Cookie', reviewer)
      .expect(200);
    assert.equal(entries.body.items.length, 1);
    const item = process.env.P402_RESOURCE!,
      body = {
        id: randomUUID(),
        member: JSON.parse(process.env.P402_MEMBER_REF!),
        startAt: process.env.P402_START!,
        endAt: process.env.P402_END!,
      };
    await api
      .post(base + '/resources/' + item + '/allocations')
      .set('Cookie', owner)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .send(body)
      .expect(409);
    await api
      .post(base + '/allocations/' + process.env.P402_ALLOCATION + '/return')
      .set('Cookie', owner)
      .set('Origin', origin)
      .set('If-Match', '"1"')
      .send({})
      .expect(200);
    await api
      .post(base + '/resources/' + item + '/retire')
      .set('Cookie', owner)
      .set('Origin', origin)
      .set('If-Match', '"1"')
      .send({})
      .expect(200);
    await api
      .post(base + '/employee-cases/' + process.env.P402_CASE + '/erase')
      .set('Cookie', member)
      .set('Origin', origin)
      .set('If-Match', '"2"')
      .send({})
      .expect(200);
    const redacted = await api
      .get(base + '/employee-cases/' + process.env.P402_CASE)
      .set('Cookie', owner)
      .expect(200);
    assert.equal(redacted.body.reason, null);
    assert.equal(redacted.body.evidence, null);
    const erasedEntries = await api
      .get(base + '/employee-cases/' + process.env.P402_CASE + '/entries')
      .set('Cookie', reviewer)
      .expect(200);
    assert.equal(erasedEntries.body.items[0].body, null);
    await api
      .get(
        '/api/v1/companies/' +
          process.env.P402_OTHER +
          '/contexts/' +
          process.env.P402_OTHER +
          '/resources/' +
          item,
      )
      .set('Cookie', owner)
      .expect(404);
    await ctx.service.maintain();
    assert.equal(
      (
        await ctx.client.contextInvitation.findUniqueOrThrow({
          where: { id: process.env.P402_EXPIRED! },
        })
      ).state,
      'EXPIRED',
    );
    assert.equal(
      (
        await ctx.client.sharedCustody.findUniqueOrThrow({
          where: { spaceId: process.env.P402_PROJECT! },
        })
      ).kind,
      'PROJECT',
    );
    assert.equal(
      (
        await ctx.client.sharedCustody.findUniqueOrThrow({
          where: { spaceId: process.env.P402_TEAM! },
        })
      ).kind,
      'TEAM',
    );
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
      'Owned staff restart migration failed; credentials withheld',
    );
    const root = fs.mkdtempSync(path.resolve('.tools/p4-02-restart-')),
      env = {
        ...process.env,
        NODE_ENV: 'test',
        P402_SCHEMA: new URL(sandbox.url).searchParams.get('schema')!,
        BETTER_AUTH_URL: origin,
        BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
        STORAGE_ROOT: path.join(root, 'files'),
        SHARED_CONTROL_ROOT: path.join(root, 'control'),
        SHARED_CONTROL_KEYS: JSON.stringify({
          smoke: randomBytes(48).toString('base64url'),
        }),
        SHARED_CONTROL_ACTIVE_KEY_ID: 'smoke',
        SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-COMPILED-P402-ONLY',
      };
    ctx = await runtime(env, true);
    const api = request(ctx.app.getHttpServer());
    let peopleCreated = 0;
    async function person() {
      // The provider bounds both signup and signin to three per ten seconds.
      if (++peopleCreated === 4)
        await new Promise((resolve) => setTimeout(resolve, 11000));
      const email = randomUUID() + '@example.test',
        signup = await api
          .post('/api/v1/auth/sign-up/email')
          .set('Origin', origin)
          .send({ name: 'Synthetic staff fixture', email, password })
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
      reviewer = await person(),
      viewer = await person(),
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
          marketScope: 'isolated compiled staff restart',
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
      title: 'Compiled staff Company',
      retentionPolicyVersion: policy,
    }).expect(201);
    async function join(who: { id: string; cookie: string }, role: string) {
      const offer = await post(base + '/invitations', {
        memberRole: role,
        recipient: { userId: who.id },
      }).expect(201);
      const accepted = await api
        .post(
          '/api/v1/company-invitations/' + offer.body.invitation.id + '/accept',
        )
        .set('Cookie', who.cookie)
        .set('Origin', origin)
        .set('If-Match', '"1"')
        .set('X-Invitation-Proof', offer.body.proof)
        .send({})
        .expect(200);
      return {
        accessId: accepted.body.membership.id as string,
        generation: accepted.body.membership.generation as number,
      };
    }
    const subject = await join(member, 'MEMBER'),
      reviewerSeat = await join(reviewer, 'ORG_ADMIN');
    await join(viewer, 'VIEWER');
    const profile = randomUUID(),
      resource = randomUUID(),
      allocation = randomUUID(),
      employeeCase = randomUUID(),
      start = new Date(Date.now() - 600000).toISOString(),
      end = new Date(Date.now() + 3600000).toISOString();
    await post(base + '/staff-profiles', {
      id: profile,
      member: subject,
      position: 'Engineer',
    }).expect(201);
    await api
      .put('/api/v1/' + base + '/staff-profiles/' + profile + '/work-contact')
      .set('Cookie', member.cookie)
      .set('Origin', origin)
      .set('If-Match', '"1"')
      .send({ published: true })
      .expect(200);
    await post(
      base + '/availability',
      {
        id: randomUUID(),
        member: subject,
        date: '2026-11-07',
        timezone: 'Asia/Tehran',
        availableMinutes: 120,
      },
      member.cookie,
    ).expect(201);
    await post(base + '/resources', {
      id: resource,
      title: 'Compiled laptop',
    }).expect(201);
    await post(base + '/resources/' + resource + '/allocations', {
      id: allocation,
      member: subject,
      startAt: start,
      endAt: end,
    }).expect(201);
    await post(base + '/employee-cases', {
      id: employeeCase,
      subject,
      reviewer: reviewerSeat,
      reason: 'Private compiled evidence',
      evidence: 'Confidential body',
    }).expect(201);
    await api
      .post('/api/v1/' + base + '/employee-cases/' + employeeCase + '/entries')
      .set('Cookie', member.cookie)
      .set('Origin', origin)
      .set('If-Match', '"1"')
      .set('Idempotency-Key', randomUUID())
      .send({
        id: randomUUID(),
        kind: 'RESPONSE',
        body: 'Confidential response',
      })
      .expect(201);
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
      },
      other = await ctx.companies.create(
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
        id,
        id,
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
      ['tooling/scripts/p4-02-smoke.ts', '--resume-pass'],
      {
        env: {
          ...env,
          P402_COMPANY: id,
          P402_OTHER: other.id,
          P402_PROFILE: profile,
          P402_RESOURCE: resource,
          P402_ALLOCATION: allocation,
          P402_CASE: employeeCase,
          P402_OWNER_COOKIE: owner.cookie,
          P402_MEMBER_COOKIE: member.cookie,
          P402_REVIEWER_COOKIE: reviewer.cookie,
          P402_VIEWER_COOKIE: viewer.cookie,
          P402_MEMBER_REF: JSON.stringify(subject),
          P402_START: start,
          P402_END: end,
          P402_PROJECT: project.id,
          P402_TEAM: team.id,
          P402_EXPIRED: expired.invitation.id,
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
        'Compiled staff restart failed; owned synthetic log retained',
      );
    }
    process.stdout.write(
      'PASS: fresh compiled API restart preserves explicit staff/contact/availability/case/allocation records; enforces confidential readers, overlap, return/retirement and privacy redaction; preserves independent Project/Team custody and existing Shared expiry maintenance.\n',
    );
  } finally {
    await ctx?.app.close();
    await sandbox.close();
  }
}
