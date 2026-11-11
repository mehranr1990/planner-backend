import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { parseEnvironment } from './bootstrap/environment.js';
import { NotificationWorker } from './modules/notifications/public/index.js';
import {
  MessageNoticeWorker,
  ConversationLifecycle,
} from './modules/messaging/public/index.js';
import {
  MeetingFiles,
  MeetingLifecycle,
} from './modules/meetings/public/index.js';
import { RewardsPort } from './modules/rewards/public/index.js';
import { PersonalLifecycle } from './modules/account/public/index.js';
import { SyncService } from './modules/sync/public/index.js';
import { ProjectCleanupService } from './modules/projects/public/index.js';
import { CompanyCleanupService } from './modules/companies/public/index.js';
import { TeamCleanupService } from './modules/teams/public/index.js';
import { SocialLifecycle } from './modules/social/public/index.js';
import {
  SharedKernel,
  CollaborationService,
  ResourceGrants,
} from './modules/spaces/public/index.js';
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
    const sharedExit = await app.get(SharedKernel).consumeExit();
    const projectCleanup = await app.get(ProjectCleanupService).consume();
    const teamCleanup = await app.get(TeamCleanupService).consume();
    const socialCleanup = await app.get(SocialLifecycle).consume();
    const companyCleanup = await app.get(CompanyCleanupService).consume();
    const conversationCleanup = await app.get(ConversationLifecycle).consume();
    const meetingCleanup = await app.get(MeetingLifecycle).consume();
    const collaboration = await app.get(CollaborationService).maintain();
    const grants = await app.get(ResourceGrants).maintain();
    const sync = await app.get(SyncService).maintain();
    const messaging = await app.get(MessageNoticeWorker).consume();
    const meetings = await app.get(MeetingFiles).consume();
    return (
      rewards ||
      lifecycle ||
      sharedExit ||
      projectCleanup ||
      teamCleanup ||
      socialCleanup ||
      companyCleanup ||
      conversationCleanup ||
      meetingCleanup ||
      collaboration ||
      grants ||
      sync ||
      messaging ||
      meetings
    );
  });
  process.stdout.write('Planner notification worker ready\n');
} catch {
  await close();
  process.stderr.write('Planner notification worker could not start\n');
  process.exitCode = 1;
}
