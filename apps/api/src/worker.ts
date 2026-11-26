import { AnalyticsWorker } from './modules/admin-analytics/public/index.js';
import { CommerceWorker } from './modules/admin-commerce/public/index.js';
import { EngagementWorker } from './modules/admin-engagement/public/index.js';
import 'reflect-metadata';
import { ClientInvitationWorker } from './modules/client-invitations/public/index.js';
import { AdminSecurityAlerts } from './platform/admin/security-alerts.service.js';
import { OperationsWorker } from './platform/operations/operations-worker.js';
import { AdminDeliveryService } from './modules/admin-management/public/index.js';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { parseEnvironment } from './bootstrap/environment.js';
import { NotificationWorker } from './modules/notifications/public/index.js';
import {
  MessageNoticeWorker,
  MessagingService,
  ConversationLifecycle,
} from './modules/messaging/public/index.js';
import {
  MeetingFiles,
  MeetingsService,
  MeetingLifecycle,
  AnnouncementSchedulesService,
} from './modules/meetings/public/index.js';
import { RewardsPort } from './modules/rewards/public/index.js';
import { PersonalLifecycle } from './modules/account/public/index.js';
import { SyncService } from './modules/sync/public/index.js';
import { ProjectCleanupService } from './modules/projects/public/index.js';
import {
  CompanyCleanupService,
  CompanyPolicyWorker,
} from './modules/companies/public/index.js';
import { TeamCleanupService } from './modules/teams/public/index.js';
import {
  SocialLifecycle,
  SocialGroupsService,
} from './modules/social/public/index.js';
import {
  SharedKernel,
  CollaborationService,
  ResourceGrants,
  InvitationMailService,
  CompanyAccess,
} from './modules/spaces/public/index.js';
const config = parseEnvironment(process.env);
const app = await NestFactory.createApplicationContext(
  AppModule.register(config),
  { logger: false },
);
const worker = app.get(NotificationWorker);
let closing = false;
let operationsTimer: ReturnType<typeof setInterval> | undefined;
const close = async () => {
  if (closing) return;
  closing = true;
  if (operationsTimer) clearInterval(operationsTimer);
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
    const configuration = await app.get(ConfigurationCore).consume();
    const maintenanceRelease = await app
      .get(ConfigurationMaintenance)
      .consume();
    const analytics = await app
      .get(AnalyticsWorker)
      .consume()
      .catch(() => {
        process.stderr.write(
          'Analytics reconciliation failed; durable pending work will retry.\n',
        );
        return false;
      });
    const commerce = await app.get(CommerceWorker).consume();
    const communicationDelivery = await app.get(EngagementWorker).consume();
    const adminDelivery = await app.get(AdminDeliveryService).consume();
    const securityAlerts = await app.get(AdminSecurityAlerts).consume();
    const rewards = await app
      .get(ConfigurationRuntime)
      .worker('rewards', () => app.get(RewardsPort).consume());
    const lifecycle = await app.get(PersonalLifecycle).consume();
    const sharedExit = await app.get(SharedKernel).consumeExit();
    const projectCleanup = await app.get(ProjectCleanupService).consume();
    const teamCleanup = await app.get(TeamCleanupService).consume();
    const socialCleanup = await app.get(SocialLifecycle).consume();
    const companyPolicy = await app
      .get(ConfigurationRuntime)
      .worker('companies', () => app.get(CompanyPolicyWorker).consume());
    const companyCleanup = await app.get(CompanyCleanupService).consume();
    const conversationCleanup = await app.get(ConversationLifecycle).consume();
    const meetingCleanup = await app.get(MeetingLifecycle).consume();
    const collaboration = await app.get(CollaborationService).maintain();
    const invitationDelivery = await app
      .get(ConfigurationRuntime)
      .worker('notifications', () =>
        app.get(InvitationMailService).consumeContext(async (row, proof) => {
          if (row.companyScopeId) return app.get(CompanyAccess).preview(proof);
          const kind = (await app
            .get(CollaborationService)
            .invitationKind(row.scopeId)) as
            'PROJECT' | 'TEAM' | 'SOCIAL_GROUP';
          if (kind === 'SOCIAL_GROUP' && row.recipientEmail) {
            const recipient = await app
              .get(InvitationMailService)
              .recipient(row.recipientEmail);
            if (recipient?.emailVerified)
              return app
                .get(SocialGroupsService)
                .validateInvitationNotification(row.id, recipient.id);
          }
          return app.get(CollaborationService).preview(proof, kind);
        }),
      );
    const grants = await app.get(ResourceGrants).maintain();
    const sync = await app.get(SyncService).maintain();
    const messaging = await app
      .get(ConfigurationRuntime)
      .worker('messaging', () => app.get(MessageNoticeWorker).consume());
    const conversationInvitations = await app
      .get(ConfigurationRuntime)
      .worker('notifications', () =>
        app.get(MessagingService).consumeEmailInvitations(),
      );
    const meetingInvitations = await app
      .get(ConfigurationRuntime)
      .worker('notifications', () =>
        app.get(MeetingsService).consumeEmailInvitations(),
      );
    const invitationPush = await app
      .get(ConfigurationRuntime)
      .worker('notifications', () => app.get(ClientInvitationWorker).consume());
    const meetings = await app.get(MeetingFiles).consume();
    const announcements = await app
      .get(ConfigurationRuntime)
      .worker('meetings', () =>
        app.get(AnnouncementSchedulesService).consume(),
      );
    return (
      configuration ||
      maintenanceRelease ||
      analytics ||
      commerce ||
      communicationDelivery ||
      adminDelivery ||
      securityAlerts ||
      rewards ||
      lifecycle ||
      sharedExit ||
      projectCleanup ||
      teamCleanup ||
      socialCleanup ||
      companyPolicy ||
      companyCleanup ||
      conversationCleanup ||
      meetingCleanup ||
      collaboration ||
      invitationDelivery ||
      grants ||
      sync ||
      messaging ||
      conversationInvitations ||
      meetingInvitations ||
      invitationPush ||
      meetings ||
      announcements
    );
  });
  const operations = app.get(OperationsWorker);
  const tick = () => {
    void operations
      .tick()
      .catch(() =>
        process.stderr.write(
          'Operational reconciliation failed; inspect protected health evidence.\n',
        ),
      );
  };
  tick();
  operationsTimer = setInterval(tick, 30000);
  operationsTimer.unref();
  process.stdout.write('Planner notification worker ready\n');
} catch {
  await close();
  process.stderr.write('Planner notification worker could not start\n');
  process.exitCode = 1;
}
import { ConfigurationCore } from './platform/configuration/configuration-core.js';
import { ConfigurationMaintenance } from './platform/configuration/maintenance.js';
import { ConfigurationRuntime } from './platform/configuration/runtime.js';
