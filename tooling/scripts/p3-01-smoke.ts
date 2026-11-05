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
  const schema = environment.P301_SCHEMA;
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
if (process.argv.includes('--worker-pass')) {
  const context = await runtime(process.env);
  try {
    await context.service.maintain();
  } finally {
    await context.app.close();
  }
} else if (process.argv.includes('--resume-pass')) {
  const context = await runtime(process.env);
  try {
    const response = await request(context.app.getHttpServer())
      .get('/api/v1/teams/' + process.env.P301_TEAM)
      .set('Cookie', process.env.P301_COOKIE!)
      .expect(200);
    assert.equal(response.body.title, 'Compiled independent Team');
    const refs = await request(context.app.getHttpServer())
      .get('/api/v1/teams/' + process.env.P301_TEAM + '/projects')
      .set('Cookie', process.env.P301_COOKIE!)
      .expect(200);
    assert.equal(refs.body.items.length, 1);
    assert.equal(refs.body.items[0].project.id, process.env.P301_PROJECT);
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
        'Owned compiled P3-01 migration failed (credentials withheld)',
      );
    const root = fs.mkdtempSync(path.resolve('.tools/p3-01-restart-'));
    const environment = {
      ...process.env,
      NODE_ENV: 'test',
      P301_SCHEMA: new URL(sandbox.url).searchParams.get('schema')!,
      BETTER_AUTH_URL: 'http://localhost:3000',
      BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
      STORAGE_ROOT: path.join(root, 'files'),
      SHARED_CONTROL_ROOT: path.join(root, 'control'),
      SHARED_CONTROL_KEYS: JSON.stringify({
        smoke: randomBytes(48).toString('base64url'),
      }),
      SHARED_CONTROL_ACTIVE_KEY_ID: 'smoke',
      SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-COMPILED-P301-ONLY',
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
      other = await person(),
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
      teamId = randomUUID(),
      projectId = randomUUID();
    const api = () => request(context!.app.getHttpServer());
    await api()
      .post('/api/v1/teams')
      .set('Cookie', ownerCookie)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .send({
        id: teamId,
        title: 'Compiled independent Team',
        retentionPolicyVersion: policy,
      })
      .expect(201);
    await api()
      .post('/api/v1/projects')
      .set('Cookie', ownerCookie)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .send({
        id: projectId,
        title: 'Retained Project',
        retentionPolicyVersion: policy,
      })
      .expect(201);
    await api()
      .put('/api/v1/teams/' + teamId + '/projects/' + projectId)
      .set('Cookie', ownerCookie)
      .set('Origin', origin)
      .send({})
      .expect(200);
    const offer = await api()
      .post('/api/v1/teams/' + teamId + '/invitations')
      .set('Cookie', ownerCookie)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .send({
        kind: 'MEMBERSHIP',
        memberRole: 'LEAD',
        recipient: { userId: recipient.userId },
      })
      .expect(201);
    await api()
      .post('/api/v1/team-invitations/' + offer.body.invitation.id + '/accept')
      .set('Cookie', memberCookie)
      .set('Origin', origin)
      .set('If-Match', '"1"')
      .set('X-Invitation-Proof', offer.body.proof)
      .send({})
      .expect(201);
    const hidden = await api()
      .get('/api/v1/teams/' + teamId + '/projects')
      .set('Cookie', memberCookie)
      .expect(200);
    assert.deepEqual(hidden.body.items, []);
    const expired = await api()
      .post('/api/v1/teams/' + teamId + '/invitations')
      .set('Cookie', ownerCookie)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .send({
        kind: 'MEMBERSHIP',
        memberRole: 'VIEWER',
        recipient: { userId: other.userId },
      })
      .expect(201);
    await context.client
      .$executeRaw`UPDATE "ContextInvitation" SET "createdAt"=clock_timestamp()-interval '8 days',"expiresAt"=clock_timestamp()-interval '1 day' WHERE id=${expired.body.invitation.id}::uuid`;
    await context.app.close();
    context = undefined;
    const childEnv = {
      ...environment,
      P301_TEAM: teamId,
      P301_PROJECT: projectId,
      P301_COOKIE: ownerCookie,
    };
    for (const mode of ['--resume-pass', '--worker-pass', '--worker-pass']) {
      const child = spawnSync(
        process.execPath,
        ['tooling/scripts/p3-01-smoke.ts', mode],
        { env: childEnv, encoding: 'utf8' },
      );
      if (child.status !== 0)
        throw new Error(
          'Compiled Team child failed: ' + mode + ' (credentials withheld)',
        );
    }
    context = await runtime(environment);
    const row = await context.client.contextInvitation.findUniqueOrThrow({
      where: { id: expired.body.invitation.id },
    });
    assert.equal(row.state, 'EXPIRED');
    assert.equal(row.proofHash, null);
    assert.equal(
      await context.client.sharedAuditEvent.count({
        where: {
          spaceId: teamId,
          resourceId: row.id,
          action: 'invitation.expire',
        },
      }),
      1,
    );
    await api()
      .get('/api/v1/teams/' + teamId + '/memberships')
      .set('Cookie', memberCookie)
      .expect(200);
    fs.writeFileSync(
      path.join(root, 'report.json'),
      JSON.stringify(
        {
          compiledApiFreshProcess: 'PASS',
          compiledWorkerTwoProcesses: 'PASS',
          invitationExpiryOnce: 'PASS',
          projectVisibility: 'PASS',
          activation: 'SYNTHETIC_OWNED_SCHEMA_ONLY',
        },
        null,
        2,
      ) + '\n',
    );
    process.stdout.write(
      'PASS: compiled Team HTTP API fresh-process restart, durable Lead membership/reference, Project visibility and two independent worker passes with one expiry effect.\n',
    );
  } finally {
    await context?.app.close();
    await sandbox.close();
  }
}
