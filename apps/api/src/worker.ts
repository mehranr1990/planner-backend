import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { parseEnvironment } from './bootstrap/environment.js';
import { NotificationWorker } from './modules/notifications/public/index.js';
const config = parseEnvironment(process.env);
const app = await NestFactory.createApplicationContext(
  AppModule.register(config),
  { logger: false },
);
const worker = app.get(NotificationWorker);
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await worker.stop();
  await app.close();
};
process.once('SIGTERM', () => {
  void close();
});
process.once('SIGINT', () => {
  void close();
});
try {
  await worker.start();
  process.stdout.write('Planner notification worker ready\n');
} catch {
  await close();
  process.stderr.write('Planner notification worker could not start\n');
  process.exitCode = 1;
}
