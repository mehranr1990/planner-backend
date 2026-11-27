import { AuthService } from '../../src/platform/auth/auth.service.js';
import { IdentityMailService } from '../../src/platform/auth/mail.service.js';
import { SystemEmailEvidence } from '../../src/platform/auth/email-evidence.js';
import { AdminDeliveryService } from '../../src/modules/admin-management/admin-delivery.service.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID, createHmac } from 'node:crypto';
import request from 'supertest';
import { hashPassword } from 'better-auth/crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { testApplication } from '../support/application.js';
import { cleanupFixtureIdentities } from '../support/fixture-cleanup.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import { DatabaseService } from '../../src/platform/database/database.service.js';

function code(secret: string) {
  const bits = [...secret]
    .map((c) =>
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
        .indexOf(c)
        .toString(2)
        .padStart(5, '0'),
    )
    .join('');
  const bytes = Buffer.from(
    (bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)),
  );
  const time = Buffer.alloc(8);
  time.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hash = createHmac('sha1', bytes).update(time).digest();
  return String(
    (hash.readUInt32BE(hash[19]! & 15) & 0x7fffffff) % 1000000,
  ).padStart(6, '0');
}
describe('Registration and email delivery diagnostics', () => {
  const url = isolatedTestDatabaseUrl(process.env),
    email = `p1-admin-${randomUUID()}@example.test`,
    userEmail = `p1-user-${randomUUID()}@example.test`,
    password = 'admin-management-test-password!';
  let app: NestExpressApplication,
    db: DatabaseService,
    adminId: string,
    userId: string;
  const diagnosticIds: string[] = [];
  const diagnosticEmails: string[] = [];
  const jar = new Map<string, string>();
  const cookies = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const remember = (response: { headers: Record<string, unknown> }) => {
    for (const raw of (response.headers['set-cookie'] as string[]) ?? []) {
      const pair = raw.split(';')[0]!,
        at = pair.indexOf('=');
      jar.set(pair.slice(0, at), pair.slice(at + 1));
    }
  };
  const post = (path: string, body: object, key = randomUUID()) =>
    request(app.getHttpServer())
      .post('/api/v1/admin/' + path)
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', cookies())
      .set('Idempotency-Key', key)
      .send(body);
  const get = (path: string) =>
    request(app.getHttpServer())
      .get('/api/v1/admin/' + path)
      .set('Cookie', cookies());
  beforeAll(async () => {
    app = await testApplication({ databaseUrl: url });
    db = app.get(DatabaseService);
    const actor = await db.client.adminUser.create({
      data: { email, name: 'Admin fixture', role: 'SUPER_ADMIN' },
    });
    adminId = actor.id;
    await db.client.adminAccount.create({
      data: {
        userId: actor.id,
        accountId: actor.id,
        providerId: 'credential',
        password: await hashPassword(password),
      },
    });
    remember(await post('auth/sign-in/email', { email, password }).expect(200));
    const enrollment = await post('auth/two-factor/enable', {
      password,
    }).expect(200);
    remember(enrollment);
    const secret = new URL(enrollment.body.totpURI as string).searchParams.get(
      'secret',
    )!;
    remember(
      await post('auth/two-factor/verify-totp', { code: code(secret) }).expect(
        200,
      ),
    );
    jar.clear();
    remember(await post('auth/sign-in/email', { email, password }).expect(200));
    remember(
      await post('auth/two-factor/verify-totp', { code: code(secret) }).expect(
        200,
      ),
    );
    const user = await db.client.user.create({
      data: {
        email: userEmail,
        name: 'Ordinary fixture',
        emailVerified: true,
        settings: { create: {} },
        spaces: { create: { kind: 'PERSONAL' } },
      },
      include: { spaces: true },
    });
    userId = user.id;
  });
  afterAll(async () => {
    if (db) {
      await db.client.adminDelivery.deleteMany({
        where: { targetUserId: { in: diagnosticIds } },
      });
      if (userId)
        await db.client.adminDelivery.deleteMany({
          where: { targetUserId: userId },
        });
      if (adminId)
        await db.client.adminMutationReceipt.deleteMany({
          where: { actorAdminId: adminId },
        });
      await db.client.adminBulkOperation.deleteMany({
        where: { actorAdminId: adminId },
      });
      await db.client.adminAuditEvent.deleteMany({
        where: { actorAdminId: adminId },
      });
      if (adminId) await db.client.adminUser.delete({ where: { id: adminId } });
      await cleanupFixtureIdentities(url, {
        emails: [userEmail, ...diagnosticEmails],
      });
    }
    await app?.close();
  });
  async function registration(viaHttp = false) {
    const address = 'diagnostic-' + randomUUID() + '@example.test';
    const body = { name: 'Registration fixture', email: address, password };
    // Only the auth behavior case needs HTTP signup. Other cases provision exact
    // isolated fixture identities through the real provider, preserving public rate limits.
    const data = viaHttp
      ? (
          await request(app.getHttpServer())
            .post('/api/v1/auth/sign-up/email')
            .set('Origin', 'http://localhost:3000')
            .send(body)
            .expect(200)
        ).body
      : await app.get(AuthService).auth.api.signUpEmail({ body });
    const id = data.user.id as string;
    diagnosticIds.push(id);
    diagnosticEmails.push(address);
    return { id, email: address };
  }
  it('records new registration, real verification and successful sign-ins without using active session counts', async () => {
    const user = await registration(true);
    let detail = (await get('users/' + user.id).expect(200)).body;
    expect(detail.registration).toMatchObject({
      verificationStatus: 'UNVERIFIED',
      emailVerifiedAt: null,
      verificationDateEvidence: 'NOT_VERIFIED',
      loginStatus: 'NO_RECORDED_SUCCESS',
      firstSuccessfulLoginAt: null,
      loginHistory: 'COMPLETE',
    });
    let mail = app
      .get(IdentityMailService)
      .latestForTest(user.email, 'verify-email');
    const deadline = Date.now() + 5000;
    while (!mail && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
      mail = app
        .get(IdentityMailService)
        .latestForTest(user.email, 'verify-email');
    }
    expect(mail).toBeDefined();
    const url = new URL(mail!.url);
    url.searchParams.delete('callbackURL');
    await request(app.getHttpServer())
      .get(url.pathname + url.search)
      .expect(200);
    const signed = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-in/email')
      .set('Origin', 'http://localhost:3000')
      .send({ email: user.email, password })
      .expect(200);
    detail = (await get('users/' + user.id).expect(200)).body;
    expect(detail.registration).toMatchObject({
      verificationStatus: 'VERIFIED',
      verificationDateEvidence: 'RECORDED',
      loginStatus: 'RECORDED_SUCCESS',
      loginHistory: 'COMPLETE',
      firstLoginEvidence: 'COMPLETE_HISTORY',
      loginEvidence: 'OBSERVED_AUTH',
    });
    expect(detail.registration.firstSuccessfulLoginAt).toBeTruthy();
    expect(detail.registration.lastSuccessfulLoginAt).toBeTruthy();
    const ordinaryCookie = (signed.headers['set-cookie'] as unknown as string[])
      .map((v) => v.split(';')[0])
      .join('; ');
    const settings = await request(app.getHttpServer())
      .get('/api/v1/me/settings')
      .set('Cookie', ordinaryCookie)
      .expect(200);
    expect(JSON.stringify(settings.body)).not.toMatch(
      /RecordedLogin|signInHistory|signInEvidence|emailVerifiedAt/,
    );
    await db.client.authSession.deleteMany({ where: { userId: user.id } });
    const after = (await get('users/' + user.id).expect(200)).body;
    expect(after.security.activeSessions).toBe(0);
    expect(after.registration).toEqual(detail.registration);
    const matching = await get(
      'users?search=' +
        user.email +
        '&verificationStatus=VERIFIED&loginStatus=RECORDED_SUCCESS&loginHistory=COMPLETE&from=2020-01-01T00:00:00.000Z',
    ).expect(200);
    expect(matching.body.items.map((r: { id: string }) => r.id)).toContain(
      user.id,
    );
    expect(
      (
        await get(
          'users?search=' + user.email + '&verificationStatus=UNVERIFIED',
        ).expect(200)
      ).body.items,
    ).toEqual([]);
    await request(app.getHttpServer())
      .get('/api/v1/admin/system-emails')
      .set('Cookie', ordinaryCookie)
      .expect(401);
  });
  it('preserves unknown legacy history, independent suspension and safe manual verification evidence', async () => {
    await db.client.authSession.create({
      data: {
        userId,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    const before = (await get('users/' + userId).expect(200)).body;
    expect(before.security.activeSessions).toBeGreaterThan(0);
    expect(before.registration).toMatchObject({
      loginStatus: 'NO_RECORDED_SUCCESS',
      loginHistory: 'UNKNOWN',
      firstSuccessfulLoginAt: null,
      lastSuccessfulLoginAt: null,
      firstLoginEvidence: 'UNKNOWN',
      emailVerifiedAt: null,
      verificationDateEvidence: 'UNKNOWN',
    });
    await db.client.userSettings.update({
      where: { userId },
      data: { suspendedAt: new Date(), suspensionReason: 'fixture' },
    });
    expect(
      (
        await get(
          'users?search=' +
            userEmail +
            '&status=SUSPENDED&verificationStatus=VERIFIED&loginStatus=NO_RECORDED_SUCCESS',
        ).expect(200)
      ).body.items,
    ).toHaveLength(1);
    await db.client.userSettings.update({
      where: { userId },
      data: { suspendedAt: null, suspensionReason: null },
    });
    const user = await registration();
    await post('users/' + user.id + '/verify-email', {
      revision: 1,
      reason: 'Reviewed actual verification evidence',
      email: user.email,
    }).expect(200);
    expect(
      (await get('users/' + user.id).expect(200)).body.registration
        .verificationDateEvidence,
    ).toBe('RECORDED');
    expect(
      (await get('users/' + user.id).expect(200)).body.registration
        .emailVerifiedAt,
    ).toBeTruthy();
  });
  it('queues idempotent verification resend, generates fresh proofs in the existing worker and cancels stale recipients', async () => {
    const user = await registration();
    const key = randomUUID(),
      body = { revision: 1, reason: 'Recipient requested verification resend' };
    const responses = await Promise.all([
      post('users/' + user.id + '/resend-verification', body, key),
      post('users/' + user.id + '/resend-verification', body, key),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(
      await db.client.adminDelivery.count({
        where: { targetUserId: user.id, kind: 'EMAIL_VERIFICATION' },
      }),
    ).toBe(1);
    const delivery = await db.client.adminDelivery.findFirstOrThrow({
      where: { targetUserId: user.id, kind: 'EMAIL_VERIFICATION' },
    });
    expect(JSON.stringify(delivery.payload)).not.toMatch(
      /token|https?:|proof/i,
    );
    for (let n = 0; n < 20; n++) {
      if (
        (
          await db.client.adminDelivery.findUniqueOrThrow({
            where: { id: delivery.id },
          })
        ).state === 'SENT'
      )
        break;
      await app.get(AdminDeliveryService).consume();
    }
    expect(
      (
        await db.client.adminDelivery.findUniqueOrThrow({
          where: { id: delivery.id },
        })
      ).state,
    ).toBe('SENT');
    const observed = await db.client.systemEmailObservation.findFirstOrThrow({
      where: { sourceId: delivery.id },
    });
    expect(observed).toMatchObject({
      state: 'SINK_ACCEPTED',
      category: 'REGISTRATION_VERIFICATION',
      recipient: user.email,
    });
    const logs = await get(
      'system-emails?userId=' + user.id + '&category=REGISTRATION_VERIFICATION',
    ).expect(200);
    expect(
      logs.body.items.some(
        (r: { sourceId: string }) => r.sourceId === delivery.id,
      ),
    ).toBe(true);
    expect(JSON.stringify(logs.body)).not.toMatch(
      /token|url|password|message.*body|encryptedProof/i,
    );
    await post(
      'users/' + user.id + '/resend-verification',
      { ...body, revision: 2 },
      key,
    ).expect(409);
    const next = await post('users/' + user.id + '/resend-verification', {
      ...body,
      revision: 2,
    }).expect(200);
    expect(next.body.action).toBe('RESEND_VERIFICATION');
    expect((await get('users/' + user.id).expect(200)).body.revision).toBe(3);
    await db.client.user.update({
      where: { id: user.id },
      data: { email: 'changed-' + user.email },
    });
    diagnosticEmails.push('changed-' + user.email);
    for (let n = 0; n < 20; n++) {
      const pending = await db.client.adminDelivery.findFirst({
        where: { targetUserId: user.id, state: 'PENDING' },
      });
      if (!pending) break;
      await app.get(AdminDeliveryService).consume();
    }
    expect(
      await db.client.adminDelivery.count({
        where: { targetUserId: user.id, state: 'CANCELED' },
      }),
    ).toBe(1);
  });
  it('bounds and authorizes system mail search, distinguishes observed acceptance from legacy SENT and unknown creation', async () => {
    const evidence = app.get(SystemEmailEvidence);
    const states = ['SMTP_ACCEPTED', 'FAILED', 'UNKNOWN'] as const;
    for (const state of states)
      await evidence.observe(
        userEmail,
        { category: 'SYSTEM_NOTICE', userId },
        async () => ({
          state,
          code:
            state === 'SMTP_ACCEPTED'
              ? 'SMTP_ACCEPTED'
              : state === 'FAILED'
                ? 'SMTP_REJECTED'
                : 'SMTP_ACCEPTANCE_UNKNOWN',
          providerReference: '<opaque@fixture.test>',
        }),
      );
    const audit = await db.client.adminAuditEvent.create({
      data: {
        action: 'DIAGNOSTIC_FIXTURE',
        outcome: 'SUCCEEDED',
        requestId: randomUUID(),
      },
    });
    await db.client.adminDelivery.create({
      data: {
        auditId: audit.id,
        targetUserId: userId,
        kind: 'ACCOUNT_CHANGED',
        payload: {},
        state: 'SENT',
      },
    });
    const legacy = await get(
      'system-emails?userId=' +
        userId +
        '&sourceKind=ADMIN_DELIVERY&status=UNKNOWN',
    ).expect(200);
    expect(
      legacy.body.items.some(
        (r: { deliveryEvidence: string }) =>
          r.deliveryEvidence === 'SOURCE_STATE_ONLY',
      ),
    ).toBe(true);
    const accepted = await get(
      'system-emails?search=' + userEmail + '&status=SMTP_ACCEPTED&limit=1',
    ).expect(200);
    expect(accepted.body.items[0]).toMatchObject({
      status: 'SMTP_ACCEPTED',
      inboxDelivery: 'UNKNOWN',
      providerMessageReference: '<opaque@fixture.test>',
      recipientEvidence: 'OBSERVED',
    });
    expect(
      (await get('system-emails/' + accepted.body.items[0].id).expect(200))
        .body,
    ).toEqual(accepted.body.items[0]);
    let cursor: string | null = null;
    const seen = new Set<string>();
    let pages = 0;
    do {
      const page: {
        body: { items: { id: string }[]; nextCursor: string | null };
      } = await get(
        'system-emails?userId=' +
          userId +
          '&limit=1' +
          (cursor ? '&cursor=' + cursor : ''),
      ).expect(200);
      for (const row of page.body.items) {
        expect(seen.has(row.id)).toBe(false);
        seen.add(row.id);
      }
      cursor = page.body.nextCursor;
      if (++pages > 20) throw Error('Unbounded mail cursor');
    } while (cursor);
    expect(seen.size).toBeGreaterThanOrEqual(4);
    await get('system-emails?limit=101').expect(400);
    await get('system-emails?search=%00').expect(400);
    await get('system-emails?userId=' + userId + '&body=private').expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/admin/system-emails')
      .expect(401);
    try {
      await db.client.adminUser.update({
        where: { id: adminId },
        data: { role: 'SUPPORT' },
      });
      await get('system-emails').expect(403);
    } finally {
      await db.client.adminUser.update({
        where: { id: adminId },
        data: { role: 'SUPER_ADMIN' },
      });
    }
  });
  it('retains only safe metadata, expires observations and follows source deletion', async () => {
    const evidence = app.get(SystemEmailEvidence);
    const old = await db.client.systemEmailObservation.create({
      data: {
        sourceKind: 'DIRECT',
        sourceId: randomUUID(),
        category: 'SYSTEM_NOTICE',
        userId,
        recipient: userEmail,
        state: 'FAILED',
        code: 'MAIL_TRANSPORT_FAILED',
        createdAt: new Date(Date.now() - 31 * 86400000),
      },
    });
    const stuck = await db.client.systemEmailObservation.create({
      data: {
        sourceKind: 'DIRECT',
        sourceId: randomUUID(),
        category: 'SYSTEM_NOTICE',
        userId,
        recipient: userEmail,
        state: 'PROCESSING',
        createdAt: new Date(Date.now() - 180000),
      },
    });
    await evidence.sweep(30);
    expect(
      await db.client.systemEmailObservation.findUnique({
        where: { id: old.id },
      }),
    ).toBeNull();
    expect(
      (
        await db.client.systemEmailObservation.findUniqueOrThrow({
          where: { id: stuck.id },
        })
      ).state,
    ).toBe('UNKNOWN');
    const audit = await db.client.adminAuditEvent.create({
      data: {
        action: 'DIAGNOSTIC_FIXTURE',
        outcome: 'SUCCEEDED',
        requestId: randomUUID(),
      },
    });
    const delivery = await db.client.adminDelivery.create({
      data: {
        auditId: audit.id,
        targetUserId: userId,
        kind: 'ACCOUNT_CHANGED',
        payload: {},
        state: 'FAILED',
      },
    });
    await evidence.observe(
      userEmail,
      {
        sourceKind: 'ADMIN_DELIVERY',
        sourceId: delivery.id,
        category: 'SYSTEM_NOTICE',
        userId,
      },
      async () => ({ state: 'FAILED', code: 'SMTP_REJECTED' }),
    );
    await db.client.adminDelivery.delete({ where: { id: delivery.id } });
    expect(
      await db.client.systemEmailObservation.count({
        where: { sourceId: delivery.id },
      }),
    ).toBe(0);
  });
  it('regenerates recovery proofs through the owner workflow and replays only the idempotent acknowledgement', async () => {
    const user = await registration();
    await post('users/' + user.id + '/verify-email', {
      revision: 1,
      reason: 'Reviewed current email evidence',
      email: user.email,
    }).expect(200);
    await post('users/' + user.id + '/recovery', {
      revision: 2,
      reason: 'Recipient requested recovery',
    }).expect(200);
    for (let n = 0; n < 20; n++) {
      const item = await db.client.adminDelivery.findFirst({
        where: { targetUserId: user.id, state: 'PENDING' },
      });
      if (!item) break;
      await app.get(AdminDeliveryService).consume();
    }
    const first = app
      .get(IdentityMailService)
      .latestForTest(user.email, 'reset-password')!;
    expect(first).toBeDefined();
    const logs = await get(
      'system-emails?userId=' + user.id + '&category=PASSWORD_RECOVERY',
    ).expect(200);
    const log = logs.body.items.find((r: { retryActions: string[] }) =>
      r.retryActions.includes('RECOVERY'),
    );
    expect(log).toBeDefined();
    const key = randomUUID(),
      body = {
        action: 'RECOVERY',
        revision: 3,
        reason: 'Recipient requested another recovery proof',
      };
    const result = await post(
      'system-emails/' + log.id + '/retry',
      body,
      key,
    ).expect(200);
    expect(
      (await post('system-emails/' + log.id + '/retry', body, key).expect(200))
        .body,
    ).toEqual(result.body);
    expect(
      await db.client.adminDelivery.count({
        where: { targetUserId: user.id, kind: 'PASSWORD_RECOVERY' },
      }),
    ).toBe(2);
    for (let n = 0; n < 20; n++) {
      const item = await db.client.adminDelivery.findFirst({
        where: { targetUserId: user.id, state: 'PENDING' },
      });
      if (!item) break;
      await app.get(AdminDeliveryService).consume();
    }
    const fresh = app
      .get(IdentityMailService)
      .latestForTest(user.email, 'reset-password')!;
    expect(fresh.url).not.toBe(first.url);
    expect(JSON.stringify(result.body)).not.toMatch(/token|proof|https?:/i);
    await post('system-emails/' + log.id + '/retry', {
      action: 'RETRY_NOTICE',
      attempts: 1,
      reason: 'Wrong source action',
    }).expect(409);
  });
  it('requires fresh MFA and the explicit verification permission; throttles actual queued resends without charging replays', async () => {
    const user = await registration();
    const sessions = await db.client.adminSession.findMany({
      where: { userId: adminId },
      select: { id: true, mfaVerifiedAt: true },
    });
    try {
      await db.client.adminSession.updateMany({
        where: { userId: adminId },
        data: { mfaVerifiedAt: new Date(Date.now() - 360000) },
      });
      await post('users/' + user.id + '/resend-verification', {
        revision: 1,
        reason: 'Expired MFA must deny',
      }).expect(403);
    } finally {
      for (const session of sessions)
        await db.client.adminSession.update({
          where: { id: session.id },
          data: { mfaVerifiedAt: session.mfaVerifiedAt },
        });
    }
    try {
      await db.client.adminUser.update({
        where: { id: adminId },
        data: { role: 'SUPPORT' },
      });
      await get('users/' + user.id).expect(200);
      await get('system-emails').expect(403);
      await post('users/' + user.id + '/verify-email', {
        revision: 1,
        reason: 'Support cannot manually verify',
        email: user.email,
      }).expect(403);
      const key = randomUUID(),
        body = { revision: 1, reason: 'Supported verification resend' };
      const accepted = await post(
        'users/' + user.id + '/resend-verification',
        body,
        key,
      ).expect(200);
      expect(
        (
          await post(
            'users/' + user.id + '/resend-verification',
            body,
            key,
          ).expect(200)
        ).body,
      ).toEqual(accepted.body);
      for (const revision of [2, 3])
        await post('users/' + user.id + '/resend-verification', {
          revision,
          reason: 'Recipient requested another resend',
        }).expect(200);
      await post('users/' + user.id + '/resend-verification', {
        revision: 4,
        reason: 'Fourth recipient resend must throttle',
      }).expect(403);
      expect(
        await db.client.adminDelivery.count({
          where: { targetUserId: user.id, kind: 'EMAIL_VERIFICATION' },
        }),
      ).toBe(3);
      await post('users/' + user.id + '/resend-verification', {
        revision: 4,
        reason: 'No address mass assignment',
        email: 'foreign@example.test',
      }).expect(400);
    } finally {
      await db.client.adminUser.update({
        where: { id: adminId },
        data: { role: 'SUPER_ADMIN' },
      });
    }
  });

  it('retries a known failed plain notice with a new durable delivery, preserving the original attempt count', async () => {
    const audit = await db.client.adminAuditEvent.create({
      data: {
        action: 'DIAGNOSTIC_FIXTURE',
        outcome: 'SUCCEEDED',
        requestId: randomUUID(),
      },
    });
    const original = await db.client.adminDelivery.create({
      data: {
        auditId: audit.id,
        targetUserId: userId,
        kind: 'ACCOUNT_CHANGED',
        payload: { reason: 'Safe account notice' },
        state: 'FAILED',
        attempts: 8,
      },
    });
    await app.get(SystemEmailEvidence).observe(
      userEmail,
      {
        sourceKind: 'ADMIN_DELIVERY',
        sourceId: original.id,
        category: 'SYSTEM_NOTICE',
        userId,
      },
      async () => ({ state: 'FAILED', code: 'SMTP_REJECTED' }),
    );
    const page = await get(
      'system-emails?userId=' +
        userId +
        '&sourceKind=ADMIN_DELIVERY&status=FAILED',
    ).expect(200);
    const row = page.body.items.find(
      (r: { sourceId: string }) => r.sourceId === original.id,
    );
    expect(row.retryActions).toContain('RETRY_NOTICE');
    const key = randomUUID(),
      body = {
        action: 'RETRY_NOTICE',
        attempts: 8,
        reason: 'Operator requested retry after rejection',
      };
    const result = await post(
      'system-emails/' + row.id + '/retry',
      body,
      key,
    ).expect(200);
    expect(result.body.queuedDeliveryId).not.toBe(original.id);
    expect(
      (await post('system-emails/' + row.id + '/retry', body, key).expect(200))
        .body,
    ).toEqual(result.body);
    expect(
      await db.client.adminDelivery.findUniqueOrThrow({
        where: { id: original.id },
      }),
    ).toMatchObject({ state: 'CANCELED', attempts: 8 });
    expect(
      await db.client.adminDelivery.findUniqueOrThrow({
        where: { id: result.body.queuedDeliveryId },
      }),
    ).toMatchObject({ state: 'PENDING', attempts: 0, targetUserId: userId });
    diagnosticIds.push(userId);
  });
});
