import {
  AnalyticsModule,
  ANALYTICS_SCOPE_AUTHORITY,
  type AnalyticsScopeAuthority,
} from './modules/admin-analytics/public/index.js';
import { CommerceModule } from './modules/admin-commerce/public/index.js';
import { protectsEngagementEvidence } from './modules/admin-engagement/public/storage-reference.js';
import { EngagementModule } from './modules/admin-engagement/public/index.js';
import { AdminModule } from './platform/admin/admin.module.js';
import { OperationsModule } from './platform/operations/operations.module.js';
import {
  ADMIN_FILE_SCOPE_AUTHORITY,
  EXPORT_STORAGE_REFERENCES,
  type AdminFileScopeAuthority,
} from './platform/storage/storage-operations.js';
import { ManagementModule } from './modules/admin-management/public/index.js';
import { CompaniesModule } from './modules/companies/public/index.js';
import {
  SocialModule,
  SocialActivitiesModule,
} from './modules/social/public/index.js';
import {
  MessagingModule,
  MessagingMediaModule,
} from './modules/messaging/public/index.js';
import { SyncModule } from './modules/sync/public/index.js';
import { ProjectsModule } from './modules/projects/public/index.js';
import { AccountLifecycleModule } from './modules/account/public/lifecycle-module.js';
import { IDENTITY_ADMISSION } from './platform/auth/admission.js';
import { FinanceModule } from './modules/finance/public/index.js';
import { InsightsModule } from './modules/insights/public/index.js';
import { RewardsModule } from './modules/rewards/public/index.js';
import { NotificationsModule } from './modules/notifications/public/index.js';
import { NotesModule } from './modules/notes/public/index.js';
import { JournalModule } from './modules/journal/public/index.js';
import { CaptureModule } from './modules/capture/public/index.js';
import { FocusModule } from './modules/focus/public/index.js';
import { GoalsModule } from './modules/goals/public/index.js';
import { TasksModule } from './modules/tasks/public/index.js';
import { PlanningModule } from './modules/planning/public/index.js';
import { CalendarModule } from './modules/calendar/public/index.js';
import { HabitsModule } from './modules/habits/public/index.js';
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigurationModule } from './bootstrap/configuration.module.js';
import type { AppConfig } from './bootstrap/environment.js';
import { DatabaseModule } from './platform/database/database.module.js';
import { loggingOptions } from './platform/observability/logging.js';
import { HealthController } from './platform/observability/health.controller.js';
import {
  AccountModule,
  protectsAccountExportKey,
  initialAccountRelations,
} from './modules/account/public/index.js';
import {
  SpacesModule,
  initialSpaceRelations,
  SpacesService,
} from './modules/spaces/public/index.js';
import { AuthModule } from './platform/auth/auth.module.js';
import { StorageModule } from './platform/storage/public/index.js';
import { MeetingWorkflowsModule } from './modules/meetings/public/index.js';
import { FILE_SCOPE_RESOLVER } from './platform/storage/files.controller.js';
import type { FileScopeResolver } from './platform/storage/files.controller.js';

