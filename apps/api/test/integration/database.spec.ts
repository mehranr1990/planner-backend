import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DatabaseService } from '../../src/platform/database/database.service.js';
import { testApplication } from '../support/application.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';

// This gate fails clearly when prerequisites are missing; it never silently skips.
const databaseUrl = isolatedTestDatabaseUrl(process.env);
describe('isolated local PostgreSQL', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await testApplication({ databaseUrl });
  });
  afterAll(async () => {
    await app?.close();
  });

  it('executes a real Prisma SELECT 1 without migrations or data changes', async () => {
    const zone = await app.get(DatabaseService).client.$queryRaw<
      { timezone: string }[]
    >`SELECT current_setting('TimeZone') AS timezone`;
    expect(zone[0]?.timezone).toBe('UTC');
    await expect(
      app.get(DatabaseService).checkConnection(),
    ).resolves.toBeUndefined();
    const result = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200);
    expect(result.body.checks.database).toBe('up');
  });
  it('preserves liveness and returns bounded 503 when a real DB connection fails', async () => {
    const url = new URL(databaseUrl);
    // Local port zero cannot be a PostgreSQL server. Never stop an operator's DB.
    url.port = '1';
    const disconnected = await testApplication({ databaseUrl: url.toString() });
    try {
      const start = Date.now();
      const result = await request(disconnected.getHttpServer())
        .get('/health/ready')
        .expect(503);
      expect(Date.now() - start).toBeLessThan(5000);
      expect(result.body.error.code).toBe('SERVICE_UNAVAILABLE');
      await request(disconnected.getHttpServer())
        .get('/health/live')
        .expect(200);
    } finally {
      await disconnected.close();
    }
  });
});
