import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { pino } from 'pino';
import { parseEnvironment } from './bootstrap/environment.js';

try {
  const config = parseEnvironment(process.env);
  // Reject invalid deployment settings before loading the full application graph.
  const [{ NestFactory }, { AppModule }, { configureApp }] = await Promise.all([
    import('@nestjs/core'),
    import('./app.module.js'),
    import('./bootstrap/configure-app.js'),
  ]);
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
