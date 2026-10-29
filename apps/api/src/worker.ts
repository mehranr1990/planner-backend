import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { parseEnvironment } from './bootstrap/environment.js';
import { NotificationWorker } from './modules/notifications/public/index.js';
import { RewardsPort } from './modules/rewards/public/index.js';
import { PersonalLifecycle } from './modules/account/public/index.js';
import { SyncService } from './modules/sync/public/index.js';
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
  await worker.start(async () => {
    const rewards = await app.get(RewardsPort).consume();
    const lifecycle = await app.get(PersonalLifecycle).consume();
    const sync = await app.get(SyncService).maintain();
    return rewards || lifecycle || sync;
  });
  process.stdout.write('Planner notification worker ready\n');
} catch {
  await close();
  process.stderr.write('Planner notification worker could not start\n');
  process.exitCode = 1;
}
