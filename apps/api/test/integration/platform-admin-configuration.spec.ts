import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHmac } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import request from 'supertest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  ConfigurationDefinitionViewSchema,
  ConfigurationDraftViewSchema,
  ConfigurationVersionViewSchema,
  MaintenanceValueSchema,
} from '@mehran/api-contracts';
import { migrationSandbox } from '../../../../tooling/testing/migration-sandbox.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import { testApplication } from '../support/application.js';
import { DatabaseService } from '../../src/platform/database/database.service.js';
import { ConfigurationCore } from '../../src/platform/configuration/configuration-core.js';
import {
  ConfigurationRuntime,
  assertRuntimeConfiguration,
} from '../../src/platform/configuration/runtime.js';
import { ConfigurationMaintenance } from '../../src/platform/configuration/maintenance.js';
import { OperationsControl } from '../../src/platform/operations/operations-control.js';
import { SystemHealth } from '../../src/platform/operations/system-health.js';
import { SharedControl } from '../../src/platform/storage/shared-control.js';
import { installJobSchema } from '../../src/platform/jobs/schema.js';
import { SocialGroupsService } from '../../src/modules/social/public/index.js';
import { TeamsService } from '../../src/modules/teams/public/index.js';
import { CompaniesService } from '../../src/modules/companies/public/index.js';
const root = path.resolve('.tools/p6-admin-' + randomUUID()),
  jobs = 'planner_jobs_test_' + randomUUID().replaceAll('-', '');
const secret =
    'test-only-secret-for-foundation-contracts-at-least-32-characters',
  reason = 'Reviewed P6 synthetic acceptance';
type Actor = { id: string; sessionId: string; cookie: string };
let box: Awaited<ReturnType<typeof migrationSandbox>>,
  app: NestExpressApplication,
  db: DatabaseService,
  owner: Actor,
  other: Actor,
  first: Actor,
  second: Actor,
  support: Actor;
const signed = (token: string, prefix: string) =>
  prefix +
  '.session_token=' +
  encodeURIComponent(
    token + '.' + createHmac('sha256', secret).update(token).digest('base64'),
  );
