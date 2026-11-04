import 'reflect-metadata';
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
} from '../../apps/api/dist/modules/spaces/public/index.js';
import { migrationSandbox } from '../testing/migration-sandbox.ts';
import { isolatedTestDatabaseUrl } from '../testing/test-database.ts';

const base = isolatedTestDatabaseUrl(process.env);
async function runtime(environment: NodeJS.ProcessEnv, initialize = false) {
  const schema = environment.P202_SCHEMA;
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
  const app = await Test.createTestingModule({
    imports: [AppModule.register(config)],
  })
    .overrideProvider(DatabaseService)
    .useValue(database)
    .compile();
  const shared = app.get(SharedControl);
  if (initialize) {
    await app.get(ErasureControl).initialize();
    await shared.initialize();
  }
  await app.init();
  return {
    app,
    client,
    kernel: app.get(SharedKernel),
    service: app.get(CollaborationService),
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
        'Owned compiled P2-02 migration failed (credentials withheld)',
      );
    const root = fs.mkdtempSync(path.resolve('.tools/p2-02-restart-'));
    const environment = {
      ...process.env,
      NODE_ENV: 'test',
      P202_SCHEMA: new URL(sandbox.url).searchParams.get('schema')!,
      BETTER_AUTH_URL: 'http://localhost:3000',
      BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
      STORAGE_ROOT: path.join(root, 'files'),
      SHARED_CONTROL_ROOT: path.join(root, 'control'),
      SHARED_CONTROL_KEYS: JSON.stringify({
        smoke: randomBytes(48).toString('base64url'),
      }),
      SHARED_CONTROL_ACTIVE_KEY_ID: 'smoke',
      SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-COMPILED-P202-ONLY',
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
          applicableContexts: ['PROJECT'],
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
    const b = await context.kernel.provision(owner, randomUUID(), policy);
    const first = await context.service.createInvitation(
      owner,
      b.spaceId,
      {
        kind: 'MEMBERSHIP',
        memberRole: 'MEMBER',
        recipient: { userId: recipient.userId },
      },
      randomUUID(),
    );
    const accepted = await context.service.decideInvitation(
      recipient,
      first.invitation.id,
      first.proof!,
      1,
      true,
    );
    assert.ok('membership' in accepted);
    const handover = await context.service.createHandover(
      owner,
      b.spaceId,
      { successorAccessId: accepted.membership.id },
      randomUUID(),
    );
    const pending = await context.service.createInvitation(
      owner,
      b.spaceId,
      {
        kind: 'MEMBERSHIP',
        memberRole: 'VIEWER',
        recipient: { userId: other.userId },
      },
      randomUUID(),
    );
    await context.client
      .$executeRaw`UPDATE "ContextInvitation" SET "createdAt"=statement_timestamp()-interval '8 days',"expiresAt"=statement_timestamp()-interval '1 day' WHERE id=${pending.invitation.id}::uuid`;
    await context.client
      .$executeRaw`UPDATE "OwnerHandover" SET "createdAt"=statement_timestamp()-interval '8 days',"expiresAt"=statement_timestamp()-interval '1 day' WHERE id=${handover.id}::uuid`;
    await context.app.close();
    context = undefined;
    const restart = () => {
      const child = spawnSync(
        process.execPath,
        ['tooling/scripts/p2-02-smoke.ts', '--worker-pass'],
        {
          env: environment,
          encoding: 'utf8',
          windowsHide: true,
          timeout: 30000,
        },
      );
      if (child.status !== 0)
        throw new Error(
          'Compiled collaboration worker restart failed (credentials withheld)',
        );
    };
    restart();
    restart();
    context = await runtime(environment);
    assert.equal(
      (
        await context.client.contextInvitation.findUniqueOrThrow({
          where: { id: pending.invitation.id },
        })
      ).state,
      'EXPIRED',
    );
    assert.equal(
      (
        await context.client.ownerHandover.findUniqueOrThrow({
          where: { id: handover.id },
        })
      ).state,
      'EXPIRED',
    );
    assert.equal(
      await context.client.sharedAuditEvent.count({
        where: { spaceId: b.spaceId, action: 'invitation.expire' },
      }),
      1,
    );
    assert.equal(
      await context.client.sharedAuditEvent.count({
        where: { spaceId: b.spaceId, action: 'handover.expire' },
      }),
      1,
    );
    assert.deepEqual(
      await context.service.decideInvitation(
        recipient,
        first.invitation.id,
        first.proof!,
        1,
        true,
      ),
      accepted,
    );
    const fresh = await context.service.createHandover(
      owner,
      b.spaceId,
      { successorAccessId: accepted.membership.id },
      randomUUID(),
    );
    assert.equal(
      (
        await context.service.decideHandover(
          recipient,
          b.spaceId,
          fresh.id,
          1,
          'accept',
          'synthetic-compiled-password-123!',
        )
      ).state,
      'ACCEPTED',
    );
    assert.equal(
      (
        await context.client.sharedCustody.findUniqueOrThrow({
          where: { spaceId: b.spaceId },
        })
      ).primaryOwnerAccessId,
      accepted.membership.id,
    );
    fs.writeFileSync(
      path.join(root, 'report.json'),
      JSON.stringify(
        {
          compiledRestart: 'PASS',
          expiryIdempotency: 'PASS',
          acceptedReplay: 'PASS',
          providerBackedSuccession: 'PASS',
          activation: 'SYNTHETIC_OWNED_SCHEMA_ONLY',
        },
        null,
        2,
      ) + '\n',
    );
    process.stdout.write(
      'PASS: compiled collaboration process restart, invitation/handover expiry exactly once, authorized replay and provider-backed ownership succession.\n',
    );
  } finally {
    await context?.app.close();
    await sandbox.close();
  }
}
