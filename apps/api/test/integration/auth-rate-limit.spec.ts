import { afterAll, beforeAll, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { testApplication } from '../support/application.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';

let app: NestExpressApplication;
beforeAll(async () => {
  app = await testApplication({
    databaseUrl: isolatedTestDatabaseUrl(process.env),
  });
});
afterAll(async () => {
  await app?.close();
});

it.each([
  ['/sign-in/email', 10, 401],
  ['/request-password-reset', 60, 200],
  ['/send-verification-email', 60, 200],
])(
  'retains provider protection for %s and its actual Retry-After',
  async (path, window, allowedStatus) => {
    const email = `nonexistent-rate-${randomUUID()}@example.test`;
    const body =
      path === '/sign-in/email'
        ? { email, password: 'synthetic-unknown-account-password-123!' }
        : { email };
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .post('/api/v1/auth' + path)
        .set('Origin', 'http://localhost:3000')
        .send(body)
        .expect(allowedStatus);
    }
    const denied = await request(app.getHttpServer())
      .post('/api/v1/auth' + path)
      .set('Origin', 'http://localhost:3000')
      .send(body)
      .expect(429);
    expect(denied.body.error.code).toBe('RATE_LIMITED');
    expect(Number(denied.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(Number(denied.headers['retry-after'])).toBeLessThanOrEqual(window);
  },
);
