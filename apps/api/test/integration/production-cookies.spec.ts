import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { testApplication } from '../support/application.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import { IdentityMailService } from '../../src/platform/auth/mail.service.js';
import { parseEnvironment } from '../../src/bootstrap/environment.js';
import { DatabaseService } from '../../src/platform/database/database.service.js';

const databaseUrl = isolatedTestDatabaseUrl(process.env);
describe('production identity cookie configuration', () => {
  it('issues host-only Secure/HttpOnly/Lax cookies with the production prefix', async () => {
    const origin = 'https://api.example.invalid';
    const mailbox = new IdentityMailService(
      parseEnvironment({
        NODE_ENV: 'test',
        DATABASE_URL: databaseUrl,
        BETTER_AUTH_URL: origin,
        BETTER_AUTH_SECRET:
          'test-only-production-cookie-configuration-at-least-32-characters',
      }),
    );
    const app = await testApplication({
      databaseUrl,
      mail: mailbox,
      environment: {
        NODE_ENV: 'production',
        BETTER_AUTH_URL: origin,
        MAIL_MODE: 'smtp',
        SMTP_HOST: 'smtp.example.invalid',
        SMTP_USER: 'test-only',
        SMTP_PASSWORD: 'test-only',
      },
    });
    const database = app.get(DatabaseService);
    const email = `secure-${randomUUID()}@example.test`;
    try {
      await request(app.getHttpServer())
        .post('/api/v1/auth/sign-up/email')
        .set('Origin', origin)
        .send({
          name: 'Secure fixture',
          email,
          password: 'test-only-strong-password-123!',
        })
        .expect(200);
      const link = new URL(mailbox.latestForTest(email, 'verify-email')!.url);
      link.searchParams.delete('callbackURL');
      await request(app.getHttpServer())
        .get(link.pathname + link.search)
        .expect(200);
      const signedIn = await request(app.getHttpServer())
        .post('/api/v1/auth/sign-in/email')
        .set('Origin', origin)
        .send({ email, password: 'test-only-strong-password-123!' })
        .expect(200);
      const cookies = (
        signedIn.headers['set-cookie'] as unknown as string[]
      ).join(';');
      expect(cookies).toContain('__Secure-better-auth.session_token=');
      expect(cookies).toMatch(/; Secure/i);
      expect(cookies).toMatch(/; HttpOnly/i);
      expect(cookies).toMatch(/SameSite=Lax/i);
      expect(cookies).not.toMatch(/Domain=/i);
      expect(signedIn.headers['strict-transport-security']).toBe(
        'max-age=31536000',
      );
      expect(signedIn.headers['cache-control']).toBe('no-store');
    } finally {
      await database.client.user.deleteMany({ where: { email } });
      await app.close();
    }
  });
});
