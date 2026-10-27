import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { Body, Controller, Get, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppModule } from '../../src/app.module.js';
import { parseEnvironment } from '../../src/bootstrap/environment.js';
import { configureApp } from '../../src/bootstrap/configure-app.js';
import { ZodValidationPipe } from '../../src/bootstrap/zod-validation.pipe.js';
import { DatabaseService } from '../../src/platform/database/database.service.js';
import { AuthService } from '../../src/platform/auth/auth.service.js';
import { IdentityMailService } from '../../src/platform/auth/mail.service.js';

const ProbeSchema = z.strictObject({ title: z.string().trim().min(1).max(30) });

// Test fixture only. No probe or business endpoint is registered by the production module.
@Controller('test-probe')
class ProbeController {
  @Post()
  validate(@Body(new ZodValidationPipe(ProbeSchema)) body: unknown) {
    return body;
  }

  @Get('failure')
  failure(): never {
    throw new Error('secret SQL password and journal content');
  }
}

export async function testApplication(
  options: {
    databaseUrl?: string;
    database?: Pick<DatabaseService, 'checkConnection'>;
    probes?: boolean;
    mail?: IdentityMailService;
    environment?: NodeJS.ProcessEnv;
  } = {},
) {
  const config = parseEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: options.databaseUrl ?? 'postgresql://localhost/unused_test',
    LOG_LEVEL: 'silent',
    DB_HEALTH_TIMEOUT_MS: '300',
    BETTER_AUTH_SECRET:
      'test-only-secret-for-foundation-contracts-at-least-32-characters',
    BETTER_AUTH_URL: 'http://localhost:3000',
    ...options.environment,
  });
  const builder = Test.createTestingModule({
    imports: [AppModule.register(config)],
    controllers: options.probes ? [ProbeController] : [],
  });
  if (options.database) {
    builder.overrideProvider(DatabaseService).useValue(options.database);
    builder
      .overrideProvider(AuthService)
      .useValue({ session: async () => null });
  }
  if (options.mail)
    builder.overrideProvider(IdentityMailService).useValue(options.mail);
  const fixture = await builder.compile();
  const app = fixture.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    bufferLogs: true,
  });
  // Audit evidence from this fixture's exact HTTP requests is fixture data too.
  // Never clean by action, timestamp, user prefix or an unbounded delete.
  const auditRequests = new Set<string>();
  app.use((req: Request, res: Response, next: () => void) => {
    res.on('finish', () => {
      const id = res.getHeader('X-Request-Id');
      if (
        typeof id === 'string' &&
        /^\/api\/v1\/(?:auth\/|me(?:\/|\?|$))/.test(req.originalUrl)
      )
        auditRequests.add(id);
    });
    next();
  });
  await configureApp(app);
  const close = app.close.bind(app);
  app.close = async () => {
    try {
      const database = app.get(DatabaseService);
      if (database.client && auditRequests.size)
        await database.client.securityAuditEvent.deleteMany({
          where: { requestId: { in: [...auditRequests] } },
        });
    } finally {
      await close();
    }
  };
  return app;
}
