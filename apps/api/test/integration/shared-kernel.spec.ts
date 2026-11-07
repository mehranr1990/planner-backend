import {
  CompanyErasure,
  freeSharedFeaturePolicy,
} from '../../src/modules/spaces/public/index.js';
import 'reflect-metadata';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setImmediate as tick } from 'node:timers/promises';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { migrationSandbox } from '../../../../tooling/testing/migration-sandbox.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import { parseEnvironment } from '../../src/bootstrap/environment.js';
import type { DatabaseService } from '../../src/platform/database/database.service.js';
import { SharedIdentity } from '../../src/platform/auth/shared-identity.js';
import type { RequestActor } from '../../src/platform/auth/request-actor.js';
import { PrivacyGate } from '../../src/platform/authorization/privacy-gate.js';
import { SpacePolicyService } from '../../src/platform/authorization/space-policy.service.js';
import { SharedControl } from '../../src/platform/storage/shared-control.js';
import { SharedKernel } from '../../src/modules/spaces/public/index.js';
import type { SharedRequest } from '../../src/modules/spaces/public/index.js';
import { SpacesService } from '../../src/modules/spaces/application/spaces.service.js';
import { SpacesRepository } from '../../src/modules/spaces/infrastructure/spaces.repository.js';
import { defaultPolicy } from '../../src/modules/spaces/domain/shared-policy.js';
import type { MemberRole } from '../../src/modules/spaces/domain/shared-policy.js';

const barrier = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};
const outcome = <T>(p: Promise<T>) =>
  p.then(
    (value) => ({ value, error: undefined }),
    (error) => ({ error: error as Error, value: undefined }),
  );
