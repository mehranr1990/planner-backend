import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import {
  ApiErrorSchema,
  LiveHealthSchema,
  ReadyHealthSchema,
} from '@mehran/api-contracts';
import { testApplication } from '../support/application.js';

describe('HTTP foundation contracts', () => {
  let app: NestExpressApplication;
  const database = {
    checkConnection: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
  beforeAll(async () => {
    app = await testApplication({ database, probes: true });
  });
  afterAll(async () => {
    await app?.close();
  });

  it('has public liveness and readiness contracts', async () => {
    const live = await request(app.getHttpServer())
      .get('/health/live')
      .expect(200);
    expect(LiveHealthSchema.parse(live.body)).toEqual({ status: 'ok' });
    expect(live.headers).not.toHaveProperty('x-powered-by');
    const ready = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200);
    expect(ReadyHealthSchema.parse(ready.body).checks.database).toBe('up');
    expect(database.checkConnection).toHaveBeenCalledOnce();
  });
  it('reports DB downtime safely while liveness stays healthy', async () => {
    database.checkConnection.mockRejectedValueOnce(
      new Error('postgresql://secret:password@private/db'),
    );
    const response = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(503);
    expect(ApiErrorSchema.parse(response.body).error.code).toBe(
      'SERVICE_UNAVAILABLE',
    );
    expect(JSON.stringify(response.body)).not.toMatch(
      /password|postgresql|private/,
    );
    await request(app.getHttpServer()).get('/health/live').expect(200);
  });
  it('uses valid request and correlation IDs and replaces unsafe values', async () => {
    const id = randomUUID();
    const correlation = randomUUID();
    const response = await request(app.getHttpServer())
      .get('/health/live')
      .set('X-Request-Id', id)
      .set('X-Correlation-Id', correlation)
      .expect(200);
    expect(response.headers['x-request-id']).toBe(id);
    expect(response.headers['x-correlation-id']).toBe(correlation);
    const bad = await request(app.getHttpServer())
      .get('/missing')
      .set('X-Request-Id', '<private-input>')
      .expect(404);
    expect(ApiErrorSchema.parse(bad.body).error.requestId).toBe(
      bad.headers['x-request-id'],
    );
    expect(bad.headers['x-request-id']).not.toBe('<private-input>');
  });
  it('rejects strict-schema overposting and unrecognized health query parameters', async () => {
    const payload = await request(app.getHttpServer())
      .post('/api/v1/test-probe')
      .send({ title: 'hello', ownerId: 'secret-owner' })
      .expect(400);
    expect(ApiErrorSchema.parse(payload.body).error.code).toBe(
      'VALIDATION_ERROR',
    );
    expect(JSON.stringify(payload.body)).not.toContain('secret-owner');
    const query = await request(app.getHttpServer())
      .get('/health/live?secret-password=value')
      .expect(400);
    expect(ApiErrorSchema.parse(query.body).error.code).toBe(
      'VALIDATION_ERROR',
    );
    expect(JSON.stringify(query.body)).not.toContain('secret-password');
  });
  it('normalizes valid input and keeps fixture routes under api/v1', async () => {
    const result = await request(app.getHttpServer())
      .post('/api/v1/test-probe')
      .send({ title: ' hello ' })
      .expect(201);
    expect(result.body).toEqual({ title: 'hello' });
    await request(app.getHttpServer())
      .post('/test-probe')
      .send({ title: 'hello' })
      .expect(404);
  });
  it('handles malformed JSON, oversized bodies and internal errors with safe envelopes', async () => {
    for (const [path, method, payload, status, code] of [
      ['/api/v1/test-probe', 'post', '{broken-secret', 400, 'BAD_REQUEST'],
      [
        '/api/v1/test-probe',
        'post',
        JSON.stringify({ title: 'x'.repeat(140000) }),
        413,
        'PAYLOAD_TOO_LARGE',
      ],
    ] as const) {
      const result = await request(app.getHttpServer())
        [method](path)
        .set('Content-Type', 'application/json')
        .send(payload)
        .expect(status);
      expect(ApiErrorSchema.parse(result.body).error.code).toBe(code);
      expect(result.body.error.requestId).toBe(result.headers['x-request-id']);
    }
    const failure = await request(app.getHttpServer())
      .get('/api/v1/test-probe/failure')
      .expect(500);
    expect(ApiErrorSchema.parse(failure.body).error.code).toBe(
      'INTERNAL_ERROR',
    );
    expect(JSON.stringify(failure.body)).not.toMatch(
      /SQL|password|journal|stack/,
    );
  });
});