async function user(): Promise<Actor> {
  const u = await db.client.user.create({
    data: {
      name: 'P6 owner',
      email: randomUUID() + '@example.test',
      emailVerified: true,
      settings: { create: {} },
    },
  });
  await db.client.space.create({ data: { ownerUserId: u.id } });
  const s = await db.client.authSession.create({
    data: {
      userId: u.id,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  return { id: u.id, sessionId: s.id, cookie: signed(s.token, 'better-auth') };
}
async function admin(role: string): Promise<Actor> {
  const u = await db.client.adminUser.create({
    data: {
      name: 'P6 operator',
      email: randomUUID() + '@example.test',
      role,
      twoFactorEnabled: true,
      mfaEnrolledAt: new Date(0),
    },
  });
  const s = await db.client.adminSession.create({
    data: {
      userId: u.id,
      token: randomUUID(),
      createdAt: new Date(Date.now() - 1000),
      mfaVerifiedAt: new Date(),
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  return { id: u.id, sessionId: s.id, cookie: signed(s.token, 'mehran-admin') };
}
const actor = (a: Actor) => ({
  userId: a.id,
  sessionId: a.sessionId,
  requestId: randomUUID(),
  correlationId: randomUUID(),
});
const get = (a: Actor, p: string) =>
  request(app.getHttpServer())
    .get('/api/v1/' + p)
    .set('Cookie', a.cookie);
const post = (a: Actor, p: string, b: object, key = randomUUID()) =>
  request(app.getHttpServer())
    .post('/api/v1/' + p)
    .set('Cookie', a.cookie)
    .set('Origin', 'http://localhost:3000')
    .set('Idempotency-Key', key)
    .send(b);
const adminPost = (p: string, b: object, key = randomUUID()) =>
  post(first, 'admin/configuration/' + p, { reason, ...b }, key);
async function definition(
  key = 'flag.' + randomUUID(),
  category = 'FLAG',
  binding: object | null = null,
) {
  return ConfigurationDefinitionViewSchema.parse(
    (await adminPost('definitions', { key, category, binding }).expect(200))
      .body,
  );
}
async function draft(d: { id: string; revision: number }, payload: object) {
  return ConfigurationDraftViewSchema.parse(
    (
      await adminPost('definitions/' + d.id + '/drafts', {
        revision: d.revision,
        payload,
      }).expect(200)
    ).body,
  );
}
async function approval(action: string, targetId: string, fingerprint: string) {
  const r = await post(first, 'admin/security/approvals', {
      action,
      targetId,
      fingerprint,
      reason,
    }).expect(200),
    id = (r.body as { id: string }).id;
  await post(second, 'admin/security/approvals/' + id + '/approve', {
    reason,
    identityVerified: true,
  }).expect(200);
  return id;
}
async function publish(
  d: { id: string; revision: number },
  payload: object,
  sensitive = false,
) {
  const dr = await draft(d, payload),
    preview = await adminPost('drafts/' + dr.id + '/preview', {}).expect(200);
  const approvalId = sensitive
    ? await approval(
        'CONFIG_PUBLICATION',
        dr.id,
        (preview.body as { impact: { fingerprint: string } }).impact
          .fingerprint,
      )
    : undefined;
  return ConfigurationVersionViewSchema.parse(
    (
      await adminPost(
        'drafts/' + dr.id + '/publish',
        approvalId ? { approvalId } : {},
      ).expect(200)
    ).body,
  );
}
async function current(id: string) {
  return ConfigurationDefinitionViewSchema.parse(
    await get(first, 'admin/configuration/definitions?limit=100').then((r) =>
      (r.body as { items: { id: string }[] }).items.find((d) => d.id === id),
    ),
  );
}
const ownSpace = async (a = owner) =>
  (
    await db.client.space.findFirstOrThrow({
      where: { ownerUserId: a.id, kind: 'PERSONAL' },
    })
  ).id;
async function evaluate(id: string, q: Record<string, string> = {}) {
  return get(first, 'admin/configuration/definitions/' + id + '/effective')
    .query(q)
    .expect(200);
}
const maintenanceValue = (
  mode = 'READ_ONLY',
  bindings: object[] = [{ module: 'tasks', operation: 'write' }],
) =>
  MaintenanceValueSchema.parse({
    mode,
    bindings,
    messages: { en: 'Maintenance in progress', fa: 'تعمیرات در حال انجام' },
    defaultLocale: 'en',
    estimatedEndAt: new Date(Date.now() - 1000).toISOString(),
    progress: 45,
    status: 'Recovering dependencies',
  });
async function maintenance(mode: string, bindings?: object[]) {
  const found = await db.client.platformConfigDefinition.findUnique({
    where: { key: 'platform.maintenance' },
  });
  const d = found ?? (await definition('platform.maintenance', 'SETTING'));
  const v = await publish(
    d!,
    { value: maintenanceValue(mode, bindings) },
    true,
  );
  return v;
}
async function reopen(versionId: string) {
  await db.client.adminOperationalHeartbeat.updateMany({
    data: { lastSeenAt: new Date() },
  });
  const p = await get(
    first,
    'admin/configuration/versions/' + versionId + '/readiness',
  ).expect(200);
  expect(p.body).toMatchObject({ ready: true });
  const approvalId = await approval(
    'MAINTENANCE_REOPEN',
    versionId,
    (p.body as { fingerprint: string }).fingerprint,
  );
  return adminPost('versions/' + versionId + '/reopen', { approvalId }).expect(
    200,
  );
}
beforeAll(async () => {
  box = await migrationSandbox(process.env);
  const r = spawnSync(
    process.execPath,
    [
      'node_modules/prisma/build/index.js',
      'migrate',
      'deploy',
      '--config',
      'prisma.config.ts',
    ],
    { env: { ...process.env, DATABASE_URL: box.url }, encoding: 'utf8' },
  );
  if (r.status !== 0) throw Error(r.stdout + r.stderr);
  await installJobSchema(isolatedTestDatabaseUrl(process.env), jobs);
  const schema = new URL(box.url).searchParams.get('schema')!,
    client = new PrismaClient({
      adapter: new PrismaPg(
        {
          connectionString: isolatedTestDatabaseUrl(process.env),
          options: '-c search_path=' + schema + ' -c timezone=UTC',
        },
        { schema },
      ),
    });
  app = await testApplication({
    databaseInstance: {
      client,
      checkConnection: async () => {
        await client.$queryRaw`SELECT 1`;
      },
      onApplicationShutdown: () => client.$disconnect(),
    } as DatabaseService,
    environment: {
      SHARED_CONTROL_ROOT: path.join(root, 'shared'),
      SHARED_CONTROL_KEYS: JSON.stringify({
        p6: Buffer.from(
          'synthetic-only-p6-control-material-at-least-48-bytes',
        ).toString('base64url'),
      }),
      SHARED_CONTROL_ACTIVE_KEY_ID: 'p6',
      SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-P6-TEST',
      OPERATIONS_CONTROL_ROOT: path.join(root, 'operations'),
      JOBS_SCHEMA: jobs,
    },
  });
  db = app.get(DatabaseService);
  await app.get(SharedControl).initialize();
  await app.get(OperationsControl).write('READY', randomUUID());
  owner = await user();
  other = await user();
  first = await admin('SUPER_ADMIN');
  second = await admin('SUPER_ADMIN');
  support = await admin('SUPPORT');
  await db.client.adminOperationalHeartbeat.create({
    data: { name: 'worker', instanceId: randomUUID() },
  });
}, 60000);
afterAll(async () => {
  await app?.close();
  if (box) {
    if (!/^planner_jobs_test_[a-f0-9]{32}$/.test(jobs))
      throw Error('Unsafe queue fixture');
    await box.query('DROP SCHEMA ' + jobs + ' CASCADE');
    await box.close();
  }
  if (root.startsWith(path.resolve('.tools') + path.sep))
    fs.rmSync(root, { recursive: true, force: true });
});

it('enforces independent Admin identity, granular role, Origin, fresh persisted MFA and strict schemas', async () => {
  await get(owner, 'admin/configuration/catalog').expect(401);
  await get(support, 'admin/configuration/catalog').expect(403);
  await request(app.getHttpServer())
    .post('/api/v1/admin/configuration/definitions')
    .set('Cookie', first.cookie)
    .set('Origin', 'https://foreign.invalid')
    .send({ key: 'flag.denied', category: 'FLAG', reason })
    .expect(403);
  await adminPost('definitions', {
    key: 'database.password',
    category: 'SETTING',
  }).expect(400);
  await adminPost('definitions', {
    key: 'flag.strict',
    category: 'FLAG',
    secret: 'forbidden',
  }).expect(400);
  await db.client.adminSession.update({
    where: { id: first.sessionId },
    data: { mfaVerifiedAt: new Date(Date.now() - 301000) },
  });
  await get(first, 'admin/configuration/catalog').expect(403);
  await db.client.adminSession.update({
    where: { id: first.sessionId },
    data: { mfaVerifiedAt: new Date() },
  });
});
it('persists draft/preview/publish and enforces runtime module flags without altering Client task responses', async () => {
  const d = await definition('flag.tasks.runtime', 'FLAG', {
      module: 'tasks',
      operation: 'write',
    }),
    v = await publish(d, { value: false });
  await post(owner, 'tasks', { title: 'Must be denied' }).expect(403);
  await get(owner, 'tasks').expect(200);
  expect(
    (await evaluate(d.id, { userId: owner.id, workspaceId: await ownSpace() }))
      .body,
  ).toMatchObject({ value: false, versionId: v.id, restrictedOnly: true });
  await publish(await current(d.id), { value: true });
  const created = await post(owner, 'tasks', {
    title: 'Allowed after publication',
  }).expect(201);
  expect(created.body).toHaveProperty('title', 'Allowed after publication');
});
it('uses user > Workspace > group > scope-type > global precedence with real membership targeting', async () => {
  const retentionVersion = 'p6-' + randomUUID();
  const rule = {
    retainAfterClosureSeconds: 0,
    audience: ['OWNER', 'ADMIN'],
    exportAuthority: ['OWNER'],
    disposalAction: 'PURGE',
  };
  await db.client.sharedRetentionPolicy.create({
    data: {
      version: retentionVersion,
      approvalReference: 'SYNTHETIC-ONLY',
      configuration: {
        policyVersion: retentionVersion,
        approvalReference: 'SYNTHETIC-ONLY',
        accountableOperator: 'fixture',
        applicableContexts: ['SOCIAL_GROUP', 'CONVERSATION'],
        marketScope: 'isolated fixture',
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
        backupPolicyReference: 'synthetic control',
      },
    },
  });
  const group = await app.get(SocialGroupsService).create(
    actor(owner),
    {
      id: randomUUID(),
      name: 'P6 cohort',
      publicSummary: 'Synthetic targeting cohort',
      discoverable: false,
      retentionPolicyVersion: retentionVersion,
    },
    randomUUID(),
  );
  const groupId =
    (group as { scopeId?: string; id: string }).scopeId ??
    (group as { id: string }).id;
  const d = await definition(),
    space = await ownSpace();
  await publish(d, {
    value: false,
    rules: [
      { target: { kind: 'GLOBAL' }, value: false },
      { target: { kind: 'SCOPE_TYPE', scopeType: 'PERSONAL' }, value: true },
      { target: { kind: 'GROUP', groupId }, value: false },
      { target: { kind: 'WORKSPACE', workspaceId: space }, value: true },
      { target: { kind: 'USER', userId: owner.id }, value: false },
    ],
  });
  expect(
    (await evaluate(d.id, { userId: owner.id, workspaceId: space })).body,
  ).toMatchObject({ source: 'USER', value: false });
  expect((await evaluate(d.id, { workspaceId: space })).body).toMatchObject({
    source: 'WORKSPACE',
    value: true,
  });
  await publish(await current(d.id), {
    value: false,
    rules: [
      { target: { kind: 'GLOBAL' }, value: false },
      { target: { kind: 'SCOPE_TYPE', scopeType: 'PERSONAL' }, value: true },
      { target: { kind: 'GROUP', groupId }, value: false },
    ],
  });
  expect((await evaluate(d.id, { userId: owner.id })).body).toMatchObject({
    source: 'GROUP',
    value: false,
  });
  expect(
    (await evaluate(d.id, { workspaceId: await ownSpace(other) })).body,
  ).toMatchObject({ source: 'SCOPE_TYPE', value: true });
  expect((await evaluate(d.id)).body).toMatchObject({
    source: 'GLOBAL',
    value: false,
  });
});
it('keeps deterministic percentage cohorts stable across versions and increasing rollout steps', async () => {
  const d = await definition(),
    start = new Date(Date.now() + 60000),
    step = new Date(+start + 60000);
  const v = await publish(d, {
    value: false,
    rules: [
      {
        target: { kind: 'USER', userId: owner.id },
        value: true,
        basisPoints: 0,
        steps: [{ at: step.toISOString(), basisPoints: 10000 }],
      },
    ],
    startsAt: start.toISOString(),
  });
  const core = app.get(ConfigurationCore);
  await db.client.$transaction((tx) => core.reconcile(tx, start));
  const before = await db.client.$transaction((tx) =>
    core.effective(
      tx,
      { ...d, binding: null, createdAt: new Date(d.createdAt) },
      { userId: owner.id, clientVersion: 1 },
      start,
    ),
  );
  const after = await db.client.$transaction((tx) =>
    core.effective(
      tx,
      { ...d, binding: null, createdAt: new Date(d.createdAt) },
      { userId: owner.id, clientVersion: 1 },
      step,
    ),
  );
  expect(before.value).toBe(false);
  expect(after.value).toBe(true);
  expect(after.bucket).toBe(before.bucket);
  expect(after.versionId).toBe(v.id);
});
it('recovers scheduled publication after restart and restores prior values at expiry without worker timing', async () => {
  const d = await definition(),
    base = await publish(d, { value: true }),
    start = new Date(Date.now() + 60000),
    end = new Date(+start + 60000);
  const v = await publish(await current(d.id), {
    value: false,
    startsAt: start.toISOString(),
    expiresAt: end.toISOString(),
  });
  const core = app.get(ConfigurationCore);
  await Promise.all([
    db.client.$transaction((tx) => core.reconcile(tx, start)),
    db.client.$transaction((tx) => core.reconcile(tx, start)),
  ]);
  const def = await db.client.platformConfigDefinition.findUniqueOrThrow({
    where: { id: d.id },
  });
  expect(
    (
      await db.client.$transaction((tx) =>
        core.effective(tx, def, { clientVersion: 1 }, start),
      )
    ).versionId,
  ).toBe(v.id);
  expect(
    (
      await db.client.$transaction((tx) =>
        core.effective(tx, def, { clientVersion: 1 }, end),
      )
    ).versionId,
  ).toBe(base.id);
  expect(
    await db.client.platformConfigEvent.count({
      where: { versionId: v.id, kind: 'ACTIVATED' },
    }),
  ).toBe(1);
});
it('rechecks scheduled initiator eligibility and retains the prior value on revocation', async () => {
  const temporary = await admin('SUPER_ADMIN'),
    d = await definition(),
    dr = await draft(d, {
      value: false,
      startsAt: new Date(Date.now() + 60000).toISOString(),
    });
  // Draft belongs to the current initiating operator; revoke that actual operator only during the sweep.
  await adminPost('drafts/' + dr.id + '/preview', {}).expect(200);
  const v = await adminPost('drafts/' + dr.id + '/publish', {}).expect(200);
  await db.client.adminUser.update({
    where: { id: first.id },
    data: { active: false },
  });
  try {
    await db.client.$transaction((tx) =>
      app.get(ConfigurationCore).reconcile(tx, new Date(Date.now() + 120000)),
    );
  } finally {
    await db.client.adminUser.update({
      where: { id: first.id },
      data: { active: true },
    });
  }
  expect(
    await db.client.platformConfigEvent.count({
      where: {
        versionId: (v.body as { id: string }).id,
        kind: 'ACTIVATION_DENIED',
      },
    }),
  ).toBe(1);
  expect(temporary.id).not.toBe(first.id);
});
it('prevents stale preview publication, concurrent double publication and idempotency key substitution', async () => {
  const key = randomUUID(),
    body = { key: 'flag.replay', category: 'FLAG' },
    one = await adminPost('definitions', body, key).expect(200),
    two = await adminPost('definitions', body, key).expect(200);
  expect(two.body).toEqual(one.body);
  await adminPost(
    'definitions',
    { ...body, key: 'flag.substitution' },
    key,
  ).expect(409);
  const d = ConfigurationDefinitionViewSchema.parse(one.body),
    dr = await draft(d, { value: false });
  await adminPost('drafts/' + dr.id + '/preview', {}).expect(200);
  const results = await Promise.all([
    adminPost('drafts/' + dr.id + '/publish', {}),
    adminPost('drafts/' + dr.id + '/publish', {}),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 403]);
  await adminPost('definitions/' + d.id + '/drafts', {
    revision: d.revision,
    payload: { value: true },
  }).expect(409);
});
it('requires a current preview, rejects nonexistent targets and unsafe typed values without persistence', async () => {
  const d = await definition(),
    dr = await draft(d, { value: false });
  await adminPost('drafts/' + dr.id + '/publish', {}).expect(409);
  await adminPost('definitions/' + d.id + '/drafts', {
    revision: 1,
    payload: { value: 'true' },
  }).expect(400);
  const foreign = await draft(d, {
    value: true,
    rules: [{ target: { kind: 'USER', userId: randomUUID() }, value: false }],
  });
  await adminPost('drafts/' + foreign.id + '/preview', {}).expect(404);
  await db.client.platformConfigDraft.update({
    where: { id: dr.id },
    data: {
      state: 'PREVIEW',
      fingerprint: 'a'.repeat(64),
      previewExpiresAt: new Date(0),
    },
  });
  await adminPost('drafts/' + dr.id + '/publish', {}).expect(409);
});
it('creates new immutable rollback versions and preserves source-version and target constraints', async () => {
  const d = await definition(),
    v1 = await publish(d, { value: false }),
    v2 = await publish(await current(d.id), { value: true });
  const rollback = ConfigurationDraftViewSchema.parse(
    (
      await adminPost('definitions/' + d.id + '/rollback', {
        revision: 3,
        versionId: v1.id,
      }).expect(200)
    ).body,
  );
  await adminPost('drafts/' + rollback.id + '/preview', {}).expect(200);
  const next = await adminPost('drafts/' + rollback.id + '/publish', {}).expect(
    200,
  );
  expect(next.body).toMatchObject({ version: 3, sourceVersionId: v1.id });
  await expect(
    db.client.platformConfigVersion.update({
      where: { id: v2.id },
      data: { reason: 'rewritten history' },
    }),
  ).rejects.toThrow();
  await expect(
    db.client.platformConfigVersion.delete({ where: { id: v1.id } }),
  ).rejects.toThrow();
  const foreign = await definition();
  await adminPost('definitions/' + foreign.id + '/rollback', {
    revision: 1,
    versionId: v1.id,
  }).expect(404);
});
it('applies emergency kills at runtime immediately and requires distinct approval to remove them', async () => {
  const d = await definition('flag.tasks.kill', 'FLAG', {
    module: 'tasks',
    operation: 'write',
  });
  await publish(d, { value: true });
  const killed = await adminPost('definitions/' + d.id + '/kill', {
    revision: 2,
    active: true,
  }).expect(200);
  await post(owner, 'tasks', { title: 'Killed' }).expect(403);
  expect((await evaluate(d.id)).body).toMatchObject({
    source: 'KILL',
    value: false,
  });
  await adminPost('definitions/' + d.id + '/kill', {
    revision: 3,
    active: false,
  }).expect(403);
  const p = await get(
      first,
      'admin/configuration/definitions/' + d.id + '/kill-release-preview',
    ).expect(200),
    a = await approval(
      'CONFIG_KILL_RELEASE',
      d.id,
      (p.body as { fingerprint: string }).fingerprint,
    );
  await adminPost('definitions/' + d.id + '/kill', {
    revision: (killed.body as { revision: number }).revision,
    active: false,
    approvalId: a,
  }).expect(200);
  await post(owner, 'tasks', { title: 'After controlled kill removal' }).expect(
    201,
  );
});
it('applies allowlisted task defaults and scoped upload limits while preserving existing files and infrastructure ceilings', async () => {
  const d = await definition('tasks.defaultPriority', 'PRODUCT');
  await publish(d, { value: 'HIGH' });
  expect(
    (await post(owner, 'tasks', { title: 'Configured default' }).expect(201))
      .body,
  ).toMatchObject({ priority: 'HIGH' });
  expect(
    (
      await post(owner, 'tasks', {
        title: 'Explicit priority',
        priority: 'LOW',
      }).expect(201)
    ).body,
  ).toMatchObject({ priority: 'LOW' });
  const u = await definition('uploads.maxBytes', 'PRODUCT');
  await publish(u, {
    value: 10485760,
    rules: [{ target: { kind: 'USER', userId: owner.id }, value: 4 }],
  });
  await post(owner, 'files/uploads', {
    filename: 'too-large.txt',
    mimeType: 'text/plain',
    expectedSize: 5,
  }).expect(413);
  const initiated = await post(other, 'files/uploads', {
    filename: 'allowed.txt',
    mimeType: 'text/plain',
    expectedSize: 5,
  }).expect(201);
  await publish(await current(u.id), {
    value: 10485760,
    rules: [
      { target: { kind: 'USER', userId: owner.id }, value: 4 },
      { target: { kind: 'USER', userId: other.id }, value: 4 },
    ],
  });
  await request(app.getHttpServer())
    .post(
      '/api/v1/files/' + (initiated.body as { id: string }).id + '/complete',
    )
    .set('Cookie', other.cookie)
    .set('Origin', 'http://localhost:3000')
    .set('Content-Type', 'application/octet-stream')
    .send(Buffer.from('hello'))
    .expect(413);
  expect(
    (
      await db.client.storedFile.findUniqueOrThrow({
        where: { id: (initiated.body as { id: string }).id },
      })
    ).status,
  ).not.toBe('READY');
  await adminPost('definitions/' + u.id + '/drafts', {
    revision: 3,
    payload: { value: 104857601 },
  }).expect(400);
});
it('evaluates Team and Company root scope-type rules through real Workspace authority without joining their members', async () => {
  const version = 'p6-shared-' + randomUUID(),
    rule = {
      retainAfterClosureSeconds: 0,
      audience: ['OWNER', 'ADMIN'],
      exportAuthority: ['OWNER'],
      disposalAction: 'PURGE',
    };
  await db.client.sharedRetentionPolicy.create({
    data: {
      version,
      approvalReference: 'SYNTHETIC-P6',
      configuration: {
        policyVersion: version,
        approvalReference: 'SYNTHETIC-P6',
        accountableOperator: 'fixture',
        applicableContexts: ['TEAM', 'COMPANY'],
        marketScope: 'isolated test',
        sharedRecoverySeconds: 604800,
        classRules: {
          workContent: rule,
          commentsHistory: rule,
          filesDerivatives: rule,
          exports: rule,
          accessAuditLifecycle: rule,
        },
        obligations: [],
        holds: [],
        backupPolicyReference: 'synthetic independent control',
      },
    },
  });
  const team = randomUUID(),
    company = randomUUID();
  await app
    .get(TeamsService)
    .create(
      actor(owner),
      { id: team, title: 'P6 targeted Team', retentionPolicyVersion: version },
      randomUUID(),
    );
  await app.get(CompaniesService).create(
    actor(owner),
    {
      id: company,
      title: 'P6 targeted Company',
      retentionPolicyVersion: version,
    },
    randomUUID(),
  );
  const department = randomUUID();
  await app
    .get(CompaniesService)
    .createContext(
      actor(owner),
      company,
      null,
      { id: department, title: 'Configuration inherits Company scope' },
      randomUUID(),
    );
  const d = await definition();
  await publish(d, {
    value: false,
    rules: [
      { target: { kind: 'SCOPE_TYPE', scopeType: 'TEAM' }, value: true },
      { target: { kind: 'SCOPE_TYPE', scopeType: 'COMPANY' }, value: false },
    ],
  });
  expect((await evaluate(d.id, { workspaceId: team })).body).toMatchObject({
    source: 'SCOPE_TYPE',
    value: true,
  });
  expect((await evaluate(d.id, { workspaceId: company })).body).toMatchObject({
    source: 'SCOPE_TYPE',
    value: false,
  });
  expect(
    (await evaluate(d.id, { workspaceId: department })).body,
  ).toMatchObject({ source: 'SCOPE_TYPE', value: false });
  await get(owner, 'platform/configuration')
    .query({ workspaceId: team })
    .expect(200);
  await get(other, 'platform/configuration')
    .query({ workspaceId: team })
    .expect(404);
  await post(owner, 'teams/' + team + '/files', {
    id: randomUUID(),
    versionId: randomUUID(),
    title: 'User-targeted shared admission',
    upload: { filename: 'limit.txt', mimeType: 'text/plain', expectedSize: 5 },
  }).expect(413);
  const bound = await definition('flag.team.target', 'FLAG', {
    module: 'teams',
    operation: 'write',
  });
  await publish(bound, {
    value: false,
    rules: [{ target: { kind: 'WORKSPACE', workspaceId: team }, value: true }],
  });
  expect(
    (
      await evaluate(bound.id, {
        workspaceId: team.toUpperCase(),
        userId: owner.id.toUpperCase(),
      })
    ).body,
  ).toMatchObject({ source: 'WORKSPACE', value: true });
  await app
    .get(ConfigurationRuntime)
    .assert(
      { module: 'teams', operation: 'write' },
      { userId: owner.id, workspaceId: team, clientVersion: 1 },
    );
  await expect(
    app
      .get(ConfigurationRuntime)
      .assert(
        { module: 'teams', operation: 'write' },
        { userId: owner.id, workspaceId: company, clientVersion: 1 },
      ),
  ).rejects.toHaveProperty('status', 403);
  await publish(await current(bound.id), { value: true });
});
it('detaches erased user targets without rewriting versions or allowing a target to become global', async () => {
  const erased = await user(),
    d = await definition(),
    v = await publish(d, {
      value: true,
      rules: [{ target: { kind: 'USER', userId: erased.id }, value: false }],
    });
  const target = await db.client.platformConfigTarget.findFirstOrThrow({
    where: { versionId: v.id },
  });
  await expect(
    db.client.platformConfigTarget.update({
      where: { id: target.id },
      data: { value: true },
    }),
  ).rejects.toThrow();
  // Exercise the real FK action inside this isolated fixture. No work content was created for this identity.
  await db.client.space.deleteMany({ where: { ownerUserId: erased.id } });
  await db.client.authSession.deleteMany({ where: { userId: erased.id } });
  await db.client.userSettings.deleteMany({ where: { userId: erased.id } });
  await db.client.user.delete({ where: { id: erased.id } });
  expect(
    (
      await db.client.platformConfigTarget.findUniqueOrThrow({
        where: { id: target.id },
      })
    ).userId,
  ).toBeNull();
  expect((await evaluate(d.id, { userId: other.id })).body).toMatchObject({
    value: true,
    source: 'GLOBAL',
  });
});
it('requires real dependency readiness for independent recovery and preserves the signed fence on failure', async () => {
  const control = app.get(OperationsControl),
    maintenance = app.get(ConfigurationMaintenance),
    run = randomUUID();
  await control.restrict(run);
  await db.client.adminOperationalHeartbeat.updateMany({
    data: { lastSeenAt: new Date(0) },
  });
  await expect(
    maintenance.recoverIndependent(run, reason),
  ).rejects.toHaveProperty('status', 409);
  expect((await control.status())?.state).toBe('MAINTENANCE');
  await db.client.adminOperationalHeartbeat.updateMany({
    data: { lastSeenAt: new Date() },
  });
  await maintenance.recoverIndependent(run, reason);
  expect((await control.status())?.state).toBe('READY');
  expect(
    await db.client.adminAuditEvent.count({
      where: { action: 'INDEPENDENT_MAINTENANCE_RECOVERED', requestId: run },
    }),
  ).toBe(1);
});
it('isolates effective inspection to a currently authorized Workspace and preserves user settings', async () => {
  await get(owner, 'platform/configuration')
    .query({ workspaceId: await ownSpace(other) })
    .expect(404);
  await get(owner, 'platform/configuration')
    .query({ userId: other.id })
    .expect(400);
  const result = await get(owner, 'platform/configuration').expect(200);
  expect((result.body as { items: unknown[] }).items.length).toBeGreaterThan(0);
  expect(JSON.stringify(result.body)).not.toContain('requesterAdminId');
});
it('uses P2 non-self approval, exact preview binding, expiry and current reviewer eligibility for sensitive settings', async () => {
  const d = await definition('platform.notifications.enabled', 'SETTING'),
    dr = await draft(d, { value: false }),
    p = await adminPost('drafts/' + dr.id + '/preview', {}).expect(200);
  await adminPost('drafts/' + dr.id + '/publish', {}).expect(403);
  const r = await post(first, 'admin/security/approvals', {
      action: 'CONFIG_PUBLICATION',
      targetId: dr.id,
      fingerprint: (p.body as { impact: { fingerprint: string } }).impact
        .fingerprint,
      reason,
    }).expect(200),
    id = (r.body as { id: string }).id;
  await post(first, 'admin/security/approvals/' + id + '/approve', {
    reason,
    identityVerified: true,
  }).expect(403);
  await post(second, 'admin/security/approvals/' + id + '/approve', {
    reason,
    identityVerified: true,
  }).expect(200);
  await post(first, 'admin/security/approvals/' + id + '/execute', {}).expect(
    409,
  );
  await db.client.adminUser.update({
    where: { id: second.id },
    data: { active: false },
  });
  await adminPost('drafts/' + dr.id + '/publish', { approvalId: id }).expect(
    403,
  );
  await db.client.adminUser.update({
    where: { id: second.id },
    data: { active: true },
  });
  await adminPost('drafts/' + dr.id + '/publish', { approvalId: id }).expect(
    200,
  );
  await expect(
    app
      .get(ConfigurationRuntime)
      .assert(
        { module: 'notifications', operation: 'write' },
        { userId: owner.id, workspaceId: await ownSpace(), clientVersion: 1 },
      ),
  ).rejects.toHaveProperty('status', 403);
  await publish(await current(d.id), { value: true }, true);
});
it('shows localized scheduled notice/countdown without denying work and reopens only with approval', async () => {
  const v = await maintenance('SCHEDULED_NOTICE');
  await post(owner, 'tasks', { title: 'Notice still permits work' }).expect(
    201,
  );
  const status = await request(app.getHttpServer())
    .get('/api/v1/platform/maintenance')
    .expect(200);
  expect(status.body).toMatchObject({
    source: 'DATABASE',
    items: expect.arrayContaining([
      expect.objectContaining({
        mode: 'SCHEDULED_NOTICE',
        overrunning: true,
        countdownSeconds: 0,
        messages: { en: 'Maintenance in progress', fa: 'تعمیرات در حال انجام' },
      }),
    ]),
  });
  await reopen(v.id);
});
it('enforces scoped read-only in actual HTTP and owner transactions after the countdown has expired', async () => {
  const v = await maintenance('READ_ONLY');
  await post(owner, 'tasks', { title: 'Read-only denied' }).expect(503);
  await get(owner, 'tasks').expect(200);
  await get(owner, 'notes').expect(200);
  await expect(
    db.client.$transaction((tx) =>
      assertRuntimeConfiguration(
        tx,
        {
          userId: owner.id,
          workspaceId: '00000000-0000-4000-8000-000000000000',
          clientVersion: 1,
        },
        { module: 'tasks', operation: 'write' },
      ),
    ),
  ).rejects.toHaveProperty('status', 503);
  await get(first, 'admin/configuration/catalog').expect(200);
  await reopen(v.id);
  await post(owner, 'tasks', { title: 'Reopened after checks' }).expect(201);
});
it('enforces full maintenance reads while preserving status and Admin control, then validates recovery before reopening', async () => {
  const v = await maintenance('FULL', [
    { module: 'tasks', operation: 'read' },
    { module: 'tasks', operation: 'write' },
  ]);
  await get(owner, 'tasks').expect(503);
  await get(owner, 'TASKS').expect(503);
  await get(first, 'admin/configuration/catalog').expect(200);
  await request(app.getHttpServer())
    .get('/api/v1/platform/maintenance')
    .expect(200);
  const p = await get(
      first,
      'admin/configuration/versions/' + v.id + '/readiness',
    ).expect(200),
    approvalId = await approval(
      'MAINTENANCE_REOPEN',
      v.id,
      (p.body as { fingerprint: string }).fingerprint,
    );
  const health = app.get(SystemHealth),
    spy = vi.spyOn(health, 'snapshot').mockResolvedValueOnce({
      status: 'DEGRADED',
      checks: [
        {
          name: 'database',
          status: 'DOWN',
          latencyMs: 0,
          code: 'DATABASE_UNAVAILABLE',
        },
      ],
      observedAt: new Date().toISOString(),
      api: {},
      workerLastSeenAt: null,
      storage: null,
    } as Awaited<ReturnType<SystemHealth['snapshot']>>);
  await adminPost('versions/' + v.id + '/reopen', { approvalId }).expect(409);
  spy.mockRestore();
  expect(
    (
      await db.client.adminSecurityApproval.findUniqueOrThrow({
        where: { id: approvalId },
      })
    ).state,
  ).toBe('APPROVED');
  await reopen(v.id);
  await get(owner, 'tasks').expect(200);
});
it('serves signed independent maintenance status during PostgreSQL failure and never trusts a corrupt control', async () => {
  const control = app.get(OperationsControl);
  await control.write(
    'MAINTENANCE',
    randomUUID(),
    maintenanceValue('READ_ONLY', []),
  );
  const spy = vi
    .spyOn(db.client, '$transaction')
    .mockRejectedValue(new Error('Synthetic PostgreSQL unavailable'));
  try {
    const status = await app.get(ConfigurationMaintenance).status();
    expect(status).toMatchObject({
      available: false,
      source: 'INDEPENDENT',
      items: [
        expect.objectContaining({ mode: 'READ_ONLY', overrunning: true }),
      ],
    });
  } finally {
    spy.mockRestore();
  }
  await control.assert({ module: 'tasks', operation: 'read' });
  await expect(
    control.assert({ module: 'tasks', operation: 'write' }),
  ).rejects.toHaveProperty('status', 503);
  await fs.promises.writeFile(path.join(root, 'operations/status.json'), '{}');
  await expect(
    control.assert({ module: 'tasks', operation: 'read' }),
  ).rejects.toHaveProperty('status', 503);
  const unavailable = vi
    .spyOn(db.client, '$transaction')
    .mockRejectedValue(new Error('Synthetic PostgreSQL unavailable'));
  try {
    const response = await request(app.getHttpServer())
      .get('/api/v1/platform/maintenance')
      .expect(503);
    expect(response.body).toMatchObject({
      source: 'UNAVAILABLE',
      available: false,
    });
  } finally {
    unavailable.mockRestore();
  }
  await control.write('READY', randomUUID());
});
it('retains real P5 entitlement checks even when configuration allows the requested operation', async () => {
  const policy = await db.client.commercePolicy.findUniqueOrThrow({
    where: { id: 'GLOBAL' },
  });
  await db.client.commerceFeature.create({
    data: {
      key: 'p6.personal.entitlement',
      name: 'Synthetic personal write',
      kind: 'BOOLEAN',
      binding: 'personal.write',
      enforced: true,
    },
  });
  await db.client.commercePolicy.update({
    where: { id: 'GLOBAL' },
    data: { enforcement: true },
  });
  try {
    await post(owner, 'tasks', {
      title: 'Flag cannot grant paid authority',
    }).expect(403);
  } finally {
    await db.client.commercePolicy.update({
      where: { id: 'GLOBAL' },
      data: { enforcement: policy.enforcement },
    });
  }
  await post(owner, 'tasks', {
    title: 'Existing free behavior preserved',
  }).expect(201);
});

it('shows scheduled maintenance before activation and does not release or overwrite prior fences', async () => {
  const existing = await db.client.platformConfigDefinition.findUniqueOrThrow({
      where: { key: 'platform.maintenance' },
    }),
    start = new Date(Date.now() + 60000);
  const v = await publish(
    existing,
    { value: maintenanceValue('FULL', []), startsAt: start.toISOString() },
    true,
  );
  const status = await request(app.getHttpServer())
    .get('/api/v1/platform/maintenance')
    .expect(200);
  expect((status.body as { items: unknown[] }).items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        versionId: v.id,
        active: false,
        countdownToStartSeconds: expect.any(Number),
      }),
    ]),
  );
  await post(owner, 'tasks', { title: 'Before scheduled fence' }).expect(201);
  const notBefore = new Date(+start + 60000),
    preview = await get(
      first,
      'admin/configuration/versions/' + v.id + '/readiness',
    )
      .query({ notBefore: notBefore.toISOString() })
      .expect(200),
    approvalId = await approval(
      'MAINTENANCE_REOPEN',
      v.id,
      (preview.body as { fingerprint: string }).fingerprint,
    );
  await adminPost('versions/' + v.id + '/schedule-reopen', {
    approvalId,
    notBefore: new Date(+notBefore + 1000).toISOString(),
  }).expect(403);
  await adminPost('versions/' + v.id + '/schedule-reopen', {
    approvalId,
    notBefore: notBefore.toISOString(),
  }).expect(200);
  await db.client.$transaction((tx) =>
    app.get(ConfigurationCore).reconcile(tx, start),
  );
  await db.client.adminOperationalHeartbeat.updateMany({
    data: { lastSeenAt: new Date(0) },
  });
  await app.get(ConfigurationMaintenance).consume(notBefore);
  expect(
    (
      await get(
        first,
        'admin/configuration/versions/' + v.id + '/reopen-schedule',
      ).expect(200)
    ).body,
  ).toMatchObject({ state: 'WAITING', failureCode: 'READINESS_FAILED' });
  expect(
    await db.client.platformMaintenanceRelease.count({
      where: { versionId: v.id },
    }),
  ).toBe(0);
  await db.client.adminOperationalHeartbeat.updateMany({
    data: { lastSeenAt: new Date() },
  });
  await Promise.all([
    app.get(ConfigurationMaintenance).consume(new Date(+notBefore + 60000)),
    app.get(ConfigurationMaintenance).consume(new Date(+notBefore + 60000)),
  ]);
  expect(
    (
      await get(
        first,
        'admin/configuration/versions/' + v.id + '/reopen-schedule',
      ).expect(200)
    ).body,
  ).toMatchObject({ state: 'RELEASED', failureCode: null });
  expect(
    await db.client.platformMaintenanceRelease.count({
      where: { versionId: v.id },
    }),
  ).toBe(1);
});
it('sends an approved release schedule to review after reviewer revocation and preserves manual recovery', async () => {
  const v = await maintenance('READ_ONLY'),
    notBefore = new Date(Date.now() + 60000),
    p = await get(first, 'admin/configuration/versions/' + v.id + '/readiness')
      .query({ notBefore: notBefore.toISOString() })
      .expect(200),
    approvalId = await approval(
      'MAINTENANCE_REOPEN',
      v.id,
      (p.body as { fingerprint: string }).fingerprint,
    );
  await adminPost('versions/' + v.id + '/schedule-reopen', {
    approvalId,
    notBefore: notBefore.toISOString(),
  }).expect(200);
  await db.client.adminUser.update({
    where: { id: second.id },
    data: { active: false },
  });
  try {
    await app.get(ConfigurationMaintenance).consume(notBefore);
  } finally {
    await db.client.adminUser.update({
      where: { id: second.id },
      data: { active: true },
    });
  }
  expect(
    (
      await get(
        first,
        'admin/configuration/versions/' + v.id + '/reopen-schedule',
      ).expect(200)
    ).body,
  ).toMatchObject({
    state: 'REVIEW',
    failureCode: 'OPERATOR_AUTHORITY_REVOKED',
  });
  await post(owner, 'tasks', {
    title: 'Schedule cannot bypass lost authority',
  }).expect(503);
  await reopen(v.id);
  expect((await evaluate(v.definitionId)).body).toMatchObject({
    value: false,
    source: 'DEFAULT',
    versionId: null,
  });
});
it('orders admitted transactions before committed configuration invalidation', async () => {
  let release!: () => void,
    admitted!: () => void,
    identified!: (pid: number) => void;
  const hold = new Promise<void>((resolve) => {
      release = resolve;
    }),
    ready = new Promise<void>((resolve) => {
      admitted = resolve;
    }),
    pidReady = new Promise<number>((resolve) => {
      identified = resolve;
    });
  const space = await ownSpace(),
    flight = db.client.$transaction(async (tx) => {
      await assertRuntimeConfiguration(
        tx,
        { userId: owner.id, workspaceId: space, clientVersion: 1 },
        { module: 'tasks', operation: 'write' },
      );
      admitted();
      await hold;
    });
  await ready;
  const publication = db.client.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<
      { pid: number }[]
    >`SELECT pg_backend_pid() pid`;
    identified(row!.pid);
    await app.get(ConfigurationCore).bump(tx);
  });
  try {
    const pid = await pidReady;
    let waiting = false;
    for (let n = 0; n < 100; n++) {
      const state = (
        await box.query(
          'SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',
          [pid],
        )
      ).rows[0];
      if (state?.wait_event_type === 'Lock') {
        waiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(true);
  } finally {
    release();
    await Promise.all([flight, publication]);
  }
});
