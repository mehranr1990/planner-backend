import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { testApplication } from '../support/application.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import { IdentityMailService } from '../../src/platform/auth/mail.service.js';
import { DatabaseService } from '../../src/platform/database/database.service.js';

const origin = 'http://localhost:3000';
const databaseUrl = isolatedTestDatabaseUrl(process.env);

describe('Better Auth identity and ownership', () => {
  let app: NestExpressApplication;
  let db: DatabaseService;
  let mail: IdentityMailService;
  const suffix = randomUUID();
  const email = `p002-${suffix}@example.test`;
  const password = 'test-only-strong-passphrase-123!';
  let cookie: string;
  let userId: string;
  beforeAll(async () => {
    app = await testApplication({ databaseUrl });
    db = app.get(DatabaseService);
    mail = app.get(IdentityMailService);
  });
  afterAll(async () => {
    // Only this run's known fixture identity is removed from the explicitly guarded test DB.
    if (db) await db.client.user.deleteMany({ where: { email } });
    await app?.close();
  });
  it('signs up atomically with settings and one personal space; requires email verification', async () => {
    const signup = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-up/email')
      .set('Origin', origin)
      .send({ name: 'First user', email, password })
      .expect(200);
    userId = signup.body.user.id;
    expect(signup.body.token).toBeNull();
    expect(
      await db.client.space.count({
        where: { ownerUserId: userId, kind: 'PERSONAL' },
      }),
    ).toBe(1);
    expect(await db.client.userSettings.count({ where: { userId } })).toBe(1);
    const credential = await db.client.authAccount.findFirstOrThrow({
      where: { userId, providerId: 'credential' },
    });
    expect(credential.password).not.toBe(password);
    expect(credential.password!.length).toBeGreaterThan(32);
    await request(app.getHttpServer())
      .post('/api/v1/auth/sign-in/email')
      .set('Origin', origin)
      .send({ email, password })
      .expect(403);
    const link = mail.latestForTest(email, 'verify-email');
    expect(link).toBeDefined();
    const url = new URL(link!.url);
    url.searchParams.delete('callbackURL');
    await request(app.getHttpServer())
      .get(url.pathname + url.search)
      .expect(200);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-in/email')
      .set('Origin', origin)
      .send({ email, password })
      .expect(200);
    const cookies = login.headers['set-cookie'] as unknown as string[];
    expect(cookies.join(';')).toMatch(/HttpOnly/i);
    expect(cookies.join(';')).toMatch(/SameSite=Lax/i);
    cookie = cookies.map((value) => value.split(';')[0]).join('; ');
  });
  it('uses verified DB sessions for me/settings/space and revokes them immediately', async () => {
    const me = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Cookie', cookie)
      .expect(200);
    expect(me.body.id).toBe(userId);
    await request(app.getHttpServer())
      .patch('/api/v1/me/settings')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({
        timezone: 'Asia/Tehran',
        locale: 'fa',
        preferredCalendar: 'JALALI',
        firstDayOfWeek: 6,
      })
      .expect(200);
    const spaces = await request(app.getHttpServer())
      .get('/api/v1/me/spaces')
      .set('Cookie', cookie)
      .expect(200);
    expect(spaces.body).toHaveLength(1);
    expect(spaces.body[0].ownerUserId).toBe(userId);
    await request(app.getHttpServer())
      .post('/api/v1/auth/sign-out')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({})
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Cookie', cookie)
      .expect(401);
  });
});
