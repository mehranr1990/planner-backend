import path from 'node:path';
import fs from 'node:fs';
import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { randomUUID, createHmac } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import request from 'supertest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { migrationSandbox } from '../../../../tooling/testing/migration-sandbox.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import { testApplication } from '../support/application.js';
import { DatabaseService } from '../../src/platform/database/database.service.js';
import { SharedControl } from '../../src/platform/storage/shared-control.js';
import { CommerceWorker } from '../../src/modules/admin-commerce/public/index.js';
import { CommerceData } from '../../src/modules/admin-commerce/public/commerce-data.js';
import { assertTeamCustodyEligibility } from '../../src/platform/database/team-custody-eligibility.js';
import {
  SpacesService,
  CollaborationService,
  SharedKernel,
} from '../../src/modules/spaces/public/index.js';
import { TeamsService } from '../../src/modules/teams/public/index.js';
import { CompaniesService } from '../../src/modules/companies/public/index.js';
import { ExportBudget } from '../../src/platform/lifecycle/personal-data.js';
import { resolveEntitlements } from '../../src/modules/admin-commerce/public/entitlements.js';
const sharedRoot = path.resolve('.tools/p5-admin-' + randomUUID());
const secret =
  'test-only-secret-for-foundation-contracts-at-least-32-characters';
let box: Awaited<ReturnType<typeof migrationSandbox>>,
  app: NestExpressApplication,
  db: DatabaseService;
type Actor = { id: string; cookie: string; sessionId: string };
let owner: Actor,
  other: Actor,
  super1: Actor,
  super2: Actor,
  support: Actor,
  reviewer: Actor;
const signed = (token: string, prefix: string) =>
  prefix +
  '.session_token=' +
  encodeURIComponent(
    token + '.' + createHmac('sha256', secret).update(token).digest('base64'),
  );
