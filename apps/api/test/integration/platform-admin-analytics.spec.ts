import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHmac } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import request from 'supertest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { migrationSandbox } from '../../../../tooling/testing/migration-sandbox.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import { testApplication } from '../support/application.js';
import { DatabaseService } from '../../src/platform/database/database.service.js';

import { OperationsControl } from '../../src/platform/operations/operations-control.js';

import { SharedControl } from '../../src/platform/storage/shared-control.js';
import { installJobSchema } from '../../src/platform/jobs/schema.js';

const root = path.resolve('.tools/p7-admin-' + randomUUID()),
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
  post(first, 'admin/analytics/' + p, b, key);
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

it('isolates analytics from ordinary identities and non-permitted Admin roles', async () => {
  await get(owner, 'admin/analytics/catalog').expect(401);
  await get(support, 'admin/analytics/catalog').expect(403);
  await get(first, 'admin/analytics/catalog').expect(200);
  await adminPost('policy', {
    revision: 1,
    product: true,
    navigation: false,
    rawDays: 90,
    aggregateDays: 730,
    minimumCohort: 1,
    reason,
  }).expect(400);
});
it('captures actual committed meaningful operations once and rolls back failed capture', async () => {
  const response = await post(owner, 'tasks', {
    title: 'Synthetic P7 capture',
  }).expect(201);
  expect(response.body).toHaveProperty('id');
  expect(
    await db.client.productAnalyticsEvent.count({
      where: { userId: owner.id, name: 'task.created' },
    }),
  ).toBe(1);
  const before = await db.client.productAnalyticsEvent.count();
  await expect(
    db.client.$transaction(async (tx) => {
      await captureAnalytics(tx, {
        id: randomUUID(),
        type: 'task.completed',
        version: 1,
        userId: owner.id,
        spaceId: (
          await tx.space.findFirstOrThrow({ where: { ownerUserId: owner.id } })
        ).id,
      });
      throw Error('rollback');
    }),
  ).rejects.toThrow('rollback');
  expect(await db.client.productAnalyticsEvent.count()).toBe(before);
});
it('returns only suppressed metrics for small cohorts and never returns actor identifiers', async () => {
  const filter = {
    from: new Date(Date.now() - 3600000).toISOString(),
    to: new Date().toISOString(),
  };
  const r = await adminPost('query', { filter }).expect(200);
  expect(
    r.body.metrics.every((m: { value: unknown }) => m.value === null),
  ).toBe(true);
  expect(JSON.stringify(r.body)).not.toContain(owner.id);
  await adminPost('financial', { from: filter.from, to: filter.to })
    .expect(200)
    .expect((r) =>
      expect(r.body).toEqual({
        suppressed: true,
        report: null,
        economics: [],
        prices: [],
      }),
    );
});
it('persists definitions with strict event formulas and idempotency', async () => {
  const b = {
      name: 'Task conversion',
      kind: 'FUNNEL',
      events: ['task.created', 'task.completed'],
      formula: 'COUNT',
      windowDays: 7,
      reason,
    },
    key = randomUUID();
  const one = await adminPost('definitions', b, key).expect(200),
    two = await adminPost('definitions', b, key).expect(200);
  expect(two.body.id).toBe(one.body.id);
  await adminPost('definitions', { ...b, name: 'Changed' }, key).expect(409);
  await adminPost('definitions', { ...b, events: ['journal.body'] }).expect(
    400,
  );
});
it('applies category policy immediately, enforces revisions and disables navigation by default', async () => {
  const space = (
    await db.client.space.findFirstOrThrow({ where: { ownerUserId: owner.id } })
  ).id;
  await post(owner, 'analytics/navigation', {
    eventId: randomUUID(),
    page: 'tasks',
  }).expect(200);
  expect(
    await db.client.productAnalyticsEvent.count({
      where: { name: 'navigation.viewed' },
    }),
  ).toBe(0);
  await adminPost('policy', {
    revision: 1,
    product: false,
    navigation: true,
    rawDays: 90,
    aggregateDays: 730,
    minimumCohort: 5,
    reason,
  }).expect(200);
  await adminPost('policy', {
    revision: 1,
    product: true,
    navigation: true,
    rawDays: 90,
    aggregateDays: 730,
    minimumCohort: 5,
    reason,
  }).expect(409);
  const id = randomUUID();
  await post(owner, 'analytics/navigation', {
    eventId: id,
    page: 'tasks',
  }).expect(200);
  await post(owner, 'analytics/navigation', {
    eventId: id,
    page: 'tasks',
  }).expect(200);
  expect(await db.client.productAnalyticsEvent.count({ where: { id } })).toBe(
    1,
  );
  await post(other, 'analytics/navigation', {
    eventId: randomUUID(),
    page: 'tasks',
    workspaceId: space,
  }).expect(404);
  await post(owner, 'analytics/navigation', {
    eventId: randomUUID(),
    page: 'tasks',
    text: 'private',
  }).expect(400);
  await adminPost('policy', {
    revision: 2,
    product: true,
    navigation: false,
    rawDays: 90,
    aggregateDays: 730,
    minimumCohort: 5,
    reason,
  }).expect(200);
});
it('refreshes real aggregates and durable exports, rechecks permission and audits export access', async () => {
  const users = await Promise.all(Array.from({ length: 5 }, () => user()));
  for (const u of users) {
    const space = (
      await db.client.space.findFirstOrThrow({ where: { ownerUserId: u.id } })
    ).id;
    await db.client.productAnalyticsEvent.create({
      data: {
        id: randomUUID(),
        userId: u.id,
        spaceId: space,
        workspaceType: 'PERSONAL',
        name: 'task.created',
        version: 1,
        feature: 'tasks',
        meaningful: true,
      },
    });
  }
  await db.client.productAnalyticsPolicy.update({
    where: { id: 'GLOBAL' },
    data: {
      startedAt: new Date(Date.now() - 10 * 86400000),
      refreshedAt: null,
    },
  });
  const filter = {
    from: new Date(Date.now() - 86400000).toISOString(),
    to: new Date().toISOString(),
  };
  const q = await adminPost('query', { filter }).expect(200);
  expect(
    q.body.metrics.find((m: { key: string }) => m.key === 'dau').value,
  ).toBeGreaterThanOrEqual(5);
  const r = await adminPost('reports', {
    filter,
    format: 'JSON',
    intervalHours: 1,
    reason,
  }).expect(200);
  const worker = app.get(AnalyticsWorker);
  expect(await worker.consume()).toBe(true);
  const result = await get(
    first,
    'admin/analytics/reports/' + r.body.id,
  ).expect(200);
  expect(result.body.state).toBe('READY');
  expect(JSON.parse(result.body.content)).toHaveProperty('metrics');
  expect(await db.client.productAnalyticsAggregate.count()).toBeGreaterThan(0);
  await get(second, 'admin/analytics/reports/' + r.body.id).expect(404);
  await db.client.adminUser.update({
    where: { id: first.id },
    data: { role: 'SUPPORT' },
  });
  await db.client.productAnalyticsReport.update({
    where: { id: r.body.id },
    data: { nextAt: new Date() },
  });
  await worker.consume();
  expect(
    (
      await db.client.productAnalyticsReport.findUniqueOrThrow({
        where: { id: r.body.id },
      })
    ).state,
  ).toBe('DENIED');
  await db.client.adminUser.update({
    where: { id: first.id },
    data: { role: 'SUPER_ADMIN' },
  });
  const before = await db.client.productAnalyticsEvent.count();
  await db.client.productAnalyticsEvent.deleteMany({
    where: { userId: users[0]!.id },
  });
  expect(await db.client.productAnalyticsEvent.count()).toBeLessThan(before);
  expect(await db.client.productAnalyticsAggregate.count()).toBe(0);
  expect(
    (
      await db.client.productAnalyticsReport.findUniqueOrThrow({
        where: { id: r.body.id },
      })
    ).content,
  ).toBeNull();
});
import { captureAnalytics } from '../../src/platform/outbox/analytics-capture.js';
import { AnalyticsWorker } from '../../src/modules/admin-analytics/public/index.js';

