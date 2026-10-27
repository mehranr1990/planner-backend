import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { testApplication } from '../support/application.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import { DatabaseService } from '../../src/platform/database/database.service.js';
import { IdentityMailService } from '../../src/platform/auth/mail.service.js';
import { SpacesService } from '../../src/modules/spaces/public/index.js';
import { AuthorizedSpace } from '../../src/platform/authorization/authorized-space.js';
import { idempotent } from '../../src/platform/database/idempotency.js';
import { serializable } from '../../src/platform/database/transaction.js';
import { scopedWhere } from '../../src/platform/database/scoped-where.js';
import {
  cursorPage,
  cursorPosition,
} from '../../src/platform/database/cursor-pagination.js';
import { appendOutbox } from '../../src/platform/outbox/outbox.js';
import {
  AuditService,
  writeAudit,
} from '../../src/platform/audit/audit.service.js';

const databaseUrl = isolatedTestDatabaseUrl(process.env);
const origin = 'http://localhost:3000';
describe('P0-03 transactions, API and reliability', () => {
  let app: NestExpressApplication;
  let db: DatabaseService;
  const users: string[] = [];
  const requestIds: string[] = [];
  async function fixture() {
    const user = await db.client.user.create({
      data: {
        name: 'Reliability fixture',
        email: `p003-${randomUUID()}@example.test`,
        emailVerified: true,
        settings: { create: {} },
        spaces: { create: {} },
      },
      include: { spaces: true },
    });
    users.push(user.id);
    const actor = Object.freeze({
      userId: user.id,
      requestId: randomUUID(),
      correlationId: randomUUID(),
    });
    requestIds.push(actor.requestId);
    return {
      user,
      actor,
      scope: AuthorizedSpace.personal(actor, user.spaces[0]!),
    };
  }
  beforeAll(async () => {
    app = await testApplication({ databaseUrl });
    db = app.get(DatabaseService);
  });
  afterAll(async () => {
    if (db) {
      await db.client.securityAuditEvent.deleteMany({
        where: {
          OR: [
            { actorUserId: { in: users } },
            { requestId: { in: requestIds } },
          ],
        },
      });
      await db.client.user.deleteMany({ where: { id: { in: users } } });
    }
    await app?.close();
  });

  it('atomically rolls back state, audit and outbox on failure', async () => {
    const { user, actor, scope } = await fixture();
    await expect(
      db.client.$transaction(async (tx) => {
        await tx.userSettings.update({
          where: { userId: user.id },
          data: { revision: { increment: 1 }, timezone: 'Asia/Tehran' },
        });
        await appendOutbox(tx, scope, {
          type: 'account.timezone_changed',
          version: 1,
          aggregateId: user.id,
          payload: {},
        });
        await writeAudit(tx, {
          action: 'ACCOUNT_SETTINGS_UPDATE',
          outcome: 'SUCCEEDED',
          actorUserId: user.id,
          requestId: actor.requestId,
          correlationId: actor.correlationId,
        });
        throw new Error('fixture rollback');
      }),
    ).rejects.toThrow('fixture rollback');
    expect(
      (
        await db.client.userSettings.findUniqueOrThrow({
          where: { userId: user.id },
        })
      ).revision,
    ).toBe(1);
    expect(
      await db.client.outboxEvent.count({ where: { spaceId: scope.spaceId } }),
    ).toBe(0);
    expect(
      await db.client.securityAuditEvent.count({
        where: { requestId: actor.requestId },
      }),
    ).toBe(0);
  });

  it('survives an actual process crash after commit and rolls back a crash before commit', async () => {
    const { user, scope, actor } = await fixture();
    for (const point of ['before', 'after']) {
      const eventId = randomUUID();
      const exit = await new Promise<number | null>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          ['tooling/testing/outbox-crash.ts'],
          {
            env: {
              ...process.env,
              TEST_DATABASE_URL: databaseUrl,
              P003_CRASH_POINT: point,
              P003_CRASH_IDS: [
                user.id,
                scope.spaceId,
                eventId,
                actor.correlationId,
              ].join(','),
            },
            stdio: 'ignore',
          },
        );
        child.on('error', reject);
        child.on('exit', resolve);
      });
      expect(exit).toBe(point === 'before' ? 41 : 42);
      const fresh = await testApplication({ databaseUrl });
      try {
        const persisted = fresh.get(DatabaseService).client;
        expect(
          await persisted.outboxEvent.count({ where: { id: eventId } }),
        ).toBe(point === 'before' ? 0 : 1);
        expect(
          (
            await persisted.userSettings.findUniqueOrThrow({
              where: { userId: user.id },
            })
          ).revision,
        ).toBe(point === 'before' ? 1 : 2);
      } finally {
        await fresh.close();
      }
    }
  });

  it('serializes concurrent idempotency retries, binds payload/actor/scope and stores no raw key/body', async () => {
    const a = await fixture();
    const b = await fixture();
    const key = 'private-client-key-' + randomUUID();
    let effects = 0;
    const run = (scope: AuthorizedSpace, body: unknown) =>
      idempotent(
        db.client,
        scope,
        'settings.test-change',
        key,
        body,
        async (tx) => {
          effects++;
          await tx.userSettings.update({
            where: { userId: scope.actor.userId },
            data: { revision: { increment: 1 } },
          });
          const event = await appendOutbox(tx, scope, {
            type: 'account.timezone_changed',
            version: 1,
            aggregateId: scope.actor.userId,
            payload: {},
          });
          return { resultId: event.id, statusCode: 200 };
        },
      );
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        run(a.scope, { locale: 'fa', timezone: 'UTC' }),
      ),
    );
    expect(new Set(results.map((value) => value.resultId)).size).toBe(1);
    expect(results.filter((value) => !value.replayed)).toHaveLength(1);
    expect(effects).toBe(1);
    expect(
      (await run(a.scope, { timezone: 'UTC', locale: 'fa' })).replayed,
    ).toBe(true);
    await expect(
      run(a.scope, { timezone: 'Asia/Tehran', locale: 'fa' }),
    ).rejects.toThrow('Conflict');
    const ownB = await run(b.scope, { timezone: 'UTC', locale: 'fa' });
    expect(ownB.resultId).not.toBe(results[0]!.resultId);
    const stored = await db.client.idempotencyRecord.findFirstOrThrow({
      where: { actorUserId: a.user.id },
    });
    expect(JSON.stringify(stored)).not.toContain(key);
    expect(stored.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(
      (
        await db.client.userSettings.findUniqueOrThrow({
          where: { userId: a.user.id },
        })
      ).revision,
    ).toBe(2);
    // Same key with a new operation is independent, not a response replay.
    const distinct = await idempotent(
      db.client,
      a.scope,
      'settings.other-operation',
      key,
      {},
      async () => ({ resultId: randomUUID(), statusCode: 201 }),
    );
    expect(distinct.replayed).toBe(false);
  });

  it('rolls back failed idempotent work, permits retry and expires receipts after the documented window', async () => {
    const { scope, user } = await fixture();
    const key = randomUUID();
    await expect(
      idempotent(db.client, scope, 'settings.retry', key, {}, async (tx) => {
        await tx.userSettings.update({
          where: { userId: user.id },
          data: { revision: { increment: 1 } },
        });
        throw new Error('fixture failure');
      }),
    ).rejects.toThrow('fixture failure');
    expect(
      await db.client.idempotencyRecord.count({
        where: { actorUserId: user.id },
      }),
    ).toBe(0);
    expect(
      (
        await db.client.userSettings.findUniqueOrThrow({
          where: { userId: user.id },
        })
      ).revision,
    ).toBe(1);
    const first = await idempotent(
      db.client,
      scope,
      'settings.retry',
      key,
      {},
      async () => ({ resultId: randomUUID(), statusCode: 200 }),
    );
    await db.client.idempotencyRecord.updateMany({
      where: { actorUserId: user.id },
      data: {
        createdAt: new Date(Date.now() - 2 * 86400000),
        expiresAt: new Date(Date.now() - 86400000),
      },
    });
    const next = await idempotent(
      db.client,
      scope,
      'settings.retry',
      key,
      { new: 'request' },
      async () => ({ resultId: randomUUID(), statusCode: 200 }),
    );
    expect(next.replayed).toBe(false);
    expect(next.resultId).not.toBe(first.resultId);
    for (const invalid of ['', 'x'.repeat(129), 'unsafe\nkey'])
      await expect(
        idempotent(
          db.client,
          scope,
          'settings.retry',
          invalid,
          {},
          async () => ({ resultId: randomUUID(), statusCode: 200 }),
        ),
      ).rejects.toThrow('Bad Request');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const invalid of [
      cyclic,
      { number: NaN },
      { token: 'x'.repeat(131073) },
    ])
      await expect(
        idempotent(
          db.client,
          scope,
          'settings.retry',
          key,
          invalid,
          async () => ({ resultId: randomUUID(), statusCode: 200 }),
        ),
      ).rejects.toThrow('Bad Request');
  });

  it('enforces owner linkage and receipt/event constraints in PostgreSQL', async () => {
    const a = await fixture();
    const b = await fixture();
    await expect(
      db.client.idempotencyRecord.create({
        data: {
          actorUserId: a.user.id,
          spaceId: b.scope.spaceId,
          operation: 'fixture',
          keyHash: 'a'.repeat(64),
          fingerprint: 'b'.repeat(64),
          resultId: randomUUID(),
          statusCode: 200,
          expiresAt: new Date(Date.now() + 10000),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      db.client.idempotencyRecord.create({
        data: {
          actorUserId: a.user.id,
          spaceId: a.scope.spaceId,
          operation: 'fixture',
          keyHash: 'a'.repeat(64),
          fingerprint: 'b'.repeat(64),
          resultId: randomUUID(),
          statusCode: 500,
          expiresAt: new Date(Date.now() + 10000),
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.client.userSettings.update({
        where: { userId: a.user.id },
        data: { revision: 0 },
      }),
    ).rejects.toThrow();
    await expect(
      db.client.outboxEvent.create({
        data: {
          type: 'fixture',
          version: 0,
          aggregateId: a.user.id,
          spaceId: a.scope.spaceId,
          correlationId: a.actor.correlationId,
          payload: {},
        },
      }),
    ).rejects.toThrow();
    expect(() =>
      app.get(AuditService).record({
        action: 'ACCOUNT_PROFILE_UPDATE',
        outcome: 'SUCCEEDED',
        requestId: a.actor.requestId,
        correlationId: a.actor.correlationId,
        changedFields: ['password' as 'name'],
      }),
    ).toThrow();
  });

  it('paginates tied timestamps deterministically without scope override, duplicates or cursor leakage', async () => {
    const a = await fixture();
    const b = await fixture();
    const at = new Date();
    for (const scope of [a.scope, b.scope])
      await db.client.outboxEvent.createMany({
        data: Array.from({ length: 5 }, () => ({
          id: randomUUID(),
          type: 'account.timezone_changed',
          version: 1,
          occurredAt: at,
          aggregateId: scope.actor.userId,
          spaceId: scope.spaceId,
          correlationId: scope.actor.correlationId,
          payload: {},
        })),
      });
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const position = cursorPosition(a.scope, 'all', cursor);
      const after = position
        ? {
            OR: [
              { occurredAt: { gt: position.createdAt } },
              { occurredAt: position.createdAt, id: { gt: position.id } },
            ],
          }
        : {};
      const rows = await db.client.outboxEvent.findMany({
        where: scopedWhere(a.scope, after),
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        take: 3,
      });
      expect(rows.every((row) => row.spaceId === a.scope.spaceId)).toBe(true);
      const page = cursorPage(
        a.scope,
        'all',
        2,
        rows.map((row) => ({ id: row.id, createdAt: row.occurredAt })),
      );
      seen.push(...page.items.map((row) => row.id));
      cursor = page.nextCursor ?? undefined;
      if (cursor)
        expect(() => cursorPosition(b.scope, 'all', cursor)).toThrow(
          'Bad Request',
        );
    } while (cursor);
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect(
      await db.client.outboxEvent.count({
        where: scopedWhere(a.scope, { spaceId: b.scope.spaceId }),
      }),
    ).toBe(0);
  });

  it('retries a real PostgreSQL serialization conflict without losing either update', async () => {
    const { user } = await fixture();
    let attempts = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const work = () =>
      serializable(db.client, async (tx) => {
        const current = await tx.userSettings.findUniqueOrThrow({
          where: { userId: user.id },
        });
        const attempt = ++attempts;
        if (attempt === 2) release();
        if (attempt <= 2) await barrier;
        return tx.userSettings.update({
          where: { userId: user.id },
          data: { revision: current.revision + 1 },
        });
      });
    await Promise.all([work(), work()]);
    expect(attempts).toBeGreaterThanOrEqual(3);
    expect(
      (
        await db.client.userSettings.findUniqueOrThrow({
          where: { userId: user.id },
        })
      ).revision,
    ).toBe(3);
  });

  it('preserves HTTP contracts, rejects stale writes, and emits only committed metadata with authenticated context', async () => {
    const email = `p003-${randomUUID()}@example.test`;
    const password = 'test-only-P003-password-123!';
    const signupId = randomUUID();
    requestIds.push(signupId);
    const signup = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-up/email')
      .set('Origin', origin)
      .set('X-Request-Id', signupId)
      .send({ name: 'HTTP fixture', email, password })
      .expect(200);
    const userId = signup.body.user.id as string;
    users.push(userId);
    const url = new URL(
      app.get(IdentityMailService).latestForTest(email, 'verify-email')!.url,
    );
    url.searchParams.delete('callbackURL');
    const verifyId = randomUUID();
    requestIds.push(verifyId);
    const invalidRedirectId = randomUUID();
    requestIds.push(invalidRedirectId);
    const invalidLink = new URL('/api/v1/auth/verify-email', origin);
    invalidLink.searchParams.set('token', 'invalid-fixture-token');
    invalidLink.searchParams.set('callbackURL', '/verified');
    const invalidRedirect = await request(app.getHttpServer())
      .get(invalidLink.pathname + invalidLink.search)
      .set('X-Request-Id', invalidRedirectId)
      .expect(302);
    expect(invalidRedirect.headers.location).toContain('error=');
    expect(
      await db.client.securityAuditEvent.findFirst({
        where: {
          requestId: invalidRedirectId,
          action: 'AUTH_VERIFY_EMAIL',
          outcome: 'DENIED',
        },
      }),
    ).not.toBeNull();
    await request(app.getHttpServer())
      .get(url.pathname + url.search)
      .set('X-Request-Id', verifyId)
      .expect(200);
    const loginId = randomUUID();
    requestIds.push(loginId);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-in/email')
      .set('Origin', origin)
      .set('X-Request-Id', loginId)
      .send({ email, password })
      .expect(200);
    const cookie = (login.headers['set-cookie'] as unknown as string[])
      .map((value) => value.split(';')[0])
      .join('; ');
    const profileId = randomUUID();
    requestIds.push(profileId);
    await request(app.getHttpServer())
      .patch('/api/v1/me')
      .set('Origin', origin)
      .set('Cookie', cookie)
      .set('X-Request-Id', profileId)
      .send({ name: 'Private profile value' })
      .expect(200);
    const profileAudit = await db.client.securityAuditEvent.findFirstOrThrow({
      where: { requestId: profileId },
    });
    expect(profileAudit.changedFields).toEqual(['name']);
    expect(profileAudit.outcome).toBe('SUCCEEDED');
    expect(JSON.stringify(profileAudit)).not.toContain('Private profile value');
    const before = await request(app.getHttpServer())
      .get('/api/v1/me/settings')
      .set('Cookie', cookie)
      .expect(200);
    expect(Object.keys(before.body).sort()).toEqual([
      'firstDayOfWeek',
      'locale',
      'preferredCalendar',
      'timezone',
    ]);
    const correlation = randomUUID();
    const mutationIds = [randomUUID(), randomUUID()];
    requestIds.push(...mutationIds);
    const mutations = await Promise.all(
      ['Asia/Tehran', 'Europe/London'].map((timezone, index) =>
        request(app.getHttpServer())
          .patch('/api/v1/me/settings')
          .set('Origin', origin)
          .set('Cookie', cookie)
          .set('If-Match', before.headers.etag!)
          .set('X-Request-Id', mutationIds[index]!)
          .set('X-Correlation-Id', correlation)
          .send({ timezone }),
      ),
    );
    expect(mutations.map((value) => value.status).sort()).toEqual([200, 409]);
    const space = await app.get(SpacesService).personalFor(userId);
    const events = await db.client.outboxEvent.findMany({
      where: { spaceId: space.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.correlationId).toBe(correlation);
    expect(events[0]!.payload).toEqual({});
    const audit = await db.client.securityAuditEvent.findMany({
      where: { requestId: { in: mutationIds } },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorUserId).toBe(userId);
    expect(audit[0]!.changedFields).toEqual(['timezone']);
    const sensitive = JSON.stringify(
      await db.client.securityAuditEvent.findMany({
        where: {
          requestId: { in: [signupId, loginId, verifyId, ...mutationIds] },
        },
      }),
    );
    expect(sensitive).not.toContain(email);
    expect(sensitive).not.toContain(password);
    expect(sensitive).not.toContain(login.body.token);
    await request(app.getHttpServer())
      .patch('/api/v1/me/settings')
      .set('Origin', origin)
      .set('Cookie', cookie)
      .set('If-Match', 'W/"2"')
      .send({ locale: 'en' })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/api/v1/me/settings')
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send({ locale: 'fa' })
      .expect(200);
    const deniedId = randomUUID();
    requestIds.push(deniedId);
    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('X-Request-Id', deniedId)
      .set('X-User-Id', userId)
      .expect(401);
    expect(
      await db.client.securityAuditEvent.findFirst({
        where: {
          requestId: deniedId,
          action: 'ACCESS_DENIED',
          outcome: 'DENIED',
        },
      }),
    ).not.toBeNull();
    const signoutId = randomUUID();
    requestIds.push(signoutId);
    await request(app.getHttpServer())
      .post('/api/v1/auth/sign-out')
      .set('Origin', origin)
      .set('Cookie', cookie)
      .set('X-Request-Id', signoutId)
      .send({})
      .expect(200);
    expect(
      await db.client.securityAuditEvent.findFirst({
        where: {
          requestId: signoutId,
          actorUserId: userId,
          outcome: 'SUCCEEDED',
        },
      }),
    ).not.toBeNull();
    const failedLoginId = randomUUID();
    requestIds.push(failedLoginId);
    await request(app.getHttpServer())
      .post('/api/v1/auth/sign-in/email')
      .set('Origin', origin)
      .set('X-Request-Id', failedLoginId)
      .send({ email, password: 'wrong-test-password' })
      .expect(401);
    expect(
      await db.client.securityAuditEvent.findFirst({
        where: {
          requestId: failedLoginId,
          action: 'AUTH_SIGN_IN',
          outcome: 'DENIED',
        },
      }),
    ).not.toBeNull();
    const beforeSessions = await db.client.authSession.count({
      where: { userId },
    });
    const auditSpy = vi
      .spyOn(app.get(AuditService), 'record')
      .mockRejectedValueOnce(new Error('fixture audit outage'));
    try {
      await request(app.getHttpServer())
        .post('/api/v1/auth/sign-in/email')
        .set('Origin', origin)
        .send({ email, password })
        .expect(500);
      expect(await db.client.authSession.count({ where: { userId } })).toBe(
        beforeSessions,
      );
    } finally {
      auditSpy.mockRestore();
    }
  });
});
