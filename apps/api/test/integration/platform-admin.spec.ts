import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { spawnSync } from 'node:child_process';
import { testApplication } from '../support/application.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import { DatabaseService } from '../../src/platform/database/database.service.js';
import { APP_CONFIG } from '../../src/bootstrap/configuration.module.js';
import type { AppConfig } from '../../src/bootstrap/environment.js';
import { createAdminAuth } from '../../src/platform/admin/create-admin-auth.js';
import { AdminService } from '../../src/platform/admin/admin.service.js';

function totp(secret: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...secret.toUpperCase()]
    .map((c) => alphabet.indexOf(c).toString(2).padStart(5, '0'))
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
const origin = 'http://localhost:3000';
describe('isolated Platform Admin authentication', () => {
  let app: NestExpressApplication, db: DatabaseService, id: string;
  const email = `admin-${randomUUID()}@example.test`,
    password = 'isolated-admin-test-password!';
  const jar = new Map<string, string>();
  let backupCode: string;
  const responseCookies = (res: { headers: Record<string, unknown> }) =>
    ((res.headers['set-cookie'] ?? []) as string[])
      .map((c) => c.split(';')[0]!)
      .join('; ');
  const cookies = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const remember = (res: { headers: Record<string, unknown> }) => {
    for (const c of (res.headers['set-cookie'] ?? []) as string[]) {
      const pair = c.split(';')[0]!;
      const i = pair.indexOf('=');
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
  };
  const post = (route: string, body: object) =>
    request(app.getHttpServer())
      .post('/api/v1/admin/auth' + route)
      .set('Origin', origin)
      .set('Cookie', cookies())
      .send(body);
  beforeAll(async () => {
    app = await testApplication({
      databaseUrl: isolatedTestDatabaseUrl(process.env),
    });
    db = app.get(DatabaseService);
    const provision = spawnSync(
      process.execPath,
      ['tooling/scripts/admin-provision.ts'],
      {
        input: JSON.stringify({
          email,
          name: 'Test admin',
          role: 'SUPER_ADMIN',
          password,
        }),
        env: {
          ...process.env,
          DATABASE_URL: isolatedTestDatabaseUrl(process.env),
        },
        encoding: 'utf8',
        timeout: 15000,
      },
    );
    expect(provision.status, provision.stderr).toBe(0);
    const user = await db.client.adminUser.findUniqueOrThrow({
      where: { email },
    });
    id = user.id;
  });
  afterAll(async () => {
    if (id) {
      await db.client.adminAuditEvent.deleteMany({
        where: { actorAdminId: id },
      });
      await db.client.adminUser.delete({ where: { id } });
    }
    await app?.close();
  });
  it('denies public registration, MFA bypass and private user API access', async () => {
    await post('/sign-up/email', { email, password, name: 'Attacker' }).expect(
      404,
    );
    await post('/two-factor/disable', { password }).expect(404);
    const login = await post('/sign-in/email', { email, password })
      .set('X-Forwarded-For', '203.0.113.9')
      .set('X-Real-IP', '203.0.113.10')
      .set('X-Mehran-Client-IP', '203.0.113.11')
      .expect(200);
    remember(login);
    expect(cookies()).toContain('mehran-admin');
    const passwordSession = await db.client.adminSession.findFirstOrThrow({
      where: { userId: id },
    });
    expect(passwordSession.ipAddress).toMatch(/127\.0\.0\.1$/);
    const sessionCookie = (
      login.headers['set-cookie'] as unknown as string[]
    ).find((c) => c.startsWith('mehran-admin.session_token='));
    expect(sessionCookie).toContain('Path=/api/v1/admin');
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toMatch(/SameSite=Strict/i);
    expect(sessionCookie).not.toMatch(/; Secure/i);
    await request(app.getHttpServer())
      .get('/api/v1/admin/session')
      .set('Cookie', cookies())
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Cookie', cookies())
      .expect(401);
    expect(await db.client.user.count({ where: { email } })).toBe(0);
  });
  it('verifies enrollment, revokes password sessions, then challenges every login', async () => {
    const enabled = await post('/two-factor/enable', { password }).expect(200);
    remember(enabled);
    const uri = new URL(enabled.body.totpURI as string);
    backupCode = enabled.body.backupCodes[0] as string;
    const factor = await db.client.adminTwoFactor.findUniqueOrThrow({
      where: { userId: id },
    });
    expect(factor.secret).not.toContain(uri.searchParams.get('secret'));
    expect(factor.backupCodes).not.toContain(enabled.body.backupCodes[0]);
    const context = await app.get(AdminService).auth.$context;
    const createSession = context.internalAdapter.createSession.bind(
      context.internalAdapter,
    );
    let signalPaused!: () => void, resume!: () => void;
    const paused = new Promise<void>((resolve) => {
      signalPaused = resolve;
    });
    const resumed = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const spy = vi
      .spyOn(context.internalAdapter, 'createSession')
      .mockImplementationOnce(async (...args) => {
        signalPaused();
        await resumed;
        return createSession(...args);
      });
    // Freeze password sign-in after its old user snapshot, before its session write.
    const lateLogin = post('/sign-in/email', { email, password }).then(
      (r) => r,
    );
    try {
      await paused;
      const verified = await post('/two-factor/verify-totp', {
        code: totp(uri.searchParams.get('secret')!),
      }).expect(200);
      remember(verified);
      expect(
        await db.client.adminSession.count({ where: { userId: id } }),
      ).toBe(0);
    } finally {
      resume();
      spy.mockRestore();
    }
    const late = await lateLogin;
    expect(late.status).toBe(200);
    const lateSession = await db.client.adminSession.findFirstOrThrow({
      where: { userId: id },
    });
    expect(lateSession.mfaVerifiedAt).toBeNull();
    await request(app.getHttpServer())
      .get('/api/v1/admin/session')
      .set('Cookie', responseCookies(late))
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/admin/auth/sign-out')
      .set('Origin', origin)
      .set('Cookie', responseCookies(late))
      .send({})
      .expect(200);
    jar.clear();
    const login = await post('/sign-in/email', { email, password }).expect(200);
    remember(login);
    expect(login.body.twoFactorRedirect).toBe(true);
    await request(app.getHttpServer())
      .get('/api/v1/admin/session')
      .set('Cookie', cookies())
      .expect(401);
    const challenge = await post('/two-factor/verify-totp', {
      code: totp(uri.searchParams.get('secret')!),
    }).expect(200);
    remember(challenge);
    await request(app.getHttpServer())
      .get('/api/v1/admin/session')
      .set('Cookie', cookies())
      .expect(200);
    await db.client.adminUser.update({
      where: { id },
      data: { active: false },
    });
    await request(app.getHttpServer())
      .get('/api/v1/admin/session')
      .set('Cookie', cookies())
      .expect(403);
    await db.client.adminUser.update({ where: { id }, data: { active: true } });
    await post('/revoke-sessions', {}).expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/admin/session')
      .set('Cookie', cookies())
      .expect(401);
    expect(
      await db.client.adminAuditEvent.count({
        where: { actorAdminId: id, outcome: 'SUCCEEDED' },
      }),
    ).toBeGreaterThan(0);
  });
  it('configures production cookies without depending on caller-supplied forwarded protocol', async () => {
    const config = app.get<AppConfig>(APP_CONFIG);
    const provider = createAdminAuth(
      {
        ...config,
        NODE_ENV: 'production',
        BETTER_AUTH_URL: 'https://admin.example.test',
      },
      db.client,
    );
    const context = await provider.$context;
    expect(context.authCookies.sessionToken.name).toBe(
      '__Secure-mehran-admin.session_token',
    );
    expect(context.authCookies.sessionToken.attributes).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/api/v1/admin',
    });
    expect(context.authCookies.sessionToken.attributes.domain).toBeUndefined();
    expect(context.options.session?.cookieCache?.enabled).toBe(false);
    expect(context.sessionConfig.expiresIn).toBe(3600);
  });
  it('consumes a backup code once across independent concurrent challenges and refuses replay', async () => {
    jar.clear();
    const challenges = await Promise.all([
      post('/sign-in/email', { email, password }),
      post('/sign-in/email', { email, password }),
    ]);
    for (const challenge of challenges) {
      expect(challenge.status).toBe(200);
      expect(challenge.body.twoFactorRedirect).toBe(true);
    }
    const attempts = await Promise.all(
      challenges.map((challenge) =>
        request(app.getHttpServer())
          .post('/api/v1/admin/auth/two-factor/verify-backup-code')
          .set('Origin', origin)
          .set('Cookie', responseCookies(challenge))
          .send({ code: backupCode }),
      ),
    );
    expect(attempts.filter((r) => r.status === 200)).toHaveLength(1);
    expect([401, 409]).toContain(
      attempts.find((r) => r.status !== 200)!.status,
    );
    const winner = attempts.find((r) => r.status === 200)!;
    const validCookie = responseCookies(winner);
    await request(app.getHttpServer())
      .get('/api/v1/admin/session')
      .set('Cookie', validCookie)
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/admin/auth/two-factor/verify-backup-code')
      .set('Origin', origin)
      .set('Cookie', validCookie)
      .send({ code: backupCode })
      .expect(401);
    jar.clear();
    remember(winner);
  });
  it('does not resurrect a revoked session during concurrent reads and revocations', async () => {
    const cookie = cookies();
    const results = await Promise.all([
      post('/revoke-sessions', {}),
      post('/revoke-sessions', {}),
      ...Array.from({ length: 3 }, () =>
        request(app.getHttpServer())
          .get('/api/v1/admin/session')
          .set('Cookie', cookie),
      ),
    ]);
    expect(results.slice(0, 2).some((r) => r.status === 200)).toBe(true);
    // Requests already authorized before revocation may finish; subsequent requests must fail.
    for (const result of results) expect([200, 401]).toContain(result.status);
    expect(await db.client.adminSession.count({ where: { userId: id } })).toBe(
      0,
    );
    await request(app.getHttpServer())
      .get('/api/v1/admin/session')
      .set('Cookie', cookie)
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/admin/auth/list-sessions')
      .set('Cookie', cookie)
      .expect(401);
    expect(await db.client.adminSession.count({ where: { userId: id } })).toBe(
      0,
    );
  });
  it('rejects missing trusted Origin, privilege injection and excessive sign-ins', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/admin/auth/sign-in/email')
      .send({ email, password })
      .expect(403);
    await post('/sign-in/email', {
      email,
      password,
      role: 'SUPER_ADMIN',
    }).expect(400);
    let limited = false;
    for (let i = 0; i < 6; i++) {
      const result = await post('/sign-in/email', {
        email,
        password: 'incorrect-password',
      });
      if (result.status === 429) {
        expect(result.headers['retry-after']).toBeDefined();
        limited = true;
        break;
      }
      expect(result.status).toBe(401);
      expect(JSON.stringify(result.body)).not.toContain(email);
    }
    expect(limited).toBe(true);
  });
});
