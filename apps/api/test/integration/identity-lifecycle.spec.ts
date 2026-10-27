import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { testApplication } from '../support/application.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import { IdentityMailService } from '../../src/platform/auth/mail.service.js';
import { DatabaseService } from '../../src/platform/database/database.service.js';
import { SpacesService } from '../../src/modules/spaces/public/index.js';
import { initialAccountRelations } from '../../src/modules/account/public/index.js';
import { initialSpaceRelations } from '../../src/modules/spaces/public/index.js';
import { identityClient } from '../../src/platform/auth/identity-relations.js';
import { createEmailVerificationToken } from 'better-auth/api';
import { APP_CONFIG } from '../../src/bootstrap/configuration.module.js';
import type { AppConfig } from '../../src/bootstrap/environment.js';

const origin = 'http://localhost:3000';
const databaseUrl = isolatedTestDatabaseUrl(process.env);
const password = 'test-only-original-password-123!';
const newPassword = 'test-only-replacement-password-456!';

describe('identity lifecycle, isolation and concurrency', () => {
  let app: NestExpressApplication;
  let database: DatabaseService;
  let mail: IdentityMailService;
  const created: string[] = [];
  let clock = Date.now();
  const tick = (ms = 61000) => {
    clock += ms;
    vi.mocked(Date.now).mockReturnValue(clock);
  };
  beforeAll(async () => {
    app = await testApplication({ databaseUrl });
    database = app.get(DatabaseService);
    mail = app.get(IdentityMailService);
  });
  // Only the clock used by the real library's rate limiter changes. Security is
  // never disabled; separate scenarios start in a new rate-limit window.
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue((clock += 61000));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    if (database) {
      await database.client.authVerification.deleteMany({
        where: { value: { in: created } },
      });
      await database.client.user.deleteMany({ where: { id: { in: created } } });
    }
    await app?.close();
  });
  const post = (route: string, body: object, cookie?: string) => {
    const call = request(app.getHttpServer())
      .post('/api/v1/auth' + route)
      .set('Origin', origin);
    if (cookie) call.set('Cookie', cookie);
    return call.send(body);
  };
  const verify = async (url: string) => {
    const link = new URL(url);
    link.searchParams.delete('callbackURL');
    return request(app.getHttpServer()).get(link.pathname + link.search);
  };
  async function signup() {
    const email = `p002-${randomUUID()}@example.test`;
    const response = await post('/sign-up/email', {
      name: 'Test identity',
      email,
      password,
    }).expect(200);
    const id = response.body.user.id as string;
    created.push(id);
    expect(
      (await verify(mail.latestForTest(email, 'verify-email')!.url)).status,
    ).toBe(200);
    expect(
      (await database.client.user.findUniqueOrThrow({ where: { id } }))
        .emailVerified,
    ).toBe(true);
    return { email, id };
  }
  async function login(email: string, pass = password) {
    const response = await post('/sign-in/email', {
      email,
      password: pass,
    }).expect(200);
    return {
      cookie: (response.headers['set-cookie'] as unknown as string[])
        .map((value) => value.split(';')[0])
        .join('; '),
      token: response.body.token as string,
    };
  }

  it('persists sessions across API recreation and scopes session listing/revocation to the actor', async () => {
    const a = await signup();
    const b = await signup();
    const a1 = await login(a.email);
    const a2 = await login(a.email);
    const b1 = await login(b.email);
    const listed = await request(app.getHttpServer())
      .get('/api/v1/auth/list-sessions')
      .set('Cookie', a1.cookie)
      .expect(200);
    expect(
      listed.body.map((session: { userId: string }) => session.userId),
    ).toEqual([a.id, a.id]);
    await post('/revoke-session', { token: b1.token }, a1.cookie).expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Cookie', b1.cookie)
      .expect(200);
    await post('/revoke-session', { token: a2.token }, a1.cookie).expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Cookie', a2.cookie)
      .expect(401);
    tick(11000);
    const another = await login(a.email);
    await post('/revoke-other-sessions', {}, a1.cookie).expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Cookie', another.cookie)
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Cookie', a1.cookie)
      .expect(200);
    await app.close();
    app = await testApplication({ databaseUrl });
    database = app.get(DatabaseService);
    mail = app.get(IdentityMailService);
    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Cookie', a1.cookie)
      .expect(200);
    await post('/revoke-sessions', {}, a1.cookie).expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Cookie', a1.cookie)
      .expect(401);
  });

  it('resets passwords with a single-use expiring provider token and revokes existing sessions', async () => {
    const user = await signup();
    const session = await login(user.email);
    const known = await post('/request-password-reset', {
      email: user.email.toUpperCase(),
      redirectTo: '/recovery',
    }).expect(200);
    const unknown = await post('/request-password-reset', {
      email: `unknown-${randomUUID()}@example.test`,
      redirectTo: '/recovery',
    }).expect(200);
    expect(unknown.body).toEqual(known.body);
    const link = new URL(mail.latestForTest(user.email, 'reset-password')!.url);
    const callback = await request(app.getHttpServer())
      .get(link.pathname + link.search)
      .expect(302);
    expect(new URL(callback.headers.location!).origin).toBe(origin);
    const token = link.pathname.split('/').at(-1)!;
    await post('/reset-password', {
      token: 'invalid-token',
      newPassword,
    }).expect(400);
    await post('/reset-password', { token, newPassword }).expect(200);
    await post('/reset-password', { token, newPassword }).expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Cookie', session.cookie)
      .expect(401);
    await post('/sign-in/email', { email: user.email, password }).expect(401);
    await login(user.email, newPassword);
    tick();
    await post('/request-password-reset', {
      email: user.email,
      redirectTo: '/recovery',
    }).expect(200);
    await database.client.authVerification.updateMany({
      where: { value: user.id },
      data: { expiresAt: new Date(0) },
    });
    const expired = new URL(
      mail.latestForTest(user.email, 'reset-password')!.url,
    ).pathname
      .split('/')
      .at(-1)!;
    await post('/reset-password', {
      token: expired,
      newPassword: password,
    }).expect(400);
  });

  it('rejects invalid/expired verification tokens and returns the generic duplicate-signup contract', async () => {
    const email = `verify-${randomUUID()}@example.test`;
    const signup = await post('/sign-up/email', {
      name: 'Unverified fixture',
      email,
      password,
    }).expect(200);
    created.push(signup.body.user.id);
    const expired = await createEmailVerificationToken(
      app.get<AppConfig>(APP_CONFIG).BETTER_AUTH_SECRET,
      email,
      undefined,
      -3600,
    );
    await request(app.getHttpServer())
      .get('/api/v1/auth/verify-email')
      .query({ token: expired })
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/auth/verify-email')
      .query({ token: 'invalid-token' })
      .expect(401);
    expect(
      (
        await database.client.user.findUniqueOrThrow({
          where: { id: signup.body.user.id },
        })
      ).emailVerified,
    ).toBe(false);
    const duplicate = await post('/sign-up/email', {
      name: 'Unverified fixture',
      email,
      password,
    }).expect(200);
    expect(Object.keys(duplicate.body).sort()).toEqual(
      Object.keys(signup.body).sort(),
    );
    expect(duplicate.body.token).toBeNull();
    expect(await database.client.user.count({ where: { email } })).toBe(1);
    expect(
      await database.client.space.count({
        where: { ownerUserId: signup.body.user.id },
      }),
    ).toBe(1);
  });

  it('changes a password only with the current credential and rotates/revokes sessions', async () => {
    const user = await signup();
    const first = await login(user.email);
    const second = await login(user.email);
    await post(
      '/change-password',
      {
        currentPassword: 'wrong-password',
        newPassword,
        revokeOtherSessions: true,
      },
      first.cookie,
    ).expect(400);
    const changed = await post(
      '/change-password',
      { currentPassword: password, newPassword, revokeOtherSessions: true },
      first.cookie,
    ).expect(200);
    expect(changed.body.token).toBeTypeOf('string');
    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Cookie', first.cookie)
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Cookie', second.cookie)
      .expect(401);
    const fresh = (changed.headers['set-cookie'] as unknown as string[])
      .map((value) => value.split(';')[0])
      .join('; ');
    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Cookie', fresh)
      .expect(200);
    await post('/sign-in/email', { email: user.email, password }).expect(401);
    tick(11000);
    const signedIn = await login(user.email, newPassword);
    await database.client.authSession.updateMany({
      where: { token: signedIn.token },
      data: { expiresAt: new Date(0) },
    });
    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Cookie', signedIn.cookie)
      .expect(401);
  });

  it('confirms both email addresses, enforces session freshness and revalidates after changing email', async () => {
    const user = await signup();
    const session = await login(user.email);
    const replacement = `changed-${randomUUID()}@example.test`;
    await database.client.authSession.updateMany({
      where: { userId: user.id },
      data: { createdAt: new Date(Date.now() - 2 * 86400000) },
    });
    await post(
      '/change-email',
      { newEmail: replacement },
      session.cookie,
    ).expect(403);
    await database.client.authSession.updateMany({
      where: { userId: user.id },
      data: { createdAt: new Date() },
    });
    await post(
      '/change-email',
      { newEmail: replacement },
      session.cookie,
    ).expect(200);
    expect(
      (await database.client.user.findUniqueOrThrow({ where: { id: user.id } }))
        .email,
    ).toBe(user.email);
    await verify(mail.latestForTest(user.email, 'confirm-email-change')!.url);
    expect(
      (await database.client.user.findUniqueOrThrow({ where: { id: user.id } }))
        .email,
    ).toBe(user.email);
    await verify(mail.latestForTest(replacement, 'verify-email')!.url);
    expect(
      (await database.client.user.findUniqueOrThrow({ where: { id: user.id } }))
        .email,
    ).toBe(replacement);
    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Cookie', session.cookie)
      .expect(401);
    await post('/sign-in/email', { email: user.email, password }).expect(401);
    await login(replacement);
  });

  it('enforces personal ownership, strict overposting boundaries and profile/settings validation', async () => {
    const a = await signup();
    const b = await signup();
    const current = await login(a.email);
    const bSpace = await app.get(SpacesService).personalFor(b.id);
    await expect(
      app.get(SpacesService).assertOwned(a.id, bSpace.id),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      app.get(SpacesService).assertOwned(a.id, randomUUID()),
    ).rejects.toMatchObject({ status: 404 });
    await request(app.getHttpServer())
      .get('/api/v1/me/spaces?spaceId=' + bSpace.id)
      .set('Cookie', current.cookie)
      .expect(400);
    await request(app.getHttpServer())
      .patch('/api/v1/me/settings')
      .set('Cookie', current.cookie)
      .set('Origin', origin)
      .send({ timezone: 'Asia/Tehran', userId: b.id })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/api/v1/me')
      .set('Cookie', current.cookie)
      .set('Origin', origin)
      .send({ email: b.email, emailVerified: true, id: b.id })
      .expect(400);
    for (const body of [
      { timezone: 'Invalid/Timezone' },
      { firstDayOfWeek: 9 },
      { preferredCalendar: 'UNSUPPORTED' },
    ]) {
      await request(app.getHttpServer())
        .patch('/api/v1/me/settings')
        .set('Cookie', current.cookie)
        .set('Origin', origin)
        .send(body)
        .expect(400);
    }
    const profile = await request(app.getHttpServer())
      .patch('/api/v1/me')
      .set('Cookie', current.cookie)
      .set('Origin', origin)
      .send({ name: ' Updated name ', image: null })
      .expect(200);
    await request(app.getHttpServer())
      .patch('/api/v1/me')
      .set('Cookie', current.cookie)
      .set('Origin', origin)
      .send({ image: 'invalid-url' })
      .expect(400);
    expect(profile.body.name).toBe('Updated name');
    expect(profile.body.id).toBe(a.id);
    expect(
      (
        await database.client.userSettings.findUniqueOrThrow({
          where: { userId: b.id },
        })
      ).timezone,
    ).toBe('UTC');
    const reconciled = await Promise.all(
      Array.from({ length: 8 }, () => app.get(SpacesService).personalFor(a.id)),
    );
    expect(new Set(reconciled.map((space) => space.id)).size).toBe(1);
    expect(
      await database.client.space.count({ where: { ownerUserId: a.id } }),
    ).toBe(1);
    const legacy = await database.client.user.create({
      data: {
        name: 'Isolated reconciliation fixture',
        email: `legacy-${randomUUID()}@example.test`,
      },
    });
    created.push(legacy.id);
    const repaired = await Promise.all(
      Array.from({ length: 8 }, () =>
        app.get(SpacesService).personalFor(legacy.id),
      ),
    );
    expect(new Set(repaired.map((space) => space.id)).size).toBe(1);
    expect(
      await database.client.space.count({ where: { ownerUserId: legacy.id } }),
    ).toBe(1);
    await expect(
      database.client.space.create({
        data: { ownerUserId: a.id, kind: 'PERSONAL' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await database.client.user.update({
      where: { id: a.id },
      data: { emailVerified: false },
    });
    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Cookie', current.cookie)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/me/spaces')
      .set('Cookie', current.cookie)
      .expect(403);
  });

  it('rolls back identity/settings/space together and rejects invalid database constraints', async () => {
    const email = `rollback-${randomUUID()}@example.test`;
    const client = identityClient(database.client, () => ({
      ...initialAccountRelations(),
      ...initialSpaceRelations(),
    }));
    const id = randomUUID();
    await expect(
      client.$transaction(async (tx) => {
        await tx.user.create({ data: { id, email, name: 'Rollback fixture' } });
        expect(await tx.space.count({ where: { ownerUserId: id } })).toBe(1);
        expect(await tx.userSettings.count({ where: { userId: id } })).toBe(1);
        throw new Error('deliberate fixture rollback');
      }),
    ).rejects.toThrow('deliberate fixture rollback');
    expect(await database.client.user.count({ where: { id } })).toBe(0);
    expect(
      await database.client.space.count({ where: { ownerUserId: id } }),
    ).toBe(0);
    expect(
      await database.client.userSettings.count({ where: { userId: id } }),
    ).toBe(0);
    const owner = await signup();
    await expect(
      database.client.space.create({
        data: { ownerUserId: randomUUID(), kind: 'PERSONAL' },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      database.client.userSettings.update({
        where: { userId: owner.id },
        data: { firstDayOfWeek: 99 },
      }),
    ).rejects.toThrow();
    await expect(
      database.client.userSettings.update({
        where: { userId: owner.id },
        data: { preferredCalendar: 'OTHER' },
      }),
    ).rejects.toThrow();
    expect(
      await database.client.authAccount.count({
        where: { userId: owner.id, providerId: 'credential' },
      }),
    ).toBe(1);
  });

  it('keeps concurrent sign-up retries to one identity, credential, settings row and personal space', async () => {
    const email = `race-${randomUUID()}@example.test`;
    const replies = await Promise.all(
      Array.from({ length: 3 }, () =>
        post('/sign-up/email', { name: 'Concurrent fixture', email, password }),
      ),
    );
    expect(replies.some((reply) => reply.status === 200)).toBe(true);
    for (const reply of replies) expect([200, 400]).toContain(reply.status);
    const users = await database.client.user.findMany({ where: { email } });
    expect(users).toHaveLength(1);
    created.push(users[0]!.id);
    const userId = users[0]!.id;
    expect(
      await database.client.space.count({ where: { ownerUserId: userId } }),
    ).toBe(1);
    expect(
      await database.client.userSettings.count({ where: { userId } }),
    ).toBe(1);
    expect(
      await database.client.authAccount.count({
        where: { userId, providerId: 'credential' },
      }),
    ).toBe(1);
    tick(11000);
    await post('/sign-up/email', {
      name: 'Concurrent fixture',
      email,
      password,
    }).expect(200);
  });

  it('blocks CSRF, redirect abuse, overposting, forged cookies and unauthorized provider routes', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/sign-up/email')
      .send({ name: 'No origin', email: 'nobody@example.test', password })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/auth/sign-in/email')
      .set('Origin', 'https://evil.invalid')
      .send({ email: 'nobody@example.test', password })
      .expect(403);
    await post('/sign-up/email', {
      name: 'Overposting',
      email: 'nobody@example.test',
      password,
      emailVerified: true,
      spaceId: randomUUID(),
    }).expect(400);
    await post('/request-password-reset', {
      email: 'nobody@example.test',
      redirectTo: 'https://evil.invalid/steal',
    }).expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Cookie', 'better-auth.session_token=forged')
      .expect(401);
    await post('/delete-user', {}).expect(404);
    await post('/sign-in/social', { provider: 'unapproved' }).expect(404);
    const cors = await request(app.getHttpServer())
      .options('/api/v1/me')
      .set('Origin', 'https://evil.invalid')
      .set('Access-Control-Request-Method', 'PATCH');
    expect(cors.headers).not.toHaveProperty('access-control-allow-origin');
  });

  it('enforces real library rate limits even with forged forwarded-IP headers', async () => {
    for (let index = 0; index < 3; index++) {
      await post('/sign-in/email', { email: 'unknown@example.test', password })
        .set('X-Forwarded-For', `192.0.2.${index + 1}`)
        .set('X-Mehran-Client-Ip', `192.0.2.${index + 1}`)
        .expect(401);
    }
    const limited = await post('/sign-in/email', {
      email: 'unknown@example.test',
      password,
    })
      .set('X-Forwarded-For', '192.0.2.99')
      .expect(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(limited.body.error.requestId).toBe(limited.headers['x-request-id']);
    tick(11000);
    await post('/sign-in/email', {
      email: 'unknown@example.test',
      password,
    }).expect(401);
  });
});
