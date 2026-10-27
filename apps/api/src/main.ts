import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { pino } from 'pino';
import { AppModule } from './app.module.js';
import { parseEnvironment } from './bootstrap/environment.js';
import { configureApp } from './bootstrap/configure-app.js';

try {
  const config = parseEnvironment(process.env);
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.register(config),
    { bufferLogs: true, bodyParser: false, abortOnError: false },
  );
  await configureApp(app);
  await app.listen(config.PORT, config.HOST);
} catch (error) {
  pino().fatal(
    { code: 'STARTUP_FAILED' },
    error instanceof Error && error.message.startsWith('Invalid configuration:')
      ? error.message
      : 'API startup failed',
  );
  process.exitCode = 1;
}
