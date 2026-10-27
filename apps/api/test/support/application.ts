import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { Body, Controller, Get, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { z } from 'zod';
import { AppModule } from '../../src/app.module.js';
import { parseEnvironment } from '../../src/bootstrap/environment.js';
import { configureApp } from '../../src/bootstrap/configure-app.js';
import { ZodValidationPipe } from '../../src/bootstrap/zod-validation.pipe.js';
import { DatabaseService } from '../../src/platform/database/database.service.js';

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
  } = {},
) {
  const config = parseEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: options.databaseUrl ?? 'postgresql://localhost/unused_test',
    LOG_LEVEL: 'silent',
    DB_HEALTH_TIMEOUT_MS: '300',
  });
  const builder = Test.createTestingModule({
    imports: [AppModule.register(config)],
    controllers: options.probes ? [ProbeController] : [],
  });
  if (options.database)
    builder.overrideProvider(DatabaseService).useValue(options.database);
  const fixture = await builder.compile();
  const app = fixture.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    bufferLogs: true,
  });
  await configureApp(app);
  return app;
}