const financePost = (p: string, b: object, key = randomUUID()) =>
  post(first, 'admin/commerce/' + p, { reason, ...b }, key);
async function customer(actor = owner) {
  const space = await db.client.space.findFirstOrThrow({
    where: { ownerUserId: actor.id, kind: 'PERSONAL' },
  });
  return (await financePost('customers', { selector: space.id }).expect(200))
    .body as { id: string; spaceId: string };
}
async function newCustomer() {
  const actor = await user();
  return { actor, customer: await customer(actor) };
}
async function offer(
  allowances: { featureId: string; value: string }[] = [],
  kind = 'PLAN',
  amount = '10000',
  currency = 'USD',
) {
  const product = (
    await financePost('products', {
      name: 'Owner configured offer ' + randomUUID(),
      kind,
      visibility: 'PUBLIC',
      pricingPage: true,
      eligibility: ['PERSONAL', 'TEAM', 'COMPANY'],
    }).expect(200)
  ).body as { id: string; revision: number };
  const version = (
    await financePost('products/' + product.id + '/publish', {
      revision: product.revision,
      propagation: 'NEW_ONLY',
      allowances,
    }).expect(200)
  ).body as { id: string };
  const price = (
    await financePost('prices', {
      versionId: version.id,
      currency,
      amount,
      termDays: 30,
      recurring: true,
      complimentary: amount === '0',
    }).expect(200)
  ).body as { id: string };
  return { productId: product.id, versionId: version.id, priceId: price.id };
}
async function grant(
  customerId: string,
  priceId: string,
  origin = 'EXTERNAL',
  startsAt = new Date().toISOString(),
) {
  return (
    await financePost('customers/' + customerId + '/subscriptions', {
      priceId,
      origin,
      startsAt,
      renewal: 'MANUAL',
    }).expect(200)
  ).body as {
    id: string;
    revision: number;
    endsAt: string;
    startsAt: string;
    state: string;
    priceId: string;
    versionId: string;
  };
}
async function method() {
  return (
    await financePost('methods', {
      name: 'Manual bank evidence',
      kind: 'TRANSFER',
      referenceNamespace: 'fixture.' + randomUUID(),
      active: true,
    }).expect(200)
  ).body as { id: string };
}
async function payment(
  customerId: string,
  methodId: string,
  amount = '10000',
  invoiceId: string | null = null,
  currency = 'USD',
  extra: object = {},
) {
  return (
    await financePost('customers/' + customerId + '/payments', {
      methodId,
      amount,
      currency,
      invoiceId,
      reference: randomUUID(),
      ...extra,
    }).expect(200)
  ).body as { id: string; state: string };
}

