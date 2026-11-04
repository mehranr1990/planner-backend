import { afterAll, beforeAll, it, expect } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { testApplication } from '../support/application.js';
let app: NestExpressApplication;
beforeAll(async () => {
  app = await testApplication({
    database: { checkConnection: async () => undefined },
  });
});
afterAll(async () => {
  await app?.close();
});
it('registers truthful contracts while shared activation denies anonymous metadata without any DB client', async () => {
  for (const proof of ['invalid', 'x'.repeat(43)]) {
    const result = await request(app.getHttpServer())
      .get('/api/v1/invitations/preview')
      .set('X-Invitation-Proof', proof)
      .expect(403);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(result.body)).not.toContain('contextLabel');
  }
});