async function user(verified = true): Promise<Actor> {
  const user = await db.client.user.create({
    data: {
      email: randomUUID() + '@example.test',
      name: 'P4 owner',
      emailVerified: verified,
      settings: { create: {} },
    },
  });
  await db.client.space.create({ data: { ownerUserId: user.id } });
  const session = await db.client.authSession.create({
    data: {
      userId: user.id,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  return {
    id: user.id,
    cookie: signed(session.token, 'better-auth'),
    sessionId: session.id,
  };
}
async function admin(role: string): Promise<Actor> {
  const row = await db.client.adminUser.create({
      data: {
        email: randomUUID() + '@example.test',
        name: 'P4 operator',
        role,
        twoFactorEnabled: true,
        mfaEnrolledAt: new Date(0),
      },
    }),
    session = await db.client.adminSession.create({
      data: {
        userId: row.id,
        token: randomUUID(),
        createdAt: new Date(Date.now() - 1000),
        mfaVerifiedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
  return {
    id: row.id,
    cookie: signed(session.token, 'mehran-admin'),
    sessionId: session.id,
  };
}
const get = (actor: Actor, path: string) =>
  request(app.getHttpServer())
    .get('/api/v1/' + path)
    .set('Cookie', actor.cookie);
const post = (actor: Actor, path: string, body: object, key = randomUUID()) =>
  request(app.getHttpServer())
    .post('/api/v1/' + path)
    .set('Cookie', actor.cookie)
    .set('Origin', 'http://localhost:3000')
    .set('Idempotency-Key', key)
    .send(body);
beforeAll(async () => {
  box = await migrationSandbox(process.env);
  const deployed = spawnSync(
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
  if (deployed.status !== 0) throw new Error(deployed.stdout + deployed.stderr);
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
      SHARED_CONTROL_ROOT: sharedRoot,
      SHARED_CONTROL_KEYS: JSON.stringify({
        p4: Buffer.from(
          'synthetic-only-p4-control-material-at-least-48-bytes',
        ).toString('base64url'),
      }),
      SHARED_CONTROL_ACTIVE_KEY_ID: 'p4',
      SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-P4-TEST',
      NOTIFICATION_EMAIL_ENABLED: 'true',
      MAIL_MODE: 'sink',
      PUSH_MODE: 'sink',
    },
  });
  db = app.get(DatabaseService);
  await app.get(SharedControl).initialize();
  owner = await user();
  other = await user();
  super1 = await admin('SUPER_ADMIN');
  super2 = await admin('SUPER_ADMIN');
  support = await admin('SUPPORT');
  reviewer = await admin('BILLING_MANAGER');
}, 60000);
afterAll(async () => {
  await app?.close();
  await box?.close();
  if (
    sharedRoot.startsWith(path.resolve('.tools') + path.sep) &&
    path.basename(sharedRoot).startsWith('p5-admin-')
  )
    fs.rmSync(sharedRoot, { recursive: true, force: true });
});

const reason = 'Reviewed P5 synthetic fixture';
const adminPost = (
  path: string,
  body: object,
  key = randomUUID(),
  actor = super1,
) => post(actor, 'admin/commerce/' + path, { reason, ...body }, key);
async function customer(actor = owner) {
  const space = await db.client.space.findFirstOrThrow({
    where: { ownerUserId: actor.id, kind: 'PERSONAL' },
  });
  return (await adminPost('customers', { selector: space.id }).expect(200))
    .body as { id: string; spaceId: string };
}
async function newCustomer() {
  const actor = await user();
  return { actor, customer: await customer(actor) };
}
async function feature(binding: string | null = null, kind = 'QUOTA') {
  return (
    await adminPost('features', {
      key: 'fixture.' + randomUUID(),
      name: 'Dynamic capacity',
      kind,
      binding,
    }).expect(200)
  ).body as { id: string; revision: number };
}
async function offer(
  allowances: { featureId: string; value: string }[] = [],
  kind = 'PLAN',
  amount = '10000',
  currency = 'USD',
) {
  const product = (
    await adminPost('products', {
      name: 'Owner configured offer ' + randomUUID(),
      kind,
      visibility: 'PUBLIC',
      pricingPage: true,
      eligibility: ['PERSONAL', 'TEAM', 'COMPANY'],
    }).expect(200)
  ).body as { id: string; revision: number };
  const version = (
    await adminPost('products/' + product.id + '/publish', {
      revision: product.revision,
      propagation: 'NEW_ONLY',
      allowances,
    }).expect(200)
  ).body as { id: string };
  const price = (
    await adminPost('prices', {
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
    await adminPost('customers/' + customerId + '/subscriptions', {
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
async function invoice(
  customerId: string,
  amount = '10000',
  currency = 'USD',
  subscriptionId: string | null = null,
) {
  const draft = (
    await adminPost('customers/' + customerId + '/invoices', {
      currency,
      subtotal: amount,
      description: 'Customer-facing service charge',
      subscriptionId,
    }).expect(200)
  ).body as { id: string; revision: number };
  return (
    await adminPost('invoices/' + draft.id + '/issue', {
      revision: draft.revision,
    }).expect(200)
  ).body as {
    id: string;
    revision: number;
    state: string;
    outstanding: string;
  };
}
async function method() {
  return (
    await adminPost('methods', {
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
    await adminPost('customers/' + customerId + '/payments', {
      methodId,
      amount,
      currency,
      invoiceId,
      reference: randomUUID(),
      ...extra,
    }).expect(200)
  ).body as { id: string; state: string };
}

it('enforces independent realms, explicit capabilities, recent persisted MFA, Origin and strict input', async () => {
  await get(owner, 'admin/commerce/features').expect(401);
  await get(support, 'admin/commerce/features').expect(403);
  await get(reviewer, 'admin/commerce/features').expect(200);
  await post(reviewer, 'admin/commerce/features', {
    reason,
    key: 'cannot.create',
    name: 'Denied',
    kind: 'BOOLEAN',
  }).expect(403);
  await request(app.getHttpServer())
    .post('/api/v1/admin/commerce/features')
    .set('Cookie', super1.cookie)
    .set('Origin', 'https://foreign.invalid')
    .set('Idempotency-Key', randomUUID())
    .send({ reason, key: 'cannot.origin', name: 'Denied', kind: 'BOOLEAN' })
    .expect(403);
  await adminPost('features', {
    key: 'unknown.field',
    name: 'Denied',
    kind: 'BOOLEAN',
    providerKey: 'forbidden',
  }).expect(400);
  await db.client.adminSession.update({
    where: { id: super1.sessionId },
    data: { mfaVerifiedAt: new Date(Date.now() - 301000) },
  });
  await get(super1, 'admin/commerce/features').expect(403);
  await db.client.adminSession.update({
    where: { id: super1.sessionId },
    data: { mfaVerifiedAt: new Date() },
  });
  const key = randomUUID(),
    body = {
      key: 'once.' + randomUUID(),
      name: 'Idempotent feature',
      kind: 'BOOLEAN',
    };
  const a = await adminPost('features', body, key).expect(200),
    b = await adminPost('features', body, key).expect(200);
  expect(a.body.id).toBe(b.body.id);
  await adminPost('features', { ...body, name: 'Changed' }, key).expect(409);
  const denied = await db.client.adminAuditEvent.count({
    where: { action: { contains: 'commerce' }, outcome: 'DENIED' },
  });
  expect(denied).toBeGreaterThan(0);
});
it('publishes immutable dynamic versions and propagates allowances without changing pinned prices', async () => {
  const { customer: c } = await newCustomer(),
    f = await feature(),
    o = await offer([{ featureId: f.id, value: '10' }]),
    s = await grant(c.id, o.priceId);
  const next = await adminPost('products/' + o.productId + '/publish', {
    revision: 2,
    propagation: 'ALL',
    allowances: [{ featureId: f.id, value: '20' }],
  }).expect(200);
  const current = await db.client.commerceSubscription.findUniqueOrThrow({
    where: { id: s.id },
  });
  expect(current.versionId).toBe(next.body.id);
  expect(current.priceId).toBe(o.priceId);
  const resolved = await get(
    super1,
    'admin/commerce/customers/' + c.id + '/entitlements',
  ).expect(200);
  expect(
    resolved.body.features.find(
      (v: { key: string; value: string }) => v.value === '20',
    ),
  ).toBeDefined();
  await expect(
    db.client.commerceAllowance.updateMany({
      where: { versionId: o.versionId },
      data: { value: 999n },
    }),
  ).rejects.toThrow();
  await expect(
    db.client.commercePrice.update({
      where: { id: o.priceId },
      data: { amount: '999' },
    }),
  ).rejects.toThrow();
  await expect(
    db.client.commerceTerm.deleteMany({ where: { subscriptionId: s.id } }),
  ).rejects.toThrow();
});
it('resolves scoped grants, dated and term overrides with final caps, without changing another customer', async () => {
  const { customer: c } = await newCustomer(),
    { customer: foreign } = await newCustomer(),
    f = await feature(),
    o = await offer([{ featureId: f.id, value: '10' }]),
    s = await grant(c.id, o.priceId);
  await adminPost('customers/' + c.id + '/overrides', {
    featureId: f.id,
    value: '8',
    mode: 'ADD',
    duration: 'LIFETIME',
  }).expect(200);
  const cap = await adminPost('customers/' + c.id + '/overrides', {
    featureId: f.id,
    value: '12',
    mode: 'CAP',
    duration: 'DATE',
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  }).expect(200);
  const getValue = async (id: string) =>
    (
      await db.client.$transaction((tx) => resolveEntitlements(tx, id))
    ).features.find((v) => v.key.startsWith('fixture.') && v.value === '12');
  expect(await getValue(c.id)).toBeDefined();
  expect(await getValue(foreign.id)).toBeUndefined();
  const term = await db.client.commerceTerm.findFirstOrThrow({
    where: { subscriptionId: s.id },
  });
  await adminPost('customers/' + foreign.id + '/overrides', {
    featureId: f.id,
    value: '1',
    mode: 'ADD',
    duration: 'TERM',
    termId: term.id,
  }).expect(409);
  await adminPost('overrides/' + cap.body.id + '/revoke', {}).expect(200);
  const result = await db.client.$transaction((tx) =>
    resolveEntitlements(tx, c.id),
  );
  expect(result.features.some((v) => v.value === '18')).toBe(true);
});
it('serializes base grants and keeps personal customers isolated', async () => {
  const { actor, customer: c } = await newCustomer(),
    o = await offer(),
    body = {
      priceId: o.priceId,
      origin: 'EXTERNAL',
      startsAt: new Date().toISOString(),
      renewal: 'MANUAL',
    };
  const responses = await Promise.all([
    adminPost('customers/' + c.id + '/subscriptions', body),
    adminPost(
      'customers/' + c.id + '/subscriptions',
      body,
      randomUUID(),
      super2,
    ),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  await get(other, 'commerce/customers/' + c.id + '/entitlements').expect(404);
  await get(actor, 'commerce/customers/' + c.id + '/entitlements').expect(200);
  await get(super1, 'commerce/customers/' + c.id + '/invoices').expect(401);
  expect(
    await db.client.commerceSubscription.count({ where: { customerId: c.id } }),
  ).toBe(1);
});
it('preserves add-on terms and suppresses fully overlapping future renewal', async () => {
  const { customer: c } = await newCustomer(),
    f = await feature(null, 'BOOLEAN'),
    base = await offer([{ featureId: f.id, value: '0' }]),
    addon = await offer([{ featureId: f.id, value: '1' }], 'ADDON'),
    s = await grant(c.id, base.priceId),
    a = await grant(c.id, addon.priceId);
  await adminPost('products/' + base.productId + '/publish', {
    revision: 2,
    propagation: 'ALL',
    allowances: [{ featureId: f.id, value: '1' }],
  }).expect(200);
  await adminPost('subscriptions/' + a.id + '/renew', {
    revision: a.revision,
    priceId: addon.priceId,
    origin: 'EXTERNAL',
  }).expect(409);
  expect(
    await db.client.commerceTerm.count({ where: { subscriptionId: a.id } }),
  ).toBe(1);
  expect(
    (
      await db.client.commerceSubscription.findUniqueOrThrow({
        where: { id: a.id },
      })
    ).state,
  ).toBe('ACTIVE');
  expect(
    (
      await db.client.commerceSubscription.findUniqueOrThrow({
        where: { id: s.id },
      })
    ).priceId,
  ).toBe(base.priceId);
});
it('pauses with precise freeze or continuing clocks and keeps cancellation separate from refunds', async () => {
  const { actor, customer: c } = await newCustomer(),
    o = await offer(),
    s = await grant(c.id, o.priceId);
  await post(actor, 'commerce/subscriptions/' + s.id + '/pause', {
    revision: 1,
    clock: 'FREEZE',
  }).expect(404);
  const paused = await adminPost('subscriptions/' + s.id + '/pause', {
    revision: 1,
    clock: 'FREEZE',
  }).expect(200);
  await db.client.commerceSubscription.update({
    where: { id: s.id },
    data: { pausedAt: new Date(Date.now() - 3600000) },
  });
  const resumed = await adminPost('subscriptions/' + s.id + '/reactivate', {
    revision: paused.body.revision,
  }).expect(200);
  expect(
    new Date(resumed.body.endsAt).getTime() - new Date(s.endsAt).getTime(),
  ).toBeGreaterThanOrEqual(3600000);
  const cancel = await post(
    actor,
    'commerce/subscriptions/' + s.id + '/cancel',
    { revision: resumed.body.revision },
  ).expect(200);
  expect(cancel.body.cancelAtEnd).toBe(true);
  expect(cancel.body.effectiveState).toBe('ACTIVE');
  expect(
    await db.client.commerceRefund.count({ where: { customerId: c.id } }),
  ).toBe(0);
  const again = await adminPost('subscriptions/' + s.id + '/reactivate', {
    revision: cancel.body.revision,
  }).expect(200);
  await adminPost('subscriptions/' + s.id + '/pause', {
    revision: again.body.revision,
    clock: 'CONTINUE',
  }).expect(200);
  await db.client.commerceSubscription.update({
    where: { id: s.id },
    data: {
      endsAt: new Date(Date.now() - 8 * 86400000),
      startsAt: new Date(Date.now() - 40 * 86400000),
      nextAt: new Date(0),
    },
  });
  await app.get(CommerceWorker).consume();
  expect(
    (
      await db.client.commerceSubscription.findUniqueOrThrow({
        where: { id: s.id },
      })
    ).state,
  ).toBe('EXPIRED');
});
it('verifies manual payments once, rejects partial payment and canonical duplicate references', async () => {
  const { customer: c } = await newCustomer(),
    i = await invoice(c.id),
    m = await method();
  const small = await payment(c.id, m.id, '100', i.id);
  await adminPost('payments/' + small.id + '/verify', { approve: true }).expect(
    409,
  );
  expect(
    (
      await db.client.commercePayment.findUniqueOrThrow({
        where: { id: small.id },
      })
    ).state,
  ).toBe('PENDING');
  const paid = await payment(c.id, m.id, '10000', i.id),
    key = randomUUID();
  const settled = await adminPost(
    'payments/' + paid.id + '/verify',
    { approve: true },
    key,
  ).expect(200);
  expect(settled.body.state).toBe('VERIFIED');
  await adminPost(
    'payments/' + paid.id + '/verify',
    { approve: true },
    key,
  ).expect(200);
  await adminPost(
    'payments/' + paid.id + '/verify',
    { approve: true },
    randomUUID(),
    super2,
  ).expect(409);
  expect(
    await db.client.commerceLedger.count({
      where: { paymentId: paid.id, kind: 'PAYMENT' },
    }),
  ).toBe(1);
  await adminPost('customers/' + c.id + '/payments', {
    methodId: m.id,
    reference: ' duplicate-ref ',
    currency: 'USD',
    amount: '1',
  }).expect(200);
  await adminPost('customers/' + c.id + '/payments', {
    methodId: m.id,
    reference: 'DUPLICATE-REF',
    currency: 'USD',
    amount: '1',
  }).expect(409);
  await adminPost('methods', {
    name: 'Disabled future boundary',
    kind: 'FUTURE_PROVIDER',
    referenceNamespace: 'future.' + randomUUID(),
    active: true,
  }).expect(409);
});
it('corrects paid invoices through immutable paired versions and prevents credit plus refund double spending', async () => {
  const { actor, customer: c } = await newCustomer(),
    i = await invoice(c.id),
    m = await method(),
    p = await payment(c.id, m.id, '10000', i.id);
  await adminPost('payments/' + p.id + '/verify', { approve: true }).expect(
    200,
  );
  const paid = await db.client.commerceInvoice.findUniqueOrThrow({
    where: { id: i.id },
  });
  const correction = await adminPost('invoices/' + i.id + '/correct', {
    revision: paid.revision,
    subtotal: '6000',
    description: 'Corrected customer amount',
    promotionCodes: [],
    reason: 'Internal-only operator investigation',
  }).expect(200);
  expect(correction.body.versions).toHaveLength(2);
  expect(correction.body.adjustments).toHaveLength(1);
  expect(correction.body.outstanding).toBe('0');
  const publicInvoice = await get(
    actor,
    'commerce/customers/' + c.id + '/invoices',
  ).expect(200);
  expect(JSON.stringify(publicInvoice.body)).not.toContain('Internal-only');
  const credit = await get(
    actor,
    'commerce/customers/' + c.id + '/credit?currency=USD',
  ).expect(200);
  expect(credit.body.available).toBe('4000');
  const next = await invoice(c.id, '4000');
  await adminPost('invoices/' + next.id + '/apply-credit', {
    revision: next.revision,
  }).expect(200);
  await adminPost('payments/' + p.id + '/refund', {
    amount: '10000',
    reference: randomUUID(),
  }).expect(409);
  await adminPost('payments/' + p.id + '/refund', {
    amount: '6000',
    reference: randomUUID(),
  }).expect(200);
  await adminPost('payments/' + p.id + '/refund', {
    amount: '1',
    reference: randomUUID(),
  }).expect(409);
  await expect(
    db.client.commerceInvoiceVersion.updateMany({
      where: { invoiceId: i.id },
      data: { total: '1' },
    }),
  ).rejects.toThrow();
  await expect(
    db.client.commercePayment.update({
      where: { id: p.id },
      data: { amount: '1' },
    }),
  ).rejects.toThrow();
  const before = await db.client.commerceInvoice.count();
  await expect(
    db.client.$transaction(async (tx) => {
      const v = await tx.commerceInvoiceVersion.findFirstOrThrow({
        where: { invoiceId: i.id },
        orderBy: { version: 'desc' },
      });
      await tx.commerceInvoiceVersion.create({
        data: {
          invoiceId: i.id,
          version: 99,
          subtotal: '1',
          total: '1',
          description: 'Unpaired illegal rewrite',
          calculation: {},
        },
      });
      return v.id;
    }),
  ).rejects.toThrow();
  expect(await db.client.commerceInvoice.count()).toBe(before);
});
it('keeps currency ledgers separate and reports exact standalone external receipts', async () => {
  const { customer: c } = await newCustomer(),
    m = await method(),
    amount = '9007199254740993',
    p = await payment(c.id, m.id, amount, null, 'USD');
  await adminPost('payments/' + p.id + '/verify', { approve: true }).expect(
    200,
  );
  const euro = await invoice(c.id, '100', 'EUR');
  await adminPost('customers/' + c.id + '/payments', {
    methodId: m.id,
    reference: randomUUID(),
    invoiceId: euro.id,
    currency: 'USD',
    amount: '100',
  }).expect(409);
  const report = await get(
    super1,
    'admin/commerce/reports?from=' +
      encodeURIComponent(new Date(Date.now() - 60000).toISOString()) +
      '&to=' +
      encodeURIComponent(new Date(Date.now() + 1000).toISOString()),
  ).expect(200);
  const usd = report.body.currencies.find(
    (v: { currency: string }) => v.currency === 'USD',
  );
  expect(BigInt(usd.payments)).toBeGreaterThanOrEqual(BigInt(amount));
  const audit = await db.client.adminAuditEvent.findMany({
    where: { action: 'GET commerce/reports' },
  });
  expect(JSON.stringify(audit)).not.toContain(amount);
});

async function policy(enforcement: boolean, extra: object = {}) {
  const p = (await get(super1, 'admin/commerce/policy').expect(200)).body;
  return adminPost('policy', {
    revision: p.revision,
    enforcement,
    acknowledge: true,
    graceDays: p.graceDays,
    graceWritable: p.graceWritable,
    preExpiryDays: p.preExpiryDays,
    postExpiryDays: p.postExpiryDays,
    retryCount: p.retryCount,
    retryHours: p.retryHours,
    taxBps: p.taxBps,
    feeBps: p.feeBps,
    writeOffMaximum: p.writeOffMaximum,
    ...extra,
  }).expect(200);
}
it('leaves existing features free by default and enforces expiry on real Personal writes, files and offline replay', async () => {
  const { actor, customer: c } = await newCustomer(),
    f = await feature('personal.write', 'BOOLEAN'),
    o = await offer([{ featureId: f.id, value: '1' }]),
    s = await grant(c.id, o.priceId);
  await adminPost('features/' + f.id, {
    revision: 1,
    name: 'Personal paid mutations',
    enforced: true,
    archived: false,
  }).expect(200);
  const task = await post(actor, 'tasks', {
    title: 'Data retained after expiry',
  }).expect(201);
  await db.client.commerceSubscription.update({
    where: { id: s.id },
    data: {
      startsAt: new Date(Date.now() - 40 * 86400000),
      endsAt: new Date(Date.now() - 8 * 86400000),
    },
  });
  await post(actor, 'tasks', { title: 'Still free before activation' }).expect(
    201,
  );
  await policy(true);
  try {
    await post(actor, 'tasks', { title: 'Expired paid mutation' }).expect(403);
    await get(actor, 'tasks/' + task.body.id).expect(200);
    await post(actor, 'files/uploads', {
      filename: 'report.txt',
      mimeType: 'text/plain',
      expectedSize: 10,
    }).expect(403);
    const status = await get(actor, 'sync/status').expect(200);
    await post(actor, 'sync/push', {
      epoch: status.body.epoch,
      operations: [
        {
          clientMutationId: randomUUID(),
          baseRevision: 0,
          operation: 'TASK_CREATE',
          body: { title: 'Expired offline write' },
        },
      ],
    }).expect(403);
    expect(await db.client.task.count({ where: { spaceId: c.spaceId } })).toBe(
      2,
    );
  } finally {
    await policy(false);
  }
});
it('recovers scheduled activation and deduplicated expiry notices through concurrent durable sweeps', async () => {
  const { customer: c } = await newCustomer(),
    o = await offer(),
    s = await grant(
      c.id,
      o.priceId,
      'COMPLIMENTARY',
      new Date(Date.now() + 1000).toISOString(),
    );
  const initial = await db.client.commerceSubscription.findUniqueOrThrow({
    where: { id: s.id },
  });
  await db.client.commerceSubscription.update({
    where: { id: s.id },
    data: {
      startsAt: new Date(Date.now() - 1000),
      endsAt: new Date(Date.now() + 1000),
      nextAt: new Date(0),
    },
  });
  const worker = app.get(CommerceWorker);
  await Promise.all([worker.consume(), worker.consume()]);
  expect(
    (
      await db.client.commerceSubscription.findUniqueOrThrow({
        where: { id: s.id },
      })
    ).state,
  ).toBe('ACTIVE');
  expect(
    await db.client.commerceNotice.count({
      where: { subscriptionId: s.id, kind: 'PRE_EXPIRY' },
    }),
  ).toBe(1);
  await db.client.commerceSubscription.update({
    where: { id: s.id },
    data: {
      startsAt: new Date(Date.now() - 40 * 86400000),
      endsAt: new Date(Date.now() - 2 * 86400000),
      nextAt: new Date(0),
    },
  });
  await worker.consume();
  expect(
    (
      await db.client.commerceSubscription.findUniqueOrThrow({
        where: { id: s.id },
      })
    ).state,
  ).toBe('GRACE');
  expect(initial.origin).toBe('COMPLIMENTARY');
  expect(
    await db.client.commercePayment.count({ where: { subscriptionId: s.id } }),
  ).toBe(0);
  await db.client.commerceSubscription.update({
    where: { id: s.id },
    data: { endsAt: new Date(Date.now() - 8 * 86400000), nextAt: new Date(0) },
  });
  await worker.consume();
  expect(
    (
      await db.client.commerceSubscription.findUniqueOrThrow({
        where: { id: s.id },
      })
    ).state,
  ).toBe('EXPIRED');
});
it('uses customer renewal invoices and verified receipts to extend a term while preserving original terms', async () => {
  const { actor, customer: c } = await newCustomer(),
    o = await offer(),
    s = await grant(c.id, o.priceId),
    m = await method();
  const renewal = await post(
    actor,
    'commerce/subscriptions/' + s.id + '/renew',
    { revision: s.revision, priceId: o.priceId },
  ).expect(200);
  expect(renewal.body.state).toBe('AWAITING_PAYMENT');
  expect(
    (
      await db.client.commerceSubscription.findUniqueOrThrow({
        where: { id: s.id },
      })
    ).endsAt?.toISOString(),
  ).toBe(s.endsAt);
  const p = await payment(c.id, m.id, '10000', renewal.body.invoiceId);
  await adminPost('payments/' + p.id + '/verify', { approve: true }).expect(
    200,
  );
  const current = await db.client.commerceSubscription.findUniqueOrThrow({
    where: { id: s.id },
  });
  expect(current.endsAt!.getTime() - new Date(s.endsAt).getTime()).toBe(
    30 * 86400000,
  );
  expect(current.startsAt.toISOString()).toBe(s.startsAt);
  const terms = await db.client.commerceTerm.findMany({
    where: { subscriptionId: s.id },
    orderBy: { createdAt: 'asc' },
  });
  expect(terms).toHaveLength(2);
  expect(terms[0]!.endsAt?.toISOString()).toBe(s.endsAt);
  expect(
    (await db.client.commercePayment.findUniqueOrThrow({ where: { id: p.id } }))
      .termId,
  ).toBe(terms[1]!.id);
  expect(
    (await get(actor, 'commerce/subscriptions/' + s.id + '/offer').expect(200))
      .body.product.id,
  ).toBe(o.productId);
});
it('records actual payment independently when a canceled renewal needs operator review', async () => {
  const { actor, customer: c } = await newCustomer(),
    o = await offer(),
    s = await grant(c.id, o.priceId),
    m = await method();
  const renewal = await post(
    actor,
    'commerce/subscriptions/' + s.id + '/renew',
    { revision: s.revision, priceId: o.priceId },
  ).expect(200);
  await post(actor, 'commerce/subscriptions/' + s.id + '/cancel', {
    revision: s.revision,
  }).expect(200);
  const p = await payment(c.id, m.id, '10000', renewal.body.invoiceId);
  await adminPost('payments/' + p.id + '/verify', { approve: true }).expect(
    200,
  );
  expect(
    (
      await db.client.commerceRenewal.findUniqueOrThrow({
        where: { invoiceId: renewal.body.invoiceId },
      })
    ).state,
  ).toBe('REVIEW');
  expect(
    (
      await db.client.commerceSubscription.findUniqueOrThrow({
        where: { id: s.id },
      })
    ).cancelAtEnd,
  ).toBe(true);
  expect(
    (await db.client.commercePayment.findUniqueOrThrow({ where: { id: p.id } }))
      .state,
  ).toBe('VERIFIED');
});
it('applies capped concurrent public/private coupons and exact tax/fee rules', async () => {
  const a = await newCustomer(),
    b = await newCustomer(),
    code = 'PROMO-' + randomUUID();
  await adminPost('promotions', {
    code,
    visibility: 'PUBLIC',
    kind: 'PERCENT',
    amount: '1000',
    currency: null,
    startsAt: new Date(Date.now() - 1000).toISOString(),
    endsAt: new Date(Date.now() + 60000).toISOString(),
    maxUses: 1,
    perCustomer: 1,
    combinable: false,
  }).expect(200);
  await policy(false, { taxBps: 1000, feeBps: 100 });
  try {
    const body = {
      currency: 'USD',
      subtotal: '1001',
      description: 'Coupon financial document',
      promotionCodes: [code],
    };
    const results = await Promise.all([
      adminPost('customers/' + a.customer.id + '/invoices', body),
      adminPost(
        'customers/' + b.customer.id + '/invoices',
        body,
        randomUUID(),
        super2,
      ),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const success = results.find((r) => r.status === 200)!;
    expect(success.body.versions[0].discount).toBe('100');
    expect(success.body.versions[0].tax).toBe('90');
    expect(success.body.versions[0].fee).toBe('9');
    expect(success.body.versions[0].total).toBe('1000');
    const privateCode = 'PRIVATE-' + randomUUID();
    await adminPost('promotions', {
      code: privateCode,
      visibility: 'PRIVATE',
      kind: 'FIXED',
      amount: '100',
      currency: 'EUR',
      startsAt: new Date(Date.now() - 1000).toISOString(),
      endsAt: new Date(Date.now() + 60000).toISOString(),
      maxUses: 2,
      perCustomer: 1,
      combinable: false,
      customerId: a.customer.id,
    }).expect(200);
    const publicList = await get(
      a.actor,
      'commerce/customers/' + a.customer.id + '/promotions',
    ).expect(200);
    expect(
      publicList.body.items.some(
        (p: { code: string }) => p.code === privateCode,
      ),
    ).toBe(false);
    await adminPost('customers/' + b.customer.id + '/invoices', {
      ...body,
      promotionCodes: [privateCode],
    }).expect(409);
    await adminPost('customers/' + a.customer.id + '/invoices', {
      ...body,
      promotionCodes: [code, privateCode],
    }).expect(409);
  } finally {
    await policy(false, { taxBps: 0, feeBps: 0 });
  }
});
it('routes overpayments explicitly and fences concurrent credits and refunds', async () => {
  const { customer: c } = await newCustomer(),
    i = await invoice(c.id, '1000'),
    m = await method(),
    p = await payment(c.id, m.id, '1500', i.id, 'USD', {
      overpayment: 'CREDIT',
    });
  await adminPost('payments/' + p.id + '/verify', { approve: true }).expect(
    200,
  );
  expect(
    (
      await get(
        super1,
        'admin/commerce/customers/' + c.id + '/credit?currency=USD',
      ).expect(200)
    ).body.available,
  ).toBe('500');
  const one = await invoice(c.id, '500'),
    two = await invoice(c.id, '500');
  const applied = await Promise.all([
    adminPost('invoices/' + one.id + '/apply-credit', {
      revision: one.revision,
    }),
    adminPost(
      'invoices/' + two.id + '/apply-credit',
      { revision: two.revision },
      randomUUID(),
      super2,
    ),
  ]);
  expect(applied.map((r) => r.status).sort()).toEqual([200, 409]);
  const refunds = await Promise.all([
    adminPost('payments/' + p.id + '/refund', {
      amount: '1000',
      reference: randomUUID(),
    }),
    adminPost(
      'payments/' + p.id + '/refund',
      { amount: '1000', reference: randomUUID() },
      randomUUID(),
      super2,
    ),
  ]);
  expect(refunds.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(
    (
      await get(
        super1,
        'admin/commerce/customers/' + c.id + '/credit?currency=USD',
      ).expect(200)
    ).body.available,
  ).toBe('0');
});
it('computes unused paid credit and preserves closed term history across immediate plan change', async () => {
  const { customer: c } = await newCustomer(),
    o = await offer([], 'PLAN', '10000'),
    next = await offer([], 'PLAN', '20000'),
    s = await grant(c.id, o.priceId),
    m = await method(),
    p = await payment(c.id, m.id, '10000', null, 'USD', {
      subscriptionId: s.id,
    });
  await adminPost('payments/' + p.id + '/verify', { approve: true }).expect(
    200,
  );
  const changed = await adminPost('subscriptions/' + s.id + '/change', {
    revision: s.revision,
    priceId: next.priceId,
    origin: 'EXTERNAL',
    mode: 'IMMEDIATE_CREDIT',
  }).expect(200);
  expect(changed.body.productId).toBe(next.productId);
  const credit = BigInt(
    (
      await get(
        super1,
        'admin/commerce/customers/' + c.id + '/credit?currency=USD',
      ).expect(200)
    ).body.available,
  );
  expect(credit).toBeGreaterThan(9900n);
  expect(credit).toBeLessThanOrEqual(10000n);
  expect(
    await db.client.commerceTermClosure.count({
      where: { term: { subscriptionId: s.id } },
    }),
  ).toBe(1);
  await adminPost('payments/' + p.id + '/refund', {
    amount: '10000',
    reference: randomUUID(),
  }).expect(200);
  expect(
    (
      await get(
        super1,
        'admin/commerce/customers/' + c.id + '/credit?currency=USD',
      ).expect(200)
    ).body.available,
  ).toBe('0');
});
it('bounds debt write-off and pairs it with a retained version and adjustment', async () => {
  const { customer: c } = await newCustomer(),
    i = await invoice(c.id, '200');
  await adminPost('invoices/' + i.id + '/write-off', {
    revision: i.revision,
    acknowledge: true,
  }).expect(409);
  await policy(false, { writeOffMaximum: '200' });
  try {
    const result = await adminPost('invoices/' + i.id + '/write-off', {
      revision: i.revision,
      acknowledge: true,
    }).expect(200);
    expect(result.body.versions).toHaveLength(2);
    expect(result.body.adjustments[0].kind).toBe('WRITE_OFF');
    expect(result.body.outstanding).toBe('0');
  } finally {
    await policy(false, { writeOffMaximum: '0' });
  }
});
it('exports only owned commercial data and detaches Personal identity without deleting monetary history', async () => {
  const { actor, customer: c } = await newCustomer(),
    o = await offer(),
    s = await grant(c.id, o.priceId),
    i = await invoice(c.id, '10000', 'USD', s.id),
    m = await method(),
    p = await payment(c.id, m.id, '10000', i.id);
  await adminPost('payments/' + p.id + '/verify', { approve: true }).expect(
    200,
  );
  const scope = await app.get(SpacesService).authorizePersonal({
      userId: actor.id,
      sessionId: actor.sessionId,
      requestId: randomUUID(),
      correlationId: randomUUID(),
    }),
    budget = new ExportBudget();
  await db.client.$transaction((tx) =>
    app.get(CommerceData).snapshot(tx, scope, budget),
  );
  expect(budget.sections.commercialPayments).toHaveLength(1);
  expect(JSON.stringify(budget.sections)).not.toContain(reason);
  await db.client.$transaction((tx) => app.get(CommerceData).erase(tx, scope));
  const detached = await db.client.commerceCustomer.findUniqueOrThrow({
    where: { id: c.id },
  });
  expect(detached.spaceId).toBe(null);
  expect(detached.closedAt).not.toBe(null);
  expect(
    await db.client.commercePayment.count({ where: { customerId: c.id } }),
  ).toBe(1);
  expect(
    await db.client.commerceInvoiceVersion.count({
      where: { invoiceId: i.id },
    }),
  ).toBe(1);
  await get(actor, 'commerce/customers/' + c.id + '/invoices').expect(404);
  expect(
    (
      await db.client.commerceSubscription.findUniqueOrThrow({
        where: { id: s.id },
      })
    ).state,
  ).toBe('CANCELED');
});

const actorContext = (a: Actor) => ({
  userId: a.id,
  sessionId: a.sessionId,
  requestId: randomUUID(),
  correlationId: randomUUID(),
});
async function retention() {
  const version = 'p5-' + randomUUID(),
    rule = {
      retainAfterClosureSeconds: 0,
      audience: ['OWNER', 'ADMIN'],
      exportAuthority: ['OWNER'],
      disposalAction: 'PURGE',
    };
  await db.client.sharedRetentionPolicy.create({
    data: {
      version,
      approvalReference: 'SYNTHETIC-P5',
      configuration: {
        policyVersion: version,
        approvalReference: 'SYNTHETIC-P5',
        accountableOperator: 'fixture',
        applicableContexts: ['PROJECT', 'TEAM', 'COMPANY'],
        marketScope: 'isolated tests',
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
        backupPolicyReference: 'independent fixture',
      },
    },
  });
  return version;
}
it('counts the Team owner as a seat at real invitation acceptance and separates financial authority from membership', async () => {
  const a = await newCustomer(),
    member = await user(),
    teamId = randomUUID(),
    version = await retention();
  await app
    .get(TeamsService)
    .create(
      actorContext(a.actor),
      { id: teamId, title: 'Commercial Team', retentionPolicyVersion: version },
      randomUUID(),
    );
  const c = (await adminPost('customers', { selector: teamId }).expect(200))
    .body as { id: string };
  await expect(
    db.client.$transaction((tx) => assertTeamCustodyEligibility(tx, teamId)),
  ).rejects.toMatchObject({
    response: {
      code: 'TEAM_CUSTODY_DEPENDENCIES_UNSUPPORTED',
      dependency: 'CommerceCustomer',
    },
  });
  const f = await feature('seats'),
    o = await offer([{ featureId: f.id, value: '1' }]);
  const financialSubscription = await grant(c.id, o.priceId, 'COMPLIMENTARY');
  await adminPost('features/' + f.id, {
    revision: 1,
    name: 'Owner-counted seats',
    enforced: true,
    archived: false,
  }).expect(200);
  const collab = app.get(CollaborationService),
    invitation = await collab.createInvitation(
      actorContext(a.actor),
      teamId,
      {
        kind: 'MEMBERSHIP',
        memberRole: 'MEMBER',
        recipient: { userId: member.id },
      },
      randomUUID(),
    );
  await policy(true);
  try {
    await expect(
      collab.decideInvitation(
        actorContext(member),
        invitation.invitation.id,
        invitation.proof!,
        1,
        true,
        'TEAM',
      ),
    ).rejects.toHaveProperty('status', 403);
    await adminPost('customers/' + c.id + '/overrides', {
      featureId: f.id,
      value: '1',
      mode: 'ADD',
      duration: 'LIFETIME',
    }).expect(200);
    await collab.decideInvitation(
      actorContext(member),
      invitation.invitation.id,
      invitation.proof!,
      1,
      true,
      'TEAM',
    );
    await get(member, 'commerce/customers/' + c.id + '/entitlements').expect(
      200,
    );
    await get(member, 'commerce/customers/' + c.id + '/invoices').expect(404);
    await adminPost('customers/' + c.id + '/financial-grants', {
      userId: member.id,
      grant: true,
    }).expect(200);
    await get(member, 'commerce/customers/' + c.id + '/invoices').expect(200);
    await post(
      member,
      'commerce/subscriptions/' + financialSubscription.id + '/cancel',
      { revision: financialSubscription.revision },
    ).expect(403);
    expect(
      (
        await db.client.commerceSubscription.findUniqueOrThrow({
          where: { id: financialSubscription.id },
        })
      ).cancelAtEnd,
    ).toBe(false);
    await adminPost('customers/' + c.id + '/financial-grants', {
      userId: member.id,
      grant: false,
    }).expect(200);
    await get(member, 'commerce/customers/' + c.id + '/invoices').expect(404);
    expect(
      await db.client.contextAccess.count({
        where: { scopeId: teamId, state: 'ACTIVE', memberRole: { not: null } },
      }),
    ).toBe(2);
    const kernel = app.get(SharedKernel);
    await expect(
      db.client.$transaction((tx) =>
        kernel.featureBatchGrowth(tx, teamId, 'shared.membership', 2),
      ),
    ).rejects.toHaveProperty('status', 403);
  } finally {
    await policy(false);
  }
});
it('isolates Company entitlements from the owner Personal account and unrelated Workspaces', async () => {
  const a = await newCustomer(),
    companyId = randomUUID(),
    version = await retention();
  await app.get(CompaniesService).create(
    actorContext(a.actor),
    {
      id: companyId,
      title: 'Commercial Company',
      retentionPolicyVersion: version,
    },
    randomUUID(),
  );
  const c = (await adminPost('customers', { selector: companyId }).expect(200))
    .body as { id: string; kind: string };
  expect(c.kind).toBe('COMPANY');
  const f = await feature(),
    o = await offer([{ featureId: f.id, value: '42' }]);
  await grant(c.id, o.priceId, 'COMPLIMENTARY');
  const shared = await get(
      a.actor,
      'commerce/customers/' + c.id + '/entitlements',
    ).expect(200),
    personal = await get(
      a.actor,
      'commerce/customers/' + a.customer.id + '/entitlements',
    ).expect(200);
  expect(
    shared.body.features.some((v: { value: string }) => v.value === '42'),
  ).toBe(true);
  expect(
    personal.body.features.some((v: { value: string }) => v.value === '42'),
  ).toBe(false);
  await get(other, 'commerce/customers/' + c.id + '/entitlements').expect(404);
});

it('publishes only visible public prices and excludes negotiated customer prices from the anonymous pricing catalog', async () => {
  const { customer: c } = await newCustomer(),
    o = await offer();
  await adminPost('prices', {
    versionId: o.versionId,
    customerId: c.id,
    currency: 'USD',
    amount: '777',
    termDays: 30,
    recurring: true,
    complimentary: false,
  }).expect(200);
  const hidden = await offer();
  await adminPost('products/' + hidden.productId, {
    revision: 2,
    name: 'Private commercial offer',
    archived: false,
    visibility: 'PRIVATE',
    pricingPage: true,
    eligibility: ['PERSONAL'],
  }).expect(200);
  const unlisted = await offer();
  await adminPost('products/' + unlisted.productId, {
    revision: 2,
    name: 'Not on pricing page',
    archived: false,
    visibility: 'PUBLIC',
    pricingPage: false,
    eligibility: ['PERSONAL'],
  }).expect(200);
  const result = await request(app.getHttpServer())
    .get('/api/v1/commerce/catalog?kind=PERSONAL&limit=100')
    .expect(200);
  const product = result.body.items.find(
    (p: { id: string }) => p.id === o.productId,
  );
  expect(product.prices).toHaveLength(1);
  expect(product.prices[0].amount).toBe('10000');
  expect(
    result.body.items.some(
      (p: { id: string }) =>
        p.id === hidden.productId || p.id === unlisted.productId,
    ),
  ).toBe(false);
});
it('expires dated and term overrides at authoritative boundaries while configured grace retains base access', async () => {
  const { customer: c } = await newCustomer(),
    f = await feature(),
    o = await offer([{ featureId: f.id, value: '10' }]),
    s = await grant(c.id, o.priceId);
  const term = await db.client.commerceTerm.findFirstOrThrow({
      where: { subscriptionId: s.id },
    }),
    key = (
      await db.client.commerceFeature.findUniqueOrThrow({ where: { id: f.id } })
    ).key;
  await adminPost('customers/' + c.id + '/overrides', {
    featureId: f.id,
    value: '5',
    mode: 'ADD',
    duration: 'DATE',
    expiresAt: new Date(Date.now() + 1000).toISOString(),
  }).expect(200);
  await adminPost('customers/' + c.id + '/overrides', {
    featureId: f.id,
    value: '1',
    mode: 'CAP',
    duration: 'TERM',
    termId: term.id,
  }).expect(200);
  await db.client.commerceSubscription.update({
    where: { id: s.id },
    data: { graceWritable: true },
  });
  const now = await db.client.$transaction((tx) =>
      resolveEntitlements(tx, c.id),
    ),
    future = await db.client.$transaction((tx) =>
      resolveEntitlements(
        tx,
        c.id,
        new Date(new Date(s.endsAt).getTime() + 1000),
      ),
    );
  expect(now.features.find((v) => v.key === key)?.value).toBe('1');
  expect(future.features.find((v) => v.key === key)?.value).toBe('10');
});
it('applies a scheduled plan change at its committed term boundary after worker downtime', async () => {
  const { customer: c } = await newCustomer(),
    old = await offer(),
    next = await offer(),
    s = await grant(c.id, old.priceId);
  await adminPost('subscriptions/' + s.id + '/change', {
    revision: 1,
    priceId: next.priceId,
    origin: 'COMPLIMENTARY',
    mode: 'TERM_END',
  }).expect(200);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(new Date(s.endsAt).getTime() + 86400000));
  try {
    await app.get(CommerceWorker).consume();
  } finally {
    vi.useRealTimers();
  }
  const row = await db.client.commerceSubscription.findUniqueOrThrow({
    where: { id: s.id },
  });
  expect(row.productId).toBe(next.productId);
  expect(row.startsAt.toISOString()).toBe(s.endsAt);
  expect(row.endsAt!.getTime() - new Date(s.endsAt).getTime()).toBe(
    30 * 86400000,
  );
  expect(
    await db.client.commerceTerm.count({ where: { subscriptionId: s.id } }),
  ).toBe(2);
});
it('supports indefinite manual external grants and preserves independent add-ons through pause and cancellation', async () => {
  const { actor, customer: c } = await newCustomer(),
    o = await offer(),
    a = await offer([], 'ADDON');
  const s = (
    await adminPost('customers/' + c.id + '/subscriptions', {
      priceId: o.priceId,
      origin: 'EXTERNAL',
      startsAt: new Date().toISOString(),
      nonExpiring: true,
      renewal: 'FIXED',
    }).expect(200)
  ).body;
  const addon = await grant(c.id, a.priceId, 'COMPLIMENTARY');
  expect(s.endsAt).toBe(null);
  const cancel = await post(
    actor,
    'commerce/subscriptions/' + s.id + '/cancel',
    { revision: s.revision },
  ).expect(200);
  expect(cancel.body.effectiveState).toBe('ACTIVE');
  const immediate = await adminPost('subscriptions/' + s.id + '/cancel', {
    revision: cancel.body.revision,
    immediate: true,
  }).expect(200);
  await adminPost('subscriptions/' + s.id + '/reactivate', {
    revision: immediate.body.revision,
  }).expect(200);
  expect(
    (
      await db.client.commerceSubscription.findUniqueOrThrow({
        where: { id: addon.id },
      })
    ).state,
  ).toBe('ACTIVE');
  expect(
    await db.client.commercePayment.count({ where: { customerId: c.id } }),
  ).toBe(0);
});
it('requires a separately notified policy for renewal price increases', async () => {
  const { customer: c } = await newCustomer(),
    o = await offer(),
    s = await grant(c.id, o.priceId);
  const expensive = (
    await adminPost('prices', {
      versionId: o.versionId,
      currency: 'USD',
      amount: '20000',
      termDays: 30,
      recurring: true,
      complimentary: false,
    }).expect(200)
  ).body;
  await db.client.commerceSubscription.update({
    where: { id: s.id },
    data: {
      startsAt: new Date(Date.now() - 40 * 86400000),
      endsAt: new Date(Date.now() - 1000),
    },
  });
  await adminPost('subscriptions/' + s.id + '/renew', {
    revision: s.revision,
    priceId: expensive.id,
    origin: 'EXTERNAL',
  }).expect(409);
  const notified = await adminPost('subscriptions/' + s.id + '/renewal-price', {
    revision: s.revision,
    priceId: expensive.id,
    effectiveAt: new Date(Date.now() + 86401000).toISOString(),
  }).expect(200);
  expect(
    await db.client.commerceNotice.count({
      where: {
        subscriptionId: s.id,
        kind: 'RENEWAL_PRICE_CHANGED',
        publishedAt: { not: null },
      },
    }),
  ).toBe(1);
  await db.client.commerceSubscription.update({
    where: { id: s.id },
    data: { renewalPriceAt: new Date(Date.now() - 1000) },
  });
  const renewed = await adminPost('subscriptions/' + s.id + '/renew', {
    revision: notified.body.revision,
    priceId: expensive.id,
    origin: 'EXTERNAL',
  }).expect(200);
  expect(renewed.body.priceId).toBe(expensive.id);
  expect(
    (
      await db.client.commercePrice.findUniqueOrThrow({
        where: { id: o.priceId },
      })
    ).amount.toString(),
  ).toBe('10000');
});
it('requires explicit overpayment review and records a manual refund liability without a withdrawable wallet', async () => {
  const { customer: c } = await newCustomer(),
    i = await invoice(c.id, '1000'),
    m = await method(),
    p = await payment(c.id, m.id, '1500', i.id);
  await adminPost('payments/' + p.id + '/verify', { approve: true }).expect(
    409,
  );
  await adminPost('payments/' + p.id + '/verify', {
    approve: true,
    overpayment: 'REFUND_PENDING',
  }).expect(200);
  expect(
    (
      await get(
        super1,
        'admin/commerce/customers/' + c.id + '/credit?currency=USD',
      ).expect(200)
    ).body.available,
  ).toBe('0');
  expect(
    await db.client.commerceLedger.count({
      where: { paymentId: p.id, kind: 'REFUND_LIABILITY' },
    }),
  ).toBe(1);
  await adminPost('payments/' + p.id + '/refund', {
    amount: '500',
    reference: randomUUID(),
  }).expect(200);
});

it('retains additive capacity add-ons when a base plan contains the same quota key', async () => {
  const { customer: c } = await newCustomer(),
    f = await feature(),
    base = await offer([{ featureId: f.id, value: '10' }]),
    addon = await offer([{ featureId: f.id, value: '10' }], 'ADDON');
  await grant(c.id, base.priceId);
  const a = await grant(c.id, addon.priceId);
  const key = (
      await db.client.commerceFeature.findUniqueOrThrow({ where: { id: f.id } })
    ).key,
    resolved = await db.client.$transaction((tx) =>
      resolveEntitlements(tx, c.id),
    );
  expect(resolved.features.find((v) => v.key === key)?.value).toBe('20');
  await adminPost('subscriptions/' + a.id + '/renew', {
    revision: a.revision,
    priceId: addon.priceId,
    origin: 'EXTERNAL',
  }).expect(200);
});
it('binds negotiated prices to the intended customer and rejects monetary range overflow before writing a document', async () => {
  const a = await newCustomer(),
    b = await newCustomer(),
    o = await offer();
  const price = (
    await adminPost('prices', {
      versionId: o.versionId,
      customerId: a.customer.id,
      currency: 'USD',
      amount: '12345',
      termDays: 30,
      recurring: true,
      complimentary: false,
    }).expect(200)
  ).body;
  await adminPost('customers/' + b.customer.id + '/subscriptions', {
    priceId: price.id,
    origin: 'EXTERNAL',
    startsAt: new Date().toISOString(),
    renewal: 'MANUAL',
  }).expect(409);
  await grant(a.customer.id, price.id);
  const before = await db.client.commerceInvoice.count({
    where: { customerId: a.customer.id },
  });
  await policy(false, { taxBps: 100 });
  try {
    await adminPost('customers/' + a.customer.id + '/invoices', {
      currency: 'USD',
      subtotal: '999999999999999999999999',
      description: 'Overflow must roll back',
    }).expect(409);
  } finally {
    await policy(false, { taxBps: 0 });
  }
  expect(
    await db.client.commerceInvoice.count({
      where: { customerId: a.customer.id },
    }),
  ).toBe(before);
});

it('accepts only same-scope scanned evidence and retains verified payment history after evidence erasure', async () => {
  const a = await newCustomer(),
    b = await newCustomer(),
    m = await method(),
    sha256 = 'a'.repeat(64);
  const file = await db.client.storedFile.create({
    data: {
      spaceId: a.customer.spaceId,
      ownerUserId: a.actor.id,
      filename: 'Synthetic receipt evidence.txt',
      mimeType: 'text/plain',
      expectedSize: 1,
      actualSize: 1,
      sha256,
      status: 'READY',
      completedAt: new Date(),
      uploadExpiresAt: new Date(Date.now() + 3600000),
      objectKey: randomUUID(),
    },
  });
  const input = {
    methodId: m.id,
    reference: randomUUID(),
    currency: 'USD',
    amount: '1',
    evidenceFileId: file.id,
  };
  await adminPost('customers/' + b.customer.id + '/payments', input).expect(
    404,
  );
  await adminPost('customers/' + a.customer.id + '/payments', input).expect(
    404,
  );
  await db.client.storedFileScan.create({
    data: {
      fileId: file.id,
      sha256,
      engine: 'deterministic-protected-fixture',
      scannedAt: new Date(),
    },
  });
  const p = (
    await adminPost('customers/' + a.customer.id + '/payments', input).expect(
      200,
    )
  ).body;
  await adminPost('payments/' + p.id + '/verify', { approve: true }).expect(
    200,
  );
  await db.client.storedFile.delete({ where: { id: file.id } });
  const retained = await db.client.commercePayment.findUniqueOrThrow({
    where: { id: p.id },
  });
  expect(retained.state).toBe('VERIFIED');
  expect(retained.evidenceFileId).toBe(null);
});