it('reuses exact P5 currency-separated economics and current plan segmentation with no commercial activation', async () => {
  const since = new Date(Date.now() - 60000).toISOString(),
    m = await method();
  const byCurrency = new Map<string, string>(),
    amount = '9007199254740993';
  for (const currency of ['USD', 'EUR']) {
    const o = await offer(
      [],
      currency === 'USD' ? 'PLAN' : 'ADDON',
      amount,
      currency,
    );
    byCurrency.set(currency, o.productId);
    for (let i = 0; i < 5; i++) {
      const { actor: a, customer: c } = await newCustomer(),
        sub = await grant(c.id, o.priceId);
      const p = await payment(c.id, m.id, amount, null, currency, {
        subscriptionId: sub.id,
      });
      await financePost('payments/' + p.id + '/verify', {
        approve: true,
      }).expect(200);
      await post(a, 'tasks', {
        title: 'Synthetic paid cohort activity',
      }).expect(201);
    }
  }
  const to = new Date().toISOString(),
    response = await adminPost('financial', { from: since, to }).expect(200);
  expect(response.body.suppressed).toBe(false);
  expect(response.body.report.currencies).toHaveLength(2);
  expect(response.body.prices).toHaveLength(2);
  for (const price of response.body.prices) {
    expect(price.payingCustomers).toBe(5);
    expect(price.collected).toBe((5n * BigInt(amount)).toString());
  }
  for (const row of response.body.report.currencies) {
    expect(row.payments).toBe((5n * BigInt(amount)).toString());
    expect(row.mrr).toBe((5n * BigInt(amount)).toString());
    expect(row.arr).toBe((60n * BigInt(amount)).toString());
    expect(row.byProduct[0].productId).toBe(byCurrency.get(row.currency));
  }
  const segmented = await adminPost('query', {
    filter: { from: since, to, planId: byCurrency.get('USD') },
  }).expect(200);
  expect(segmented.body.warnings).toContain('CURRENT_PLAN_MEMBERSHIP');
  expect(
    segmented.body.metrics.find((r: { key: string }) => r.key === 'dau').value,
  ).toBe(5);
});
it('uses P6 resolver cohorts with current flag and kill semantics', async () => {
  const d = await post(first, 'admin/configuration/definitions', {
    key: 'flag.analytics.' + randomUUID(),
    category: 'FLAG',
    binding: null,
    reason,
  }).expect(200);
  const draft = await post(
    first,
    'admin/configuration/definitions/' + d.body.id + '/drafts',
    {
      revision: 1,
      payload: {
        value: true,
        rules: [],
        startsAt: new Date(Date.now() - 1000).toISOString(),
        expiresAt: null,
      },
      reason,
    },
  ).expect(200);
  await post(
    first,
    'admin/configuration/drafts/' + draft.body.id + '/preview',
    { reason },
  ).expect(200);
  await post(
    first,
    'admin/configuration/drafts/' + draft.body.id + '/publish',
    { reason },
  ).expect(200);
  const filter = {
    from: new Date(Date.now() - 86400000).toISOString(),
    to: new Date().toISOString(),
    flagId: d.body.id,
    flagValue: true,
  };
  const enabled = await adminPost('query', { filter }).expect(200);
  expect(enabled.body.warnings).toContain('CURRENT_FLAG_MEMBERSHIP');
  expect(
    enabled.body.metrics.find((r: { key: string }) => r.key === 'dau').value,
  ).toBeGreaterThanOrEqual(5);
  await post(first, 'admin/configuration/definitions/' + d.body.id + '/kill', {
    revision: 2,
    active: true,
    reason,
  }).expect(200);
  const killed = await adminPost('query', { filter }).expect(200);
  expect(
    killed.body.metrics.find((r: { key: string }) => r.key === 'dau').value,
  ).toBeNull();
});
it('retains only safe historical aggregates after raw expiry and resumes CSV reports from PostgreSQL', async () => {
  const u = await user(),
    space = (
      await db.client.space.findFirstOrThrow({ where: { ownerUserId: u.id } })
    ).id,
    id = randomUUID();
  await db.client.productAnalyticsEvent.create({
    data: {
      id,
      userId: u.id,
      spaceId: space,
      workspaceType: 'PERSONAL',
      name: 'task.created',
      version: 1,
      feature: 'tasks',
      meaningful: true,
      occurredAt: new Date(Date.now() - 100 * 86400000),
    },
  });
  const oldDay = new Date(
    new Date(Date.now() - 100 * 86400000).toISOString().slice(0, 10),
  );
  await db.client.productAnalyticsAggregate.create({
    data: {
      day: oldDay,
      workspaceType: 'ALL',
      feature: 'ALL',
      users: 5,
      events: 7,
    },
  });
  await db.client.productAnalyticsPolicy.update({
    where: { id: 'GLOBAL' },
    data: { refreshedAt: null },
  });
  const filter = {
    from: new Date(Date.now() - 101 * 86400000).toISOString(),
    to: new Date(Date.now() - 99 * 86400000).toISOString(),
  };
  await app.get(AnalyticsWorker).consume();
  expect(
    await db.client.productAnalyticsEvent.findUnique({ where: { id } }),
  ).toBeNull();
  expect(
    await db.client.productAnalyticsAggregate.count({ where: { day: oldDay } }),
  ).toBe(1);
  const q = await adminPost('query', { filter }).expect(200);
  expect(q.body.warnings).toContain('RAW_COVERAGE_PARTIAL');
  expect(q.body.trends.some((r: { events: unknown }) => r.events === 7)).toBe(
    true,
  );
  const report = await adminPost('reports', {
    filter: {
      from: new Date(Date.now() - 86400000).toISOString(),
      to: new Date().toISOString(),
    },
    format: 'CSV',
    intervalHours: null,
    reason,
  }).expect(200);
  await new AnalyticsWorker(app.get(AnalyticsService)).consume();
  const output = await get(
    first,
    'admin/analytics/reports/' + report.body.id,
  ).expect(200);
  expect(output.body.state).toBe('READY');
  expect(output.body.content).toContain('section');
  await db.client.space.delete({ where: { id: space } });
  expect(await db.client.productAnalyticsAggregate.count()).toBe(0);
  expect(
    (
      await db.client.productAnalyticsReport.findUniqueOrThrow({
        where: { id: report.body.id },
      })
    ).content,
  ).toBeNull();
});
import { AnalyticsService } from '../../src/modules/admin-analytics/analytics.service.js';