describe('P2-01 shared kernel acceptance in an exclusively owned schema', () => {
  let sandbox: Awaited<ReturnType<typeof migrationSandbox>>,
    client: PrismaClient,
    db: DatabaseService,
    observer: Client,
    kernel: SharedKernel,
    spaces: SpacesService,
    control: SharedControl;
  let owner: RequestActor,
    member: RequestActor,
    viewer: RequestActor,
    outsider: RequestActor;
  let config: ReturnType<typeof parseEnvironment>;
  const appName = 'p201-' + randomUUID(),
    policyVersion = 'synthetic-p201-' + randomUUID();
  const req = (
    spaceId: string,
    capability: SharedRequest['capability'] = 'task.update',
  ): SharedRequest => ({ spaceId, scopeId: spaceId, capability });
  async function person(verified = true) {
    const id = randomUUID(),
      sessionId = randomUUID();
    await client.user.create({
      data: {
        id,
        email: id + '@example.test',
        name: 'Synthetic P2 fixture',
        emailVerified: verified,
      },
    });
    await client.space.create({
      data: { id: randomUUID(), ownerUserId: id, kind: 'PERSONAL' },
    });
    await client.authSession.create({
      data: {
        id: sessionId,
        userId: id,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    return {
      userId: id,
      sessionId,
      requestId: randomUUID(),
      correlationId: randomUUID(),
    };
  }
  async function admission(
    spaceId: string,
    actor: RequestActor,
    role: MemberRole | null = 'MEMBER',
  ) {
    const actorId = randomUUID(),
      accessId = randomUUID(),
      joinedAt = new Date();
    await client.$transaction(async (tx) => {
      await tx.sharedActor.create({
        data: { id: actorId, spaceId, userId: actor.userId, state: 'ACTIVE' },
      });
      await tx.contextAccess.create({
        data: {
          id: accessId,
          spaceId,
          scopeId: spaceId,
          actorId,
          state: 'ACTIVE',
          memberRole: role,
          joinedAt,
        },
      });
      await tx.contextAccessInterval.create({
        data: { accessId, generation: 1, joinedAt },
      });
    });
    return { actorId, accessId };
  }
  async function boundary(who: RequestActor = owner) {
    const spaceId = randomUUID();
    return kernel.provision(who, spaceId, policyVersion);
  }
  async function authority(
    actor: RequestActor,
    spaceId: string,
    capability: SharedRequest['capability'] = 'task.update',
  ) {
    return kernel.run(
      actor,
      { userIds: [], spaceIds: [spaceId] },
      [req(spaceId, capability)],
      async (tx, a) => a.require(tx, spaceId, capability),
    );
  }
  async function mutation(
    actor: RequestActor,
    spaceId: string,
    key = randomUUID(),
    pause?: () => Promise<void>,
  ) {
    const request = req(spaceId);
    return kernel.run(
      actor,
      { userIds: [], spaceIds: [spaceId] },
      [request],
      async (tx, a) => {
        await pause?.();
        return kernel.receipt(
          tx,
          a,
          request,
          {
            operation: 'kernel.test',
            key,
            fingerprint: createHash('sha256').update('fixture').digest('hex'),
          },
          async () => {
            const id = randomUUID(),
              access = a.require(tx, spaceId, 'task.update');
            await tx.sharedAuditEvent.create({
              data: {
                id,
                spaceId,
                actorId: access.actorId,
                action: 'kernel.test',
                requestId: actor.requestId,
              },
            });
            await tx.sharedOutboxEvent.create({
              data: {
                id: randomUUID(),
                spaceId,
                actorId: access.actorId,
                auditId: id,
                action: 'kernel.test',
                authorizationVersion: access.authorizationVersion,
              },
            });
            return { id, statusCode: 200 };
          },
        );
      },
    );
  }
  async function blocked() {
    const until = Date.now() + 5000;
    while (Date.now() < until) {
      const row = await observer.query<{ n: number }>(
        `SELECT count(DISTINCT a.pid)::int n FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid WHERE a.application_name=$1 AND cardinality(pg_blocking_pids(a.pid))>0 AND NOT l.granted`,
        [appName],
      );
      if (row.rows[0]!.n > 0) return;
      await tick();
    }
    throw new Error(
      'Expected independent PostgreSQL lock waiter was not observed',
    );
  }
  beforeAll(async () => {
    sandbox = await migrationSandbox(process.env);
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
      throw new Error('Owned P2 schema replay failed (credentials withheld)');
    const base = isolatedTestDatabaseUrl(process.env),
      schema = new URL(sandbox.url).searchParams.get('schema')!;
    client = new PrismaClient({
      adapter: new PrismaPg(
        {
          connectionString: base,
          application_name: appName,
          options: '-c timezone=UTC -c search_path=' + schema,
          max: 8,
        },
        { schema },
      ),
    });
    db = {
      client,
      checkConnection: async () => {
        await client.$queryRaw`SELECT 1`;
      },
      onApplicationShutdown: () => client.$disconnect(),
    };
    observer = new Client({
      connectionString: base,
      options: '-c search_path=' + schema,
    });
    await observer.connect();
    const root = fs.mkdtempSync(path.resolve('.tools/p2-acceptance-'));
    config = parseEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: base,
      BETTER_AUTH_SECRET: 'synthetic-p2-auth-secret-unchanged-and-not-shared',
      BETTER_AUTH_URL: 'http://localhost:3000',
      STORAGE_ROOT: path.join(root, 'files'),
      SHARED_CONTROL_ROOT: path.join(root, 'control'),
      SHARED_CONTROL_KEYS: JSON.stringify({
        k1: 'synthetic-purpose-separated-control-key-0001',
      }),
      SHARED_CONTROL_ACTIVE_KEY_ID: 'k1',
      SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-ISOLATED-TEST-ONLY',
    });
    control = new SharedControl(config);
    await control.initialize();
    kernel = new SharedKernel(
      db,
      config,
      new SharedIdentity(),
      control,
      new PrivacyGate(),
      freeSharedFeaturePolicy,
      new CompanyErasure(),
    );
    spaces = new SpacesService(
      new SpacesRepository(db),
      new SpacePolicyService(),
      new PrivacyGate(),
      db,
      kernel,
    );
    const rule = {
      retainAfterClosureSeconds: 0,
      audience: ['OWNER', 'ADMIN'],
      exportAuthority: ['OWNER'],
      disposalAction: 'PURGE',
    };
    await client.sharedRetentionPolicy.create({
      data: {
        version: policyVersion,
        approvalReference: 'SYNTHETIC-ONLY',
        configuration: {
          policyVersion,
          approvalReference: 'SYNTHETIC-ONLY',
          accountableOperator: 'synthetic fixture',
          applicableContexts: ['PROJECT'],
          marketScope: 'synthetic isolated rehearsal',
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
          backupPolicyReference:
            'synthetic isolated current-control checkpoint',
        },
      },
    });
    owner = await person();
    member = await person();
    viewer = await person();
    outsider = await person();
  }, 30000);
  afterAll(async () => {
    vi.restoreAllMocks();
    await client?.$disconnect();
    await observer?.end();
    await sandbox?.close();
  });
  it('gates creation with missing security acceptance or complete operator retention', async () => {
    const gated = new SharedKernel(
      db,
      { ...config, SHARED_SECURITY_ACCEPTANCE_REFERENCE: undefined },
      new SharedIdentity(),
      control,
      new PrivacyGate(),
      freeSharedFeaturePolicy,
      new CompanyErasure(),
    );
    await expect(
      gated.provision(owner, randomUUID(), policyVersion),
    ).rejects.toThrow();
    await expect(
      kernel.provision(owner, randomUUID(), 'missing'),
    ).rejects.toThrow();
    await client.sharedRetentionPolicy.create({
      data: {
        version: 'synthetic-incomplete',
        approvalReference: 'SYNTHETIC_REHEARSAL',
        configuration: { sharedRecoverySeconds: 2592000 },
      },
    });
    await expect(
      kernel.provision(owner, randomUUID(), 'synthetic-incomplete'),
    ).rejects.toThrow();
  });
  it('requires verified current exact sessions and denies expired sessions or closed accounts', async () => {
    const b = await boundary(),
      unverified = await person(false);
    await admission(b.spaceId, unverified);
    await expect(authority(unverified, b.spaceId)).rejects.toThrow();
    await expect(
      authority({ ...owner, sessionId: member.sessionId! }, b.spaceId),
    ).rejects.toThrow();
    const expired = await person();
    await admission(b.spaceId, expired);
    await client.authSession.update({
      where: { id: expired.sessionId },
      data: { expiresAt: new Date(0) },
    });
    await expect(authority(expired, b.spaceId)).rejects.toThrow();
  });
  it('derives Owner, separates contexts, denies Viewer mutation, outsiders and grant-only admission', async () => {
    const b = await boundary();
    await admission(b.spaceId, member);
    await admission(b.spaceId, viewer, 'VIEWER');
    await admission(b.spaceId, outsider, null);
    expect((await authority(owner, b.spaceId, 'policy.publish')).role).toBe(
      'OWNER',
    );
    expect((await authority(viewer, b.spaceId, 'task.read')).role).toBe(
      'VIEWER',
    );
    await expect(authority(viewer, b.spaceId)).rejects.toThrow();
    await expect(authority(outsider, b.spaceId, 'task.read')).rejects.toThrow();
    const other = await boundary(member);
    expect(
      (await authority(member, other.spaceId, 'membership.admin')).role,
    ).toBe('OWNER');
    await expect(
      authority(member, b.spaceId, 'membership.admin'),
    ).rejects.toThrow();
    await expect(
      kernel.run(
        owner,
        { userIds: [], spaceIds: [b.spaceId] },
        [{ ...req(b.spaceId), scopeId: other.spaceId }],
        async () => true,
      ),
    ).rejects.toThrow();
  });
  it('retains Personal shape, exclusive custody, foreign-key isolation and immutable ownership', async () => {
    const b = await boundary(),
      other = await boundary();
    await expect(
      client.$transaction((tx) =>
        tx.space.create({ data: { kind: 'PERSONAL', ownerUserId: null } }),
      ),
    ).rejects.toThrow();
    await expect(
      client.$transaction((tx) =>
        tx.space.create({ data: { kind: 'SHARED', ownerUserId: null } }),
      ),
    ).rejects.toThrow();
    await expect(
      client.$transaction((tx) =>
        tx.space.update({
          where: { id: b.spaceId },
          data: { ownerUserId: owner.userId },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      client.$transaction((tx) =>
        tx.sharedCustody.delete({ where: { spaceId: b.spaceId } }),
      ),
    ).rejects.toThrow();
    await expect(
      client.$transaction((tx) =>
        tx.sharedCustody.update({
          where: { spaceId: b.spaceId },
          data: { primaryOwnerAccessId: other.accessId },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      client.$transaction((tx) =>
        tx.sharedActor.create({
          data: {
            id: randomUUID(),
            spaceId: b.spaceId,
            userId: owner.userId,
            state: 'ACTIVE',
          },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      client.$transaction((tx) =>
        tx.user.delete({ where: { id: owner.userId } }),
      ),
    ).rejects.toThrow();
    await expect(
      client.$transaction((tx) =>
        tx.task.create({
          data: {
            spaceId: b.spaceId,
            createdByUserId: owner.userId,
            title: 'must remain Personal',
          },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      client.$transaction((tx) =>
        tx.sharedCustody.update({
          where: { spaceId: b.spaceId },
          data: { state: 'CLOSING_GRACE' },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      client.$transaction((tx) =>
        tx.contextAccess.update({
          where: { id: b.accessId },
          data: { state: 'SUSPENDED' },
        }),
      ),
    ).rejects.toThrow();
    expect((await spaces.personalFor(owner.userId)).kind).toBe('PERSONAL');
    expect(
      await spaces.background(client, b.spaceId, randomUUID(), randomUUID()),
    ).toBeNull();
  });
  it('preserves immutable intervals and requires incremented generation on explicit readmission', async () => {
    const b = await boundary(),
      m = await admission(b.spaceId, member);
    await kernel.changeAccess(owner, {
      ...req(b.spaceId),
      accessId: m.accessId,
      revision: 1,
      state: 'REVOKED',
      memberRole: 'MEMBER',
    });
    const ended = await client.contextAccess.findUniqueOrThrow({
      where: { id: m.accessId },
    });
    await expect(
      client.$transaction((tx) =>
        tx.contextAccess.update({
          where: { id: m.accessId },
          data: { state: 'ACTIVE', endedAt: null },
        }),
      ),
    ).rejects.toThrow();
    await client.$transaction(async (tx) => {
      const now = (
        await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
      )[0]!.now;
      await tx.contextAccess.update({
        where: { id: m.accessId },
        data: {
          state: 'ACTIVE',
          generation: 2,
          joinedAt: now,
          endedAt: null,
          revision: { increment: 1 },
        },
      });
      await tx.contextAccessInterval.create({
        data: { accessId: m.accessId, generation: 2, joinedAt: now },
      });
    });
    expect(
      await client.contextAccessInterval.count({
        where: { accessId: m.accessId },
      }),
    ).toBe(2);
    expect(ended.endedAt).not.toBeNull();
    await expect(
      client.$transaction((tx) =>
        tx.contextAccessInterval.update({
          where: {
            accessId_generation: { accessId: m.accessId, generation: 1 },
          },
          data: { endedAt: new Date() },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      client.$transaction((tx) =>
        tx.contextAccessInterval.delete({
          where: {
            accessId_generation: { accessId: m.accessId, generation: 1 },
          },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      kernel.run(
        member,
        { userIds: [], spaceIds: [b.spaceId] },
        [{ ...req(b.spaceId), generation: 1 }],
        async () => true,
      ),
    ).rejects.toThrow();
  });
  it('enforces role ceilings, higher-role administration and current policy revisions', async () => {
    const b = await boundary(),
      m = await admission(b.spaceId, member, 'MANAGER');
    await expect(
      kernel.changeAccess(member, {
        ...req(b.spaceId),
        accessId: m.accessId,
        revision: 1,
        state: 'ACTIVE',
        memberRole: 'ADMIN',
      }),
    ).rejects.toThrow();
    await expect(
      kernel.publishPolicy(owner, {
        ...req(b.spaceId),
        expectedVersion: 1,
        roleDefaults: { ...defaultPolicy, VIEWER: ['task.update'] },
        exportMaxRecords: 10000,
        exportMaxBytes: 10485760,
      }),
    ).rejects.toThrow();
    await expect(
      kernel.publishPolicy(owner, {
        ...req(b.spaceId),
        expectedVersion: 1,
        roleDefaults: defaultPolicy,
        exportMaxRecords: 10001,
        exportMaxBytes: 10485760,
      }),
    ).rejects.toThrow();
    await expect(
      kernel.publishPolicy(owner, {
        ...req(b.spaceId),
        expectedVersion: 1,
        roleDefaults: defaultPolicy,
        exportMaxRecords: 10000,
        exportMaxBytes: 10485761,
      }),
    ).rejects.toThrow();
    await kernel.publishPolicy(owner, {
      ...req(b.spaceId),
      expectedVersion: 1,
      roleDefaults: { ...defaultPolicy, MANAGER: ['task.read'] },
      exportMaxRecords: 10,
      exportMaxBytes: 1024,
    });
    await expect(authority(member, b.spaceId)).rejects.toThrow();
    await expect(
      kernel.publishPolicy(owner, {
        ...req(b.spaceId),
        expectedVersion: 1,
        roleDefaults: defaultPolicy,
        exportMaxRecords: 10,
        exportMaxBytes: 1024,
      }),
    ).rejects.toThrow();
    expect(
      await client.contextCapabilityPolicy.count({
        where: { spaceId: b.spaceId },
      }),
    ).toBe(2);
  });
  it('rejects every unchecked grant target and grant-only hard-deny bypass', async () => {
    const b = await boundary(),
      m = await admission(b.spaceId, member);
    expect(() => kernel.issueGrant()).toThrow();
    await expect(
      client.resourceGrant.create({
        data: {
          id: randomUUID(),
          spaceId: b.spaceId,
          scopeId: b.spaceId,
          granteeAccessId: m.accessId,
          granteeGeneration: 1,
          issuerAccessId: b.accessId,
          issuerGeneration: 1,
          capabilities: ['read'],
          expiresAt: new Date(Date.now() + 10000),
        },
      }),
    ).rejects.toThrow();
    await kernel.changeAccess(owner, {
      ...req(b.spaceId),
      accessId: m.accessId,
      revision: 1,
      state: 'SUSPENDED',
      memberRole: 'MEMBER',
    });
    await expect(authority(member, b.spaceId)).rejects.toThrow();
  });
  it('reauthorizes receipt replay, detects fingerprints, and atomically rolls back effects', async () => {
    const b = await boundary(),
      m = await admission(b.spaceId, member),
      key = randomUUID();
    const result = await mutation(member, b.spaceId, key);
    expect(await mutation(member, b.spaceId, key)).toEqual(result);
    expect(
      await client.sharedAuditEvent.count({
        where: { spaceId: b.spaceId, action: 'kernel.test' },
      }),
    ).toBe(1);
    await expect(
      kernel.run(
        member,
        { userIds: [], spaceIds: [b.spaceId] },
        [req(b.spaceId)],
        async (tx, a) =>
          kernel.receipt(
            tx,
            a,
            req(b.spaceId),
            { operation: 'kernel.test', key, fingerprint: 'a'.repeat(64) },
            async () => ({ id: randomUUID(), statusCode: 200 }),
          ),
      ),
    ).rejects.toThrow();
    await kernel.changeAccess(owner, {
      ...req(b.spaceId),
      accessId: m.accessId,
      revision: 1,
      state: 'REVOKED',
      memberRole: 'MEMBER',
    });
    await expect(mutation(member, b.spaceId, key)).rejects.toThrow();
    const before = await client.sharedAuditEvent.count({
      where: { spaceId: b.spaceId },
    });
    await expect(
      kernel.run(
        owner,
        { userIds: [], spaceIds: [b.spaceId] },
        [req(b.spaceId)],
        async (tx, a) =>
          kernel.receipt(
            tx,
            a,
            req(b.spaceId),
            {
              operation: 'kernel.rollback',
              key: 'rollback',
              fingerprint: 'a'.repeat(64),
            },
            async () => {
              await tx.sharedAuditEvent.create({
                data: {
                  id: randomUUID(),
                  spaceId: b.spaceId,
                  actorId: b.actorId,
                  action: 'rollback',
                  requestId: owner.requestId,
                },
              });
              throw new Error('rollback fixture');
            },
          ),
      ),
    ).rejects.toThrow();
    expect(
      await client.sharedAuditEvent.count({ where: { spaceId: b.spaceId } }),
    ).toBe(before);
    expect(
      await client.sharedMutationReceipt.count({
        where: { spaceId: b.spaceId, operation: 'kernel.rollback' },
      }),
    ).toBe(0);
  });
  it('RACE: winning revocation denies an older pending command without source/audit/outbox/receipt effects', async () => {
    const b = await boundary(),
      m = await admission(b.spaceId, member),
      entered = barrier(),
      release = barrier();
    const append = control.append.bind(control);
    const spy = vi
      .spyOn(control, 'append')
      .mockImplementation(async (record) => {
        await append(record);
        if (
          record.spaceId === b.spaceId &&
          record.action === 'membership.change' &&
          record.outcome === 'INTENT'
        ) {
          entered.release();
          await release.promise;
        }
      });
    const revoke = outcome(
      kernel.changeAccess(owner, {
        ...req(b.spaceId),
        accessId: m.accessId,
        revision: 1,
        state: 'REVOKED',
        memberRole: 'MEMBER',
      }),
    );
    await entered.promise;
    const write = outcome(mutation(member, b.spaceId));
    try {
      await blocked();
    } finally {
      release.release();
    }
    expect((await revoke).error).toBeUndefined();
    expect((await write).error).toBeDefined();
    spy.mockRestore();
    expect(
      await client.sharedAuditEvent.count({
        where: { spaceId: b.spaceId, action: 'kernel.test' },
      }),
    ).toBe(0);
    expect(
      await client.sharedOutboxEvent.count({
        where: { spaceId: b.spaceId, action: 'kernel.test' },
      }),
    ).toBe(0);
    expect(
      await client.sharedMutationReceipt.count({
        where: { spaceId: b.spaceId },
      }),
    ).toBe(0);
  });
  it('RACE: mutation-first commits all effects before the waiting revocation', async () => {
    const b = await boundary(),
      m = await admission(b.spaceId, member),
      entered = barrier(),
      release = barrier();
    const write = outcome(
      mutation(member, b.spaceId, randomUUID(), async () => {
        entered.release();
        await release.promise;
      }),
    );
    await entered.promise;
    const revoke = outcome(
      kernel.changeAccess(owner, {
        ...req(b.spaceId),
        accessId: m.accessId,
        revision: 1,
        state: 'REVOKED',
        memberRole: 'MEMBER',
      }),
    );
    try {
      await blocked();
    } finally {
      release.release();
    }
    expect((await write).error).toBeUndefined();
    expect((await revoke).error).toBeUndefined();
    expect(
      await client.sharedMutationReceipt.count({
        where: { spaceId: b.spaceId },
      }),
    ).toBe(1);
    expect(
      await client.sharedAuditEvent.count({
        where: { spaceId: b.spaceId, action: 'kernel.test' },
      }),
    ).toBe(1);
    expect(
      await client.sharedOutboxEvent.count({
        where: { spaceId: b.spaceId, action: 'kernel.test' },
      }),
    ).toBe(1);
    await expect(authority(member, b.spaceId)).rejects.toThrow();
  });
  it('RACE: current-policy removal invalidates queued writes and receipt replays', async () => {
    const b = await boundary();
    await admission(b.spaceId, member);
    const key = randomUUID();
    await mutation(member, b.spaceId, key);
    const entered = barrier(),
      release = barrier(),
      append = control.append.bind(control);
    const spy = vi.spyOn(control, 'append').mockImplementation(async (r) => {
      await append(r);
      if (
        r.spaceId === b.spaceId &&
        r.action === 'policy.publish' &&
        r.outcome === 'INTENT'
      ) {
        entered.release();
        await release.promise;
      }
    });
    const publish = outcome(
      kernel.publishPolicy(owner, {
        ...req(b.spaceId),
        expectedVersion: 1,
        roleDefaults: { ...defaultPolicy, MEMBER: ['task.read'] },
        exportMaxRecords: 10,
        exportMaxBytes: 1024,
      }),
    );
    await entered.promise;
    const replay = outcome(mutation(member, b.spaceId, key));
    try {
      await blocked();
    } finally {
      release.release();
    }
    expect((await publish).error).toBeUndefined();
    expect((await replay).error).toBeDefined();
    spy.mockRestore();
    expect(
      await client.sharedMutationReceipt.count({
        where: { spaceId: b.spaceId },
      }),
    ).toBe(1);
  });
  it('RACE: exclusive custody row locks block commands independently of account locks', async () => {
    const b = await boundary();
    await observer.query('BEGIN');
    await observer.query(
      'SELECT "spaceId" FROM "SharedCustody" WHERE "spaceId"=$1 FOR UPDATE',
      [b.spaceId],
    );
    const pending = outcome(authority(owner, b.spaceId));
    try {
      await blocked();
    } finally {
      await observer.query('ROLLBACK');
    }
    expect((await pending).error).toBeUndefined();
  });
  it('RACE: acting-account and owner-account closure fence both winning orders; convergence precedes erasure', async () => {
    const closingOwner = await person(),
      other = await person(),
      b = await boundary(closingOwner);
    await admission(b.spaceId, other);
    const entered = barrier(),
      release = barrier();
    const write = outcome(
      mutation(other, b.spaceId, randomUUID(), async () => {
        entered.release();
        await release.promise;
      }),
    );
    await entered.promise;
    const personal = await spaces.authorizePersonal(closingOwner);
    const close = outcome(
      client.$transaction(async (tx) => spaces.setClosed(tx, personal, true)),
    );
    try {
      await blocked();
    } finally {
      release.release();
    }
    expect((await write).error).toBeUndefined();
    expect((await close).error).toBeUndefined();
    await expect(authority(closingOwner, b.spaceId)).rejects.toThrow();
    await expect(authority(other, b.spaceId)).rejects.toThrow();
    expect(
      await client.sharedExitWork.count({
        where: { userId: closingOwner.userId },
      }),
    ).toBe(1);
    await kernel.consumeExit();
    expect(
      (
        await client.sharedCustody.findUniqueOrThrow({
          where: { spaceId: b.spaceId },
        })
      ).state,
    ).toBe('OWNER_EXIT_FROZEN');
    expect(
      await kernel.prepareIdentityErasure(closingOwner.userId, new Date()),
    ).toBe(false);
    expect(
      await kernel.prepareIdentityErasure(closingOwner.userId, new Date()),
    ).toBe(true);
    await client.$transaction((tx) => spaces.erase(tx, personal));
    await client.user.delete({ where: { id: closingOwner.userId } });
    expect(
      await client.sharedExitWork.count({
        where: { userId: closingOwner.userId },
      }),
    ).toBe(0);
    expect(
      (await client.sharedActor.findUniqueOrThrow({ where: { id: b.actorId } }))
        .userId,
    ).toBeNull();
    expect(
      await client.sharedAuditEvent.count({ where: { spaceId: b.spaceId } }),
    ).toBeGreaterThan(0);
    expect(
      await client.sharedActor.count({
        where: { spaceId: b.spaceId, userId: other.userId },
      }),
    ).toBe(1);
  });
  it('last full-member departure excludes guests, records one 30-day job and never purges synchronously', async () => {
    const sole = await person(),
      guest = await person(),
      b = await boundary(sole);
    await admission(b.spaceId, guest, null);
    expect(
      await client.sharedUsageEntry.count({
        where: { spaceId: b.spaceId, feature: 'shared.custody', delta: 1 },
      }),
    ).toBe(1);
    expect(
      (
        await client.sharedUsageEntry.aggregate({
          where: { spaceId: b.spaceId, feature: 'shared.membership' },
          _sum: { delta: true },
        })
      )._sum.delta,
    ).toBe(1);
    await kernel.depart(sole, { ...req(b.spaceId), revision: 1 });
    expect(
      (
        await client.sharedUsageEntry.aggregate({
          where: { spaceId: b.spaceId, feature: 'shared.membership' },
          _sum: { delta: true },
        })
      )._sum.delta,
    ).toBe(0);
    const custody = await client.sharedCustody.findUniqueOrThrow({
        where: { spaceId: b.spaceId },
      }),
      job = await client.sharedLifecycleJob.findFirstOrThrow({
        where: { spaceId: b.spaceId },
      });
    expect(custody.state).toBe('CLOSING_GRACE');
    expect(
      job.recoveryDeadline.getTime() - job.effectiveDepartureAt.getTime(),
    ).toBe(2592000000);
    await expect(authority(sole, b.spaceId)).rejects.toThrow();
    expect(await client.space.count({ where: { id: b.spaceId } })).toBe(1);
    expect(
      await client.sharedLifecycleJob.count({ where: { spaceId: b.spaceId } }),
    ).toBe(1);
  });
  it('RACE: sorted multi-boundary/account lock sets avoid opposing-order deadlock', async () => {
    const a = await boundary(),
      b = await boundary(member);
    await admission(a.spaceId, member);
    await admission(b.spaceId, owner);
    const entered = barrier(),
      release = barrier();
    const first = outcome(
      kernel.run(
        owner,
        { userIds: [member.userId], spaceIds: [a.spaceId, b.spaceId] },
        [req(a.spaceId), req(b.spaceId)],
        async () => {
          entered.release();
          await release.promise;
          return 'first';
        },
      ),
    );
    await entered.promise;
    const second = outcome(
      kernel.run(
        member,
        { userIds: [owner.userId], spaceIds: [b.spaceId, a.spaceId] },
        [req(b.spaceId), req(a.spaceId)],
        async () => 'second',
      ),
    );
    try {
      await blocked();
    } finally {
      release.release();
    }
    expect((await first).value).toBe('first');
    expect((await second).value).toBe('second');
  });
  it('retries only recognized rollback errors, at most three times, preserving one effect', async () => {
    const b = await boundary();
    let attempts = 0;
    const result = await kernel.run(
      owner,
      { userIds: [], spaceIds: [b.spaceId] },
      [req(b.spaceId)],
      async (tx) => {
        attempts++;
        if (attempts < 3)
          await tx.$executeRawUnsafe(
            `DO $$ BEGIN RAISE EXCEPTION 'retry fixture' USING ERRCODE='40001'; END $$`,
          );
        return 'committed';
      },
    );
    expect(result).toBe('committed');
    expect(attempts).toBe(3);
    let ordinary = 0;
    await expect(
      kernel.run(
        owner,
        { userIds: [], spaceIds: [b.spaceId] },
        [req(b.spaceId)],
        async () => {
          ordinary++;
          throw new Error('not retryable');
        },
      ),
    ).rejects.toThrow();
    expect(ordinary).toBe(1);
  });
  it('RACE: connection loss rolls back effects and releases locks', async () => {
    const b = await boundary(),
      entered = barrier(),
      release = barrier();
    let pid = 0;
    const write = outcome(
      kernel.run(
        owner,
        { userIds: [], spaceIds: [b.spaceId] },
        [req(b.spaceId)],
        async (tx) => {
          pid = (
            await tx.$queryRaw<
              { pid: number }[]
            >`SELECT pg_backend_pid() AS pid`
          )[0]!.pid;
          await tx.sharedAuditEvent.create({
            data: {
              id: randomUUID(),
              spaceId: b.spaceId,
              actorId: b.actorId,
              action: 'connection.loss',
              requestId: owner.requestId,
            },
          });
          entered.release();
          await release.promise;
          await tx.$queryRaw`SELECT 1`;
        },
      ),
    );
    await entered.promise;
    await observer.query('SELECT pg_terminate_backend($1)', [pid]);
    release.release();
    expect((await write).error).toBeDefined();
    expect(
      await client.sharedAuditEvent.count({
        where: { spaceId: b.spaceId, action: 'connection.loss' },
      }),
    ).toBe(0);
    expect((await authority(owner, b.spaceId)).spaceId).toBe(b.spaceId);
  });
  it('quarantines stale restores and unresolved intents; reconciles aborted intent against DB under custody lock', async () => {
    const b = await boundary();
    const intent = {
      id: randomUUID(),
      spaceId: b.spaceId,
      version: '2',
      action: 'membership.change',
      resourceId: b.accessId,
      outcome: 'INTENT' as const,
      at: new Date().toISOString(),
    };
    await control.append(intent);
    await expect(authority(owner, b.spaceId)).rejects.toThrow();
    await kernel.reconcileControl(b.spaceId);
    expect((await authority(owner, b.spaceId)).role).toBe('OWNER');
    const committed = {
      ...intent,
      id: randomUUID(),
      outcome: 'COMMITTED' as const,
    };
    await control.append(committed);
    await expect(authority(owner, b.spaceId)).rejects.toThrow();
  });
  it('RACE: closure-first rejects a waiting member mutation after the owner closure commits', async () => {
    const closingOwner = await person(),
      other = await person(),
      b = await boundary(closingOwner);
    await admission(b.spaceId, other);
    const entered = barrier(),
      release = barrier(),
      personal = await spaces.authorizePersonal(closingOwner);
    const close = outcome(
      client.$transaction(async (tx) => {
        await spaces.setClosed(tx, personal, true);
        entered.release();
        await release.promise;
      }),
    );
    await entered.promise;
    const write = outcome(mutation(other, b.spaceId));
    try {
      await blocked();
    } finally {
      release.release();
    }
    expect((await close).error).toBeUndefined();
    expect((await write).error).toBeDefined();
    await expect(authority(outsider, b.spaceId)).rejects.toHaveProperty(
      'status',
      404,
    );
    expect(
      await client.sharedMutationReceipt.count({
        where: { spaceId: b.spaceId },
      }),
    ).toBe(0);
    while (await kernel.consumeExit()) {
      /* Bounded durable fixture fanout. */
    }
  });
  it('RACE: a committed custodian-seat change removes old ownership before a competing seat change', async () => {
    const b = await boundary(),
      m = await admission(b.spaceId, member),
      v = await admission(b.spaceId, viewer, 'VIEWER');
    const entered = barrier(),
      release = barrier();
    const seat = async (target: string) =>
      kernel.run(
        owner,
        { userIds: [member.userId, viewer.userId], spaceIds: [b.spaceId] },
        [req(b.spaceId, 'custody.handover')],
        async (tx) => {
          const record = {
            id: randomUUID(),
            spaceId: b.spaceId,
            version: '2',
            action: 'custody.handover',
            resourceId: target,
            outcome: 'INTENT' as const,
            at: new Date().toISOString(),
          };
          await control.append(record);
          await tx.sharedCustody.update({
            where: { spaceId: b.spaceId },
            data: {
              primaryOwnerAccessId: target,
              authorizationVersion: { increment: 1 },
              revision: { increment: 1 },
            },
          });
          await tx.sharedAuditEvent.create({
            data: {
              id: record.id,
              spaceId: b.spaceId,
              actorId: b.actorId,
              action: record.action,
              resourceId: target,
              requestId: owner.requestId,
            },
          });
          await tx.sharedOutboxEvent.create({
            data: {
              id: randomUUID(),
              spaceId: b.spaceId,
              actorId: b.actorId,
              auditId: record.id,
              action: record.action,
              authorizationVersion: 2n,
            },
          });
          entered.release();
          await release.promise;
          return record;
        },
      );
    const first = outcome(seat(m.accessId));
    await entered.promise;
    const second = outcome(seat(v.accessId));
    try {
      await blocked();
    } finally {
      release.release();
    }
    const winner = await first;
    expect(winner.error).toBeUndefined();
    await control.append({
      ...winner.value!,
      outcome: 'COMMITTED',
      at: new Date().toISOString(),
    });
    expect((await second).error).toBeDefined();
    expect((await authority(member, b.spaceId, 'custody.handover')).role).toBe(
      'OWNER',
    );
    expect(
      (
        await client.sharedCustody.findUniqueOrThrow({
          where: { spaceId: b.spaceId },
        })
      ).primaryOwnerAccessId,
    ).toBe(m.accessId);
  });
  it('concurrent account departures converge to one job at the effective last departure; suspended members count', async () => {
    const a = await person(),
      c = await person(),
      b = await boundary(a),
      m = await admission(b.spaceId, c);
    await kernel.changeAccess(a, {
      ...req(b.spaceId),
      accessId: m.accessId,
      revision: 1,
      state: 'SUSPENDED',
      memberRole: 'MEMBER',
    });
    await expect(
      kernel.depart(a, { ...req(b.spaceId), revision: 1 }),
    ).rejects.toThrow();
    const pa = await spaces.authorizePersonal(a),
      pc = await spaces.authorizePersonal(c);
    await Promise.all([
      client.$transaction((tx) => spaces.setClosed(tx, pa, true)),
      client.$transaction((tx) => spaces.setClosed(tx, pc, true)),
    ]);
    const work = await client.sharedExitWork.findMany({
      where: { userId: { in: [a.userId, c.userId] } },
    });
    while (await kernel.consumeExit()) {
      /* Bounded durable fixture fanout. */
    }
    const jobs = await client.sharedLifecycleJob.findMany({
      where: { spaceId: b.spaceId },
    });
    expect(jobs.length).toBe(1);
    expect(jobs[0]!.state).toBe('CLOSING_GRACE');
    expect(jobs[0]!.effectiveDepartureAt.getTime()).toBe(
      Math.max(...work.map((w) => w.closedAt.getTime())),
    );
  });
  it('leaves a redacted operator-visible failure after five exit attempts, with access denied', async () => {
    const a = await person(),
      b = await boundary(a),
      personal = await spaces.authorizePersonal(a);
    await client.$transaction((tx) => spaces.setClosed(tx, personal, true));
    const spy = vi
      .spyOn(control, 'append')
      .mockRejectedValue(new Error('synthetic unavailable control'));
    for (let i = 0; i < 5; i++) {
      await client.$executeRaw`UPDATE "SharedExitWork" SET "nextAt"=clock_timestamp()-interval '1 second' WHERE "userId"=${a.userId}::uuid`;
      expect(await kernel.consumeExit()).toBe(true);
    }
    spy.mockRestore();
    const work = await client.sharedExitWork.findUniqueOrThrow({
      where: { userId: a.userId },
    });
    expect(work.attempts).toBe(5);
    expect(work.failureCode).toBe('SHARED_EXIT_REQUIRES_REVIEW');
    expect(await kernel.consumeExit()).toBe(false);
    await expect(authority(a, b.spaceId)).rejects.toThrow();
  });
  it('expires transaction authority after callback exit and rejects storage nested under planner files', async () => {
    const b = await boundary();
    const authority = await kernel.run(
      owner,
      { userIds: [], spaceIds: [b.spaceId] },
      [req(b.spaceId)],
      async (tx, a) => ({ tx, a }),
    );
    expect(() =>
      authority.a.require(authority.tx, b.spaceId, 'task.update'),
    ).toThrow();
    expect(
      () =>
        new SharedControl({
          ...config,
          SHARED_CONTROL_ROOT: path.join(
            config.STORAGE_ROOT,
            '..hidden-control',
          ),
        }),
    ).toThrow();
  });
  it('retains old signing keys during rotation and rejects unknown key IDs', async () => {
    const rotated = new SharedControl({
      ...config,
      SHARED_CONTROL_KEYS: JSON.stringify({
        k1: 'synthetic-purpose-separated-control-key-0001',
        k2: 'synthetic-purpose-separated-control-key-0002',
      }),
      SHARED_CONTROL_ACTIVE_KEY_ID: 'k2',
    });
    const b = await boundary();
    await rotated.append({
      id: randomUUID(),
      spaceId: b.spaceId,
      version: '1',
      action: 'key.rotation',
      resourceId: null,
      outcome: 'COMMITTED',
      at: new Date().toISOString(),
    });
    expect((await rotated.records()).length).toBeGreaterThan(0);
    const retired = new SharedControl({
      ...config,
      SHARED_CONTROL_KEYS: JSON.stringify({
        k2: 'synthetic-purpose-separated-control-key-0002',
      }),
      SHARED_CONTROL_ACTIVE_KEY_ID: 'k2',
    });
    await expect(retired.records()).rejects.toThrow(
      'Unknown shared control key ID',
    );
  });
});
