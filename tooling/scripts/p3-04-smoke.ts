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
  const schema = environment.P304_SCHEMA;
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
      team = process.env.P304_TEAM!,
      publication = process.env.P304_DISCLOSURE!;
    const record = await api
      .get('/api/v1/teams/' + team + '/cases/' + process.env.P304_CASE)
      .set('Cookie', process.env.P304_AUTHOR_COOKIE!)
      .expect(200);
    assert.equal(record.body.evidence, 'Compiled confidential evidence');
    const summary = await api
      .get('/api/v1/teams/' + team + '/disclosures/' + publication)
      .set('Cookie', process.env.P304_OWNER_COOKIE!)
      .expect(200);
    assert.deepEqual(Object.keys(summary.body).sort(), [
      'expiresAt',
      'id',
      'kind',
      'summary',
    ]);
    assert.equal(summary.body.summary, 'Compiled reviewed summary');
    const meeting = await api
      .get('/api/v1/teams/' + team + '/meetings/' + process.env.P304_MEETING)
      .set('Cookie', process.env.P304_SUBJECT_COOKIE!)
      .expect(200);
    assert.equal(meeting.body.agenda, 'Compiled meeting agenda');
    assert.equal(meeting.body.event.id, process.env.P304_EVENT);
    const invitations = await api
      .get(
        '/api/v1/teams/' +
          team +
          '/meetings/' +
          process.env.P304_MEETING +
          '/invitations',
      )
      .set('Cookie', process.env.P304_SUBJECT_COOKIE!)
      .expect(200);
    assert.equal(invitations.body.items[0].state, 'ACCEPTED');
    await api
      .post(
        '/api/v1/teams/' + team + '/disclosures/' + publication + '/consent',
      )
      .set('Cookie', process.env.P304_SUBJECT_COOKIE!)
      .set('Origin', 'http://localhost:3000')
      .set('If-Match', '"3"')
      .send({ consent: false })
      .expect(201);
    await api
      .get('/api/v1/teams/' + team + '/disclosures/' + publication)
      .set('Cookie', process.env.P304_OWNER_COOKIE!)
      .expect(404);
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
    const root = fs.mkdtempSync(path.resolve('.tools/p3-04-restart-'));
    const environment = {
      ...process.env,
      NODE_ENV: 'test',
      P304_SCHEMA: new URL(sandbox.url).searchParams.get('schema')!,
      BETTER_AUTH_URL: 'http://localhost:3000',
      BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
      STORAGE_ROOT: path.join(root, 'files'),
      SHARED_CONTROL_ROOT: path.join(root, 'control'),
      SHARED_CONTROL_KEYS: JSON.stringify({
        smoke: randomBytes(48).toString('base64url'),
      }),
      SHARED_CONTROL_ACTIVE_KEY_ID: 'smoke',
      SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-COMPILED-P304-ONLY',
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
      subject = await person(),
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
      team = randomUUID();
    const post = (
      url: string,
      body: object,
      cookie = owner.cookie,
      key = randomUUID(),
    ) =>
      api()
        .post('/api/v1/' + url)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .set('Idempotency-Key', key)
        .send(body);
    await post('teams', {
      id: team,
      title: 'Confidential Team',
      retentionPolicyVersion: policy,
    }).expect(201);
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
    for (const [person, role] of [
      [member, 'LEAD'],
      [subject, 'VIEWER'],
    ] as const) {
      const invite = await context.service.createInvitation(
        await actor(owner.id),
        team,
        {
          kind: 'MEMBERSHIP',
          memberRole: role,
          recipient: { userId: person.id },
        },
        randomUUID(),
      );
      await context.service.decideInvitation(
        await actor(person.id),
        invite.invitation.id,
        invite.proof!,
        1,
        true,
        'TEAM',
      );
    }
    const seat = async (userId: string) => {
      const r = await context!.client.contextAccess.findFirstOrThrow({
        where: { spaceId: team, SharedActor: { userId } },
      });
      return { accessId: r.id, generation: r.generation };
    };
    const input = {
        id: randomUUID(),
        kind: 'RECOGNITION',
        subject: await seat(subject.id),
        reviewer: await seat(owner.id),
        reason: 'Compiled confidential reason',
        evidence: 'Compiled confidential evidence',
      },
      key = randomUUID();
    await post('teams/' + team + '/cases', input, member.cookie, key).expect(
      201,
    );
    await post('teams/' + team + '/cases', input, member.cookie, key).expect(
      201,
    );
    const proposed = await post(
      'teams/' + team + '/cases/' + input.id + '/disclosures',
      {
        id: randomUUID(),
        sourceRevision: 1,
        audience: 'TEAM',
        recipients: [],
        summary: 'Compiled reviewed summary',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      },
      member.cookie,
    ).expect(201);
    await post(
      'teams/' + team + '/disclosures/' + proposed.body.id + '/review',
      { approve: true, reason: 'Reviewed bounded summary' },
    )
      .set('If-Match', '"1"')
      .expect(201);
    const hidden = await api()
      .get('/api/v1/teams/' + team + '/disclosures')
      .set('Cookie', owner.cookie)
      .expect(200);
    assert.equal(hidden.body.items.length, 0);
    await post(
      'teams/' + team + '/disclosures/' + proposed.body.id + '/consent',
      { consent: true },
      subject.cookie,
    )
      .set('If-Match', '"2"')
      .expect(201);
    const meeting = await post('teams/' + team + '/meetings', {
      id: randomUUID(),
      event: {
        title: 'Compiled meeting',
        schedule: {
          kind: 'ALL_DAY',
          timezone: 'Asia/Tehran',
          startDate: '2030-01-07',
          endDate: '2030-01-08',
        },
      },
      agenda: 'Compiled meeting agenda',
    }).expect(201);
    const invitation = await post(
      'teams/' + team + '/meetings/' + meeting.body.id + '/invitations',
      {
        id: randomUUID(),
        member: await seat(subject.id),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      },
    )
      .set('If-Match', '"1"')
      .expect(201);
    await post(
      'teams/' +
        team +
        '/meetings/' +
        meeting.body.id +
        '/invitations/' +
        invitation.body.id +
        '/respond',
      { decision: 'ACCEPTED' },
      subject.cookie,
    )
      .set('If-Match', '"1"')
      .expect(201);
    assert.equal(
      await context.client.teamCase.count({ where: { id: input.id } }),
      1,
    );
    await context.app.close();
    context = undefined;
    const child = spawnSync(
      process.execPath,
      ['tooling/scripts/p3-04-smoke.ts', '--resume-pass'],
      {
        env: {
          ...environment,
          P304_TEAM: team,
          P304_CASE: input.id,
          P304_DISCLOSURE: proposed.body.id,
          P304_MEETING: meeting.body.id,
          P304_EVENT: meeting.body.event.id,
          P304_AUTHOR_COOKIE: member.cookie,
          P304_SUBJECT_COOKIE: subject.cookie,
          P304_OWNER_COOKIE: owner.cookie,
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
        'Compiled P3-04 restart failed; owned synthetic log retained',
      );
    }
    fs.writeFileSync(
      path.join(root, 'report.json'),
      JSON.stringify(
        {
          compiledApiFreshProcess: 'PASS',
          confidentialRecordDurability: 'PASS',
          reviewAndConsent: 'PASS',
          boundedSummary: 'PASS',
          meetingAndInvitation: 'PASS',
          consentWithdrawal: 'PASS',
          activation: 'SYNTHETIC_OWNED_SCHEMA_ONLY',
        },
        null,
        2,
      ) + '\n',
    );
    process.stdout.write(
      'PASS: compiled P3-04 HTTP API fresh-process restart, confidential record and reviewed summary durability, consent withdrawal, unified Calendar meeting and invitation acceptance.\n',
    );
  } finally {
    await context?.app.close();
    await sandbox.close();
  }
}
