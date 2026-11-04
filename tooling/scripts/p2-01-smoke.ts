import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../apps/api/dist/generated/prisma/client.js';
import { parseEnvironment } from '../../apps/api/dist/bootstrap/environment.js';
import { DatabaseService } from '../../apps/api/dist/platform/database/database.service.js';
import { SharedIdentity } from '../../apps/api/dist/platform/auth/shared-identity.js';
import { PrivacyGate } from '../../apps/api/dist/platform/authorization/privacy-gate.js';
import { SpacePolicyService } from '../../apps/api/dist/platform/authorization/space-policy.service.js';
import { SharedControl } from '../../apps/api/dist/platform/storage/shared-control.js';
import {
  SharedKernel,
  freeSharedFeaturePolicy,
} from '../../apps/api/dist/modules/spaces/public/index.js';
import { SpacesService } from '../../apps/api/dist/modules/spaces/application/spaces.service.js';
import { SpacesRepository } from '../../apps/api/dist/modules/spaces/infrastructure/spaces.repository.js';
import { migrationSandbox } from '../testing/migration-sandbox.ts';
import { isolatedTestDatabaseUrl } from '../testing/test-database.ts';

const base = isolatedTestDatabaseUrl(process.env);
async function runtime(environment: NodeJS.ProcessEnv) {
  const schema = environment.P201_SCHEMA;
  if (!schema || !/^p003_[a-f0-9]{32}$/.test(schema))
    throw new Error('Owned smoke namespace required');
  const config = parseEnvironment({ ...environment, DATABASE_URL: base });
  const client = new PrismaClient({
    adapter: new PrismaPg(
      { connectionString: base, options: '-c search_path=' + schema },
      { schema },
    ),
  });
  const db = new DatabaseService(config);
  await db.client.$disconnect();
  Object.defineProperty(db, 'client', { value: client });
  const control = new SharedControl(config),
    privacy = new PrivacyGate();
  const kernel = new SharedKernel(
    db,
    config,
    new SharedIdentity(),
    control,
    privacy,
    freeSharedFeaturePolicy,
  );
  const spaces = new SpacesService(
    new SpacesRepository(db),
    new SpacePolicyService(),
    privacy,
    db,
    kernel,
  );
  return { client, kernel, spaces, control };
}
if (process.argv.includes('--consume') || process.argv.includes('--erase')) {
  const app = await runtime(process.env);
  try {
    if (process.argv.includes('--erase')) {
      const work = await app.client.sharedExitWork.findFirstOrThrow();
      await app.kernel.prepareIdentityErasure(work.userId, work.closedAt);
    } else await app.kernel.consumeExit();
  } finally {
    await app.client.$disconnect();
  }
} else {
  const sandbox = await migrationSandbox(process.env);
  let app: Awaited<ReturnType<typeof runtime>> | undefined;
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
        'Compiled smoke schema replay failed (credentials withheld)',
      );
    const root = fs.mkdtempSync(path.resolve('.tools/p2-restart-'));
    const environment = {
      ...process.env,
      NODE_ENV: 'test',
      P201_SCHEMA: new URL(sandbox.url).searchParams.get('schema')!,
      BETTER_AUTH_URL: 'http://localhost:3000',
      BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
      STORAGE_ROOT: path.join(root, 'private'),
      SHARED_CONTROL_ROOT: path.join(root, 'current-control'),
      SHARED_CONTROL_KEYS: JSON.stringify({
        smoke: randomBytes(48).toString('base64url'),
      }),
      SHARED_CONTROL_ACTIVE_KEY_ID: 'smoke',
      SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-COMPILED-RESTART-ONLY',
    };
    app = await runtime(environment);
    await app.control.initialize();
    const person = async () => {
      const userId = randomUUID(),
        sessionId = randomUUID();
      await app!.client.user.create({
        data: {
          id: userId,
          name: 'Synthetic compiled restart',
          email: userId + '@example.test',
          emailVerified: true,
        },
      });
      await app!.client.space.create({
        data: { id: randomUUID(), ownerUserId: userId, kind: 'PERSONAL' },
      });
      await app!.client.authSession.create({
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
      member = await person(),
      version = 'synthetic-' + randomUUID();
    const rule = {
      retainAfterClosureSeconds: 0,
      audience: ['OWNER'],
      exportAuthority: ['OWNER'],
      disposalAction: 'PURGE',
    };
    await app.client.sharedRetentionPolicy.create({
      data: {
        version,
        approvalReference: 'SYNTHETIC-ONLY',
        configuration: {
          policyVersion: version,
          approvalReference: 'SYNTHETIC-ONLY',
          accountableOperator: 'synthetic fixture',
          marketScope: 'isolated smoke',
          applicableContexts: ['PROJECT'],
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
          backupPolicyReference: 'synthetic-protected-current-control',
        },
      },
    });
    const shared = await app.kernel.provision(owner, randomUUID(), version),
      sole = await app.kernel.provision(owner, randomUUID(), version);
    const actorId = randomUUID(),
      accessId = randomUUID(),
      joinedAt = new Date();
    await app.client.$transaction(async (tx) => {
      await tx.sharedActor.create({
        data: {
          id: actorId,
          spaceId: shared.spaceId,
          userId: member.userId,
          state: 'ACTIVE',
        },
      });
      await tx.contextAccess.create({
        data: {
          id: accessId,
          spaceId: shared.spaceId,
          scopeId: shared.spaceId,
          actorId,
          state: 'ACTIVE',
          memberRole: 'MEMBER',
          joinedAt,
        },
      });
      await tx.contextAccessInterval.create({
        data: { accessId, generation: 1, joinedAt },
      });
    });
    const personal = await app.spaces.authorizePersonal(owner);
    await app.client.$transaction((tx) =>
      app!.spaces.setClosed(tx, personal, true),
    );
    assert.equal(await app.client.sharedExitWork.count(), 1);
    await app.client.$disconnect();
    function restart(mode: string) {
      const child = spawnSync(
        process.execPath,
        ['tooling/scripts/p2-01-smoke.ts', mode],
        {
          env: environment,
          encoding: 'utf8',
          windowsHide: true,
          timeout: 30000,
        },
      );
      if (child.status !== 0)
        throw new Error(
          'Compiled shared-exit restart failed (credentials withheld)',
        );
    }
    restart('--consume');
    restart('--consume');
    app = await runtime(environment);
    assert.equal(
      (
        await app.client.sharedCustody.findUniqueOrThrow({
          where: { spaceId: shared.spaceId },
        })
      ).state,
      'OWNER_EXIT_FROZEN',
    );
    assert.equal(
      (
        await app.client.sharedCustody.findUniqueOrThrow({
          where: { spaceId: sole.spaceId },
        })
      ).state,
      'CLOSING_GRACE',
    );
    assert.equal(
      await app.client.sharedAuditEvent.count({
        where: { action: 'account.exit' },
      }),
      2,
    );
    const job = await app.client.sharedLifecycleJob.findFirstOrThrow({
      where: { spaceId: sole.spaceId },
    });
    assert.equal(
      job.recoveryDeadline.getTime() - job.effectiveDepartureAt.getTime(),
      2592000000,
    );
    await app.client.$disconnect();
    restart('--erase');
    restart('--erase');
    app = await runtime(environment);
    assert.equal(
      await app.client.sharedActor.count({ where: { userId: owner.userId } }),
      0,
    );
    assert.equal(await app.client.sharedCustody.count(), 2);
    assert.equal(
      await app.client.user.count({ where: { id: member.userId } }),
      1,
    );
    fs.writeFileSync(
      path.join(root, 'report.json'),
      JSON.stringify(
        {
          compiledSharedExitRestart: 'PASS',
          duplicateFanout: 'PASS',
          lastMemberDeadline: 'PASS',
          boundedAttributionErasure: 'PASS',
          retainedOtherMember: 'PASS',
        },
        null,
        2,
      ) + '\n',
    );
    process.stdout.write(
      'PASS: compiled shared kernel survives process restart, converges owner exit/last departure once, and detaches erased attribution without deleting shared custody.\n',
    );
  } finally {
    await app?.client.$disconnect();
    await sandbox.close();
  }
}