@Module({})
export class AppModule {
  static register(config: AppConfig): DynamicModule {
    const storage = StorageModule.register(
      [SpacesModule],
      {
        provide: FILE_SCOPE_RESOLVER,
        inject: [SpacesService],
        useFactory:
          (spaces: SpacesService): FileScopeResolver =>
          (actor) =>
            spaces.authorizePersonal(actor),
      },
      {
        provide: ADMIN_FILE_SCOPE_AUTHORITY,
        inject: [SpacesService],
        useFactory:
          (spaces: SpacesService): AdminFileScopeAuthority =>
          (tx, command, file) =>
            spaces.adminFileScope(tx, command, file),
      },
      {
        provide: EXPORT_STORAGE_REFERENCES,
        useValue: async (
          ...args: Parameters<typeof protectsAccountExportKey>
        ) =>
          (await protectsAccountExportKey(...args)) ||
          (await protectsEngagementEvidence(...args)),
      },
    );
    const tasks = TasksModule.register(storage);
    const messagingMedia = MessagingMediaModule.register(storage);
    const goals = GoalsModule.register(tasks);
    const notes = NotesModule.register(tasks, goals);
    const capture = CaptureModule.register(tasks, goals, notes, storage);
    const planning = PlanningModule.register(tasks);
    const finance = FinanceModule.register(capture);
    const focus = FocusModule.register(tasks);
    const calendar = CalendarModule.register(tasks),
      notifications = NotificationsModule.register(tasks),
      rewards = RewardsModule.register(tasks);
    const meetingWorkflows = MeetingWorkflowsModule.register(
      tasks,
      calendar,
      storage,
    );
    const projects = ProjectsModule.register(
      tasks,
      goals,
      calendar,
      notifications,
      storage,
    );
    const teams = TeamsModule.register(
      projects,
      tasks,
      goals,
      calendar,
      notifications,
      storage,
      meetingWorkflows,
    );
    const companies = CompaniesModule.register(
      projects,
      storage,
      teams,
      calendar,
      goals,
    );
    const engagement = EngagementModule.register(storage);
    const accountLifecycle = AccountLifecycleModule.register([
      CommerceModule,
      engagement,
      projects,
      SocialModule,
      storage,
      tasks,
      planning,
      calendar,
      HabitsModule,
      goals,
      focus,
      notes,
      JournalModule,
      capture,
      finance,
      notifications,
      rewards,
      messagingMedia,
      meetingWorkflows,
    ]);
    return {
      module: AppModule,
      imports: [
        ClientInvitationsModule.register(meetingWorkflows),
        AdminModule,
        OperationsModule.register(storage),
        PlatformConfigurationModule.register([SpacesModule], {
          provide: CONFIGURATION_SCOPE_AUTHORITY,
          inject: [SpacesService, SharedKernel, DatabaseService],
          useFactory:
            (
              spaces: SpacesService,
              kernel: SharedKernel,
              db: DatabaseService,
            ): ConfigurationScopeAuthority =>
            async (actor, selector) => {
              if (!selector)
                return (await spaces.authorizePersonal(actor)).spaceId;
              await db.client.$transaction((tx) =>
                commerceScope(tx, selector, actor, kernel),
              );
              return selector;
            },
        }),
        engagement,
        CommerceModule,
        AnalyticsModule.register([SpacesModule], {
          provide: ANALYTICS_SCOPE_AUTHORITY,
          inject: [SpacesService, SharedKernel],
          useFactory:
            (
              spaces: SpacesService,
              kernel: SharedKernel,
            ): AnalyticsScopeAuthority =>
            async (tx, actor, selector) => {
              if (!selector) {
                const scope = await spaces.authorizePersonal(actor);
                await scope.fence(tx);
                return {
                  spaceId: scope.spaceId,
                  scopeId: null,
                  kind: 'PERSONAL',
                };
              }
              const scope = await commerceScope(tx, selector, actor, kernel);
              return {
                spaceId: scope.spaceId,
                scopeId: scope.scopeId,
                kind: scope.kind,
              };
            },
        }),
        ManagementModule.register([teams, companies, accountLifecycle]),
        SocialModule,
        SocialActivitiesModule.register(tasks, calendar, finance),
        MessagingModule,
        messagingMedia,
        meetingWorkflows,
        ConfigurationModule.register(config),
        DatabaseModule,
        LoggerModule.forRoot(loggingOptions(config)),
        AuthModule.register(
          () => ({
            ...initialAccountRelations(),
            ...initialSpaceRelations(),
          }),
          [SpacesModule],
          {
            provide: IDENTITY_ADMISSION,
            inject: [SpacesService],
            useFactory: (spaces: SpacesService) => (userId: string) =>
              spaces.admit(userId),
          },
        ),
        AccountModule,
        SpacesModule,
        SyncModule.register([tasks, planning, HabitsModule, notes, capture]),
        accountLifecycle,
        storage,
        tasks,
        planning,
        calendar,
        HabitsModule,
        goals,
        projects,
        companies,
        teams,
        notes,
        JournalModule,
        capture,
        finance,
        focus,
        InsightsModule.register([tasks, planning, goals, focus, finance]),
        rewards,
        notifications,
      ],
      controllers: [HealthController],
    };
  }
}
import { TeamsModule } from './modules/teams/public/index.js';
import { ClientInvitationsModule } from './modules/client-invitations/public/index.js';
import { PlatformConfigurationModule } from './platform/configuration/configuration.module.js';
import {
  CONFIGURATION_SCOPE_AUTHORITY,
  type ConfigurationScopeAuthority,
} from './platform/configuration/configuration.controller.js';
import { commerceScope } from './modules/spaces/public/commerce-context.js';
import { SharedKernel } from './modules/spaces/public/index.js';
import { DatabaseService } from './platform/database/database.service.js';
