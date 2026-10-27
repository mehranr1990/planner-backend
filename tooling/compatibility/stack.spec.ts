import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { Injectable } from '@nestjs/common';
import { betterAuth } from 'better-auth';
import { toNodeHandler } from 'better-auth/node';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { PrismaClient } from '../../apps/api/src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { createOpenApiDocument } from '../../packages/api-contracts/src/openapi.js';
import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';

@Injectable()
class Dependency {
  readonly value = 'metadata-resolved';
}
@Injectable()
class Consumer {
  constructor(readonly dependency: Dependency) {}
}

describe('bounded stack compatibility spike', () => {
  it('runs on the pinned Node 24 runtime', () => {
    expect(process.versions.node).toBe('24.22.1');
  });
  it('resolves Nest constructor metadata under Vitest/Vite decorators', async () => {
    const fixture = await Test.createTestingModule({
      providers: [Dependency, Consumer],
    }).compile();
    try {
      expect(fixture.get(Consumer).dependency.value).toBe('metadata-resolved');
    } finally {
      await fixture.close();
    }
  });
  it('constructs Better Auth with the Prisma adapter and its Node handler without auth routes or tables', async () => {
    const prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: 'postgresql://localhost/unused_test',
      }),
    });
    try {
      const auth = betterAuth({
        database: prismaAdapter(prisma, { provider: 'postgresql' }),
        secret: 'compatibility-probe-only-secret-at-least-32-characters',
        baseURL: 'http://localhost:3000',
        // Only the test-only transport health probe runs in P0-01. No auth
        // models exist yet; P0-02 must enable schema checks with its real schema.
        advanced: { database: { validateSchema: false } },
      });
      const fixture = await Test.createTestingModule({}).compile();
      const app = fixture.createNestApplication<NestExpressApplication>({
        bodyParser: false,
        logger: false,
      });
      try {
        app
          .getHttpAdapter()
          .getInstance()
          .all('/api/auth/*splat', toNodeHandler(auth));
        await app.init();
        const response = await request(app.getHttpServer())
          .get('/api/auth/ok')
          .expect(200);
        expect(response.body).toEqual({ ok: true });
      } finally {
        await app.close();
      }
      // No sign-in/session requests, migrations or DB calls in this P0-01 spike.
    } finally {
      await prisma.$disconnect();
    }
  });
  it('emits OpenAPI 3.1 from strict Zod schemas', () => {
    const document = createOpenApiDocument();
    expect(document.openapi).toBe('3.1.0');
    expect(document.components.schemas.ApiError.additionalProperties).toBe(
      false,
    );
    expect(document.paths['/health/ready'].get.responses).toHaveProperty('503');
  });
});