const actor = (a: Actor) => ({
  userId: a.id,
  sessionId: a.sessionId,
  requestId: randomUUID(),
  correlationId: randomUUID(),
});
it('records actual Team task use and authorizes Team/Company navigation without extending membership', async () => {
  const version = 'p7-shared-' + randomUUID(),
    rule = {
      retainAfterClosureSeconds: 0,
      audience: ['OWNER', 'ADMIN'],
      exportAuthority: ['OWNER'],
      disposalAction: 'PURGE',
    };
  await db.client.sharedRetentionPolicy.create({
    data: {
      version,
      approvalReference: 'SYNTHETIC-P7',
      configuration: {
        policyVersion: version,
        approvalReference: 'SYNTHETIC-P7',
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
      { id: team, title: 'P7 targeted Team', retentionPolicyVersion: version },
      randomUUID(),
    );
  await app.get(CompaniesService).create(
    actor(owner),
    {
      id: company,
      title: 'P7 targeted Company',
      retentionPolicyVersion: version,
    },
    randomUUID(),
  );

  await app.get(TeamWorkService).createTask(
    actor(owner),
    team,
    {
      id: randomUUID(),
      title: 'Synthetic meaningful Team event',
      priority: 'NONE',
    },
    randomUUID(),
  );
  expect(
    await db.client.productAnalyticsEvent.count({
      where: {
        userId: owner.id,
        scopeId: team,
        workspaceType: 'TEAM',
        name: 'task.created',
      },
    }),
  ).toBe(1);
  const policy = (await get(first, 'admin/analytics/policy').expect(200)).body;
  await adminPost('policy', { ...policy, navigation: true, reason }).expect(
    200,
  );
  await post(owner, 'analytics/navigation', {
    eventId: randomUUID(),
    page: 'overview',
    workspaceId: company,
  }).expect(200);
  expect(
    await db.client.productAnalyticsEvent.count({
      where: { scopeId: company, workspaceType: 'COMPANY', meaningful: false },
    }),
  ).toBe(1);
  await post(other, 'analytics/navigation', {
    eventId: randomUUID(),
    page: 'overview',
    workspaceId: company,
  }).expect(404);
  const revised = (await get(first, 'admin/analytics/policy').expect(200)).body;
  await adminPost('policy', { ...revised, navigation: false, reason }).expect(
    200,
  );
});
it('serializes concurrent durable report consumers and supports explicit schedule cancellation', async () => {
  const filter = {
    from: new Date(Date.now() - 86400000).toISOString(),
    to: new Date().toISOString(),
  };
  const report = await adminPost('reports', {
    filter,
    format: 'JSON',
    intervalHours: 24,
    reason,
  }).expect(200);
  await db.client.productAnalyticsReport.updateMany({
    where: { id: { not: report.body.id } },
    data: { nextAt: null },
  });
  await Promise.all([
    new AnalyticsWorker(app.get(AnalyticsService)).consume(),
    new AnalyticsWorker(app.get(AnalyticsService)).consume(),
  ]);
  expect(
    await db.client.adminAuditEvent.count({
      where: { action: 'ANALYTICS_REPORT_READY', requestId: report.body.id },
    }),
  ).toBe(1);
  const canceled = await adminPost('reports/' + report.body.id + '/cancel', {
    reason,
  }).expect(200);
  expect(canceled.body.nextAt).toBeNull();
  expect(canceled.body.intervalHours).toBeNull();
  await get(first, 'admin/analytics/reports/' + report.body.id).expect(404);
});
it('keeps restore quarantine and current session MFA authoritative for analytics', async () => {
  const gate = app.get(AnalyticsService).privacy;
  gate.quarantine();
  try {
    await get(first, 'admin/analytics/catalog').expect(403);
    await expect(app.get(AnalyticsWorker).consume()).rejects.toThrow();
  } finally {
    gate.release();
  }
  await db.client.adminSession.update({
    where: { id: second.sessionId },
    data: { mfaVerifiedAt: new Date(Date.now() - 600000) },
  });
  await get(second, 'admin/analytics/catalog').expect(403);
  await db.client.adminSession.update({
    where: { id: second.sessionId },
    data: { mfaVerifiedAt: new Date() },
  });
});
import {
  TeamsService,
  TeamWorkService,
} from '../../src/modules/teams/public/index.js';
import { CompaniesService } from '../../src/modules/companies/public/index.js';

it('requires an actor-bound current impact preview for analytic retention changes', async () => {
  const p = (await get(first, 'admin/analytics/policy').expect(200)).body;
  const proposed = { ...p, rawDays: 60, reason };
  await adminPost('policy', proposed).expect(409);
  const preview = await adminPost('policy/preview', proposed).expect(200);
  expect(preview.body).toHaveProperty('rawEligible');
  await post(second, 'admin/analytics/policy', {
    ...proposed,
    previewId: preview.body.previewId,
  }).expect(409);
  await adminPost('policy', {
    ...proposed,
    previewId: preview.body.previewId,
  }).expect(200);
});

it('terminates invalid report requests visibly without starving other durable reports', async () => {
  await db.client.productAnalyticsReport.updateMany({ data: { nextAt: null } });
  const filter = {
    from: new Date(Date.now() - 86400000).toISOString(),
    to: new Date().toISOString(),
  };
  const bad = await adminPost('reports', {
    filter,
    format: 'JSON',
    intervalHours: null,
    reason,
  }).expect(200);
  await db.client.productAnalyticsReport.update({
    where: { id: bad.body.id },
    data: {
      filter: { ...filter, to: new Date(Date.now() + 86400000).toISOString() },
    },
  });
  await app.get(AnalyticsWorker).consume();
  expect(
    (
      await db.client.productAnalyticsReport.findUniqueOrThrow({
        where: { id: bad.body.id },
      })
    ).state,
  ).toBe('DENIED');
  expect(
    await db.client.adminAuditEvent.count({
      where: { action: 'ANALYTICS_REPORT_REJECTED', requestId: bad.body.id },
    }),
  ).toBe(1);
  const good = await adminPost('reports', {
    filter,
    format: 'JSON',
    intervalHours: null,
    reason,
  }).expect(200);
  await app.get(AnalyticsWorker).consume();
  expect(
    (
      await db.client.productAnalyticsReport.findUniqueOrThrow({
        where: { id: good.body.id },
      })
    ).state,
  ).toBe('READY');
});

it('records standalone Project activity as OTHER without assigning a false Workspace type', async () => {
  const base = await db.client.sharedRetentionPolicy.findFirstOrThrow({
      where: { version: { startsWith: 'p7-shared-' } },
    }),
    version = 'p7-project-' + randomUUID();
  const config = base.configuration as Record<string, unknown>;
  await db.client.sharedRetentionPolicy.create({
    data: {
      version,
      approvalReference: 'SYNTHETIC-P7',
      configuration: {
        ...config,
        policyVersion: version,
        applicableContexts: ['PROJECT'],
      },
    },
  });
  const project = randomUUID();
  await app.get(ProjectsService).create(
    actor(owner),
    {
      id: project,
      title: 'P7 standalone Project',
      retentionPolicyVersion: version,
    },
    randomUUID(),
  );
  await app
    .get(ProjectsService)
    .createTask(
      actor(owner),
      project,
      { id: randomUUID(), title: 'P7 Project activity', priority: 'NONE' },
      randomUUID(),
    );
  expect(
    await db.client.productAnalyticsEvent.count({
      where: {
        userId: owner.id,
        scopeId: project,
        workspaceType: 'OTHER',
        name: 'task.created',
      },
    }),
  ).toBe(1);
});
it('preserves historical aggregates on category toggles and records exact policy before/after', async () => {
  const day = new Date(
    new Date(Date.now() - 100 * 86400000).toISOString().slice(0, 10),
  );
  await db.client.productAnalyticsAggregate.upsert({
    where: {
      day_workspaceType_feature: { day, workspaceType: 'ALL', feature: 'ALL' },
    },
    create: { day, workspaceType: 'ALL', feature: 'ALL', users: 5, events: 9 },
    update: { users: 5, events: 9 },
  });
  const policy = (await get(first, 'admin/analytics/policy').expect(200)).body;
  const changed = await adminPost('policy', {
    ...policy,
    navigation: !policy.navigation,
    reason,
  }).expect(200);
  expect(
    await db.client.productAnalyticsAggregate.count({ where: { day } }),
  ).toBe(1);
  const evidence = await db.client.adminAuditEvent.findFirstOrThrow({
    where: { action: 'POST analytics/policy', outcome: 'SUCCEEDED' },
    orderBy: { createdAt: 'desc' },
  });
  expect(evidence.metadata).toMatchObject({
    before: { revision: policy.revision },
    after: { revision: changed.body.revision },
  });
});
import { ProjectsService } from '../../src/modules/projects/public/index.js';

it('compares multiple price options within the same product using the existing P5 report pass', async () => {
  const previous = await db.client.commercePrice.findFirstOrThrow({
      where: {
        currency: 'USD',
        r_versionId: { r_productId: { kind: 'PLAN' } },
      },
      include: { r_versionId: true },
    }),
    m = await method();
  const next = await financePost('prices', {
    versionId: previous.versionId,
    currency: 'USD',
    amount: '10000',
    termDays: 30,
    recurring: true,
    complimentary: false,
  }).expect(200);
  for (let i = 0; i < 5; i++) {
    const { customer: c } = await newCustomer(),
      sub = await grant(c.id, next.body.id);
    const p = await payment(c.id, m.id, '10000', null, 'USD', {
      subscriptionId: sub.id,
    });
    await financePost('payments/' + p.id + '/verify', { approve: true }).expect(
      200,
    );
  }
  const result = await adminPost('financial', {
    from: new Date(Date.now() - 3600000).toISOString(),
    to: new Date().toISOString(),
  }).expect(200);
  expect(result.body.suppressed).toBe(false);
  const prices = result.body.prices.filter(
    (p: { productId: string }) =>
      p.productId === previous.r_versionId.productId,
  );
  expect(prices).toHaveLength(2);
  expect(
    prices.find((p: { priceId: string }) => p.priceId === next.body.id),
  ).toMatchObject({ currency: 'USD', collected: '50000', payingCustomers: 5 });
  expect(
    prices.find((p: { priceId: string }) => p.priceId === previous.id)
      .collected,
  ).toBe((5n * 9007199254740993n).toString());
});

it('keeps durable system effects out of authenticated meaningful activity', async () => {
  const u = await user(),
    scope = await app.get(SpacesService).authorizePersonal({
      userId: u.id,
      requestId: randomUUID(),
      correlationId: randomUUID(),
    });
  await db.client.$transaction((tx) =>
    appendOutbox(tx, scope, {
      type: 'task.created',
      version: 1,
      aggregateId: randomUUID(),
      payload: {},
    }),
  );
  expect(
    await db.client.outboxEvent.count({
      where: { spaceId: scope.spaceId, type: 'task.created' },
    }),
  ).toBe(1);
  expect(
    await db.client.productAnalyticsEvent.count({ where: { userId: u.id } }),
  ).toBe(0);
});
import { SpacesService } from '../../src/modules/spaces/public/index.js';
import { appendOutbox } from '../../src/platform/outbox/outbox.js';

it('persists financial CSV/JSON schedules with dedicated permissions and authoritative P5 amounts', async () => {
  await db.client.productAnalyticsReport.updateMany({ data: { nextAt: null } });
  const filter = {
    from: new Date(Date.now() - 3600000).toISOString(),
    to: new Date().toISOString(),
  };
  await adminPost('reports', {
    type: 'FINANCIAL',
    filter: { ...filter, workspaceType: 'PERSONAL' },
    format: 'JSON',
    intervalHours: null,
    reason,
  }).expect(409);
  const scheduled = await adminPost('reports', {
    type: 'FINANCIAL',
    filter,
    format: 'JSON',
    intervalHours: 24,
    reason,
  }).expect(200);
  expect(scheduled.body.type).toBe('FINANCIAL');
  await app.get(AnalyticsWorker).consume();
  const jsonReport = await get(
    first,
    'admin/analytics/reports/' + scheduled.body.id,
  ).expect(200);
  expect(jsonReport.body.state).toBe('READY');
  expect(JSON.parse(jsonReport.body.content).report.currencies).toHaveLength(2);
  const csv = await adminPost('reports', {
    type: 'FINANCIAL',
    filter,
    format: 'CSV',
    intervalHours: null,
    reason,
  }).expect(200);
  await app.get(AnalyticsWorker).consume();
  const file = await get(
    first,
    'admin/analytics/reports/' + csv.body.id,
  ).expect(200);
  expect(file.body.state).toBe('READY');
  expect(file.body.content).toContain('"currency"');
  expect(file.body.content).toContain('"USD"');
  expect(file.body.content).toContain('"EUR"');
  expect(file.body.content).toContain('"prices"');
  await get(second, 'admin/analytics/reports/' + csv.body.id).expect(404);
  await post(support, 'admin/analytics/reports', {
    type: 'FINANCIAL',
    filter,
    format: 'JSON',
    intervalHours: null,
    reason,
  }).expect(403);
});

it('keeps ordinary mutations available while a consistent report snapshot is processing', async () => {
  await db.client.productAnalyticsReport.updateMany({ data: { nextAt: null } });
  await db.client.productAnalyticsPolicy.update({
    where: { id: 'GLOBAL' },
    data: { refreshedAt: new Date() },
  });
  await adminPost('reports', {
    filter: {
      from: new Date(Date.now() - 86400000).toISOString(),
      to: new Date().toISOString(),
    },
    format: 'JSON',
    intervalHours: null,
    reason,
  }).expect(200);
  const service = app.get(AnalyticsService),
    original = service.query.bind(service);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((r) => {
      entered = r;
    }),
    gate = new Promise<void>((r) => {
      release = r;
    });
  const spy = vi
    .spyOn(service, 'query')
    .mockImplementation(async (tx, filter) => {
      entered();
      await gate;
      return original(tx, filter);
    });
  const processing = app.get(AnalyticsWorker).consume();
  try {
    await started;
    await post(owner, 'tasks', {
      title: 'Real mutation during analytics report',
    })
      .timeout({ response: 2000, deadline: 3000 })
      .expect(201);
  } finally {
    release();
    await processing;
    spy.mockRestore();
  }
});
