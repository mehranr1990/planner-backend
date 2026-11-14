import { TeamCustodyGraph } from './application/teams-custody-graph.js';
import { TeamCompanyAssociations } from './application/team-company-associations.js';
import { TeamWorkService } from './application/team-work.service.js';
import { TeamWorkController } from './http/team-work.controller.js';
import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/public/index.js';
import {
  MeetingsModule,
  MeetingWorkflowsModule,
} from '../meetings/public/index.js';
import type { DynamicModule } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { AuditModule } from '../../platform/audit/audit.service.js';
import { SpacesModule } from '../spaces/public/index.js';
import { TeamsService } from './application/teams.service.js';
import {
  TeamGuard,
  TeamsController,
  TeamInvitationController,
  TeamInvitationProofController,
} from './http/teams.controller.js';
@Module({})
export class TeamsModule {
  static register(
    projects: DynamicModule,
    tasks: DynamicModule,
    goals: DynamicModule,
    calendar: DynamicModule,
    notifications: DynamicModule,
    storage: DynamicModule,
    meetings?: DynamicModule,
  ): DynamicModule {
    return {
      module: TeamsModule,
      imports: [
        MessagingModule,
        MeetingsModule,
        meetings ?? MeetingWorkflowsModule.register(tasks, calendar, storage),
        DatabaseModule,
        AuditModule,
        SpacesModule,
        projects,
        tasks,
        goals,
        calendar,
        notifications,
        storage,
      ],
      providers: [
        TeamCustodyGraph,
        TeamCompanyAssociations,
        TeamsService,
        TeamGuard,
        TeamWorkService,
        TeamAnalyticsService,
        TeamInteractionContext,
        TeamCareService,
        TeamMeetingsService,
        TeamLifecycleService,
        TeamCleanupService,
        TeamCollaborationService,
        TeamPlanningService,
        TeamOperationsService,
        TeamInsightsService,
        TeamFilesService,
        TeamWorkToolsService,
      ],
      controllers: [
        TeamsController,
        TeamInvitationController,
        TeamInvitationProofController,
        TeamWorkController,
        TeamAnalyticsController,
        TeamCareController,
        TeamMeetingsController,
        TeamLifecycleController,
        TeamCompletionController,
        TeamOperationsController,
        TeamFilesController,
        TeamWorkToolsController,
      ],
      exports: [
        TeamCustodyGraph,
        TeamCompanyAssociations,
        TeamLifecycleService,
        TeamCleanupService,
        TeamsService,
        TeamWorkService,
        TeamAnalyticsService,
        TeamCareService,
        TeamMeetingsService,
      ],
    };
  }
}

import { TeamAnalyticsService } from './application/team-analytics.service.js';
import { TeamAnalyticsController } from './http/team-analytics.controller.js';

import { TeamInteractionContext } from './application/team-interaction.context.js';
import { TeamCareService } from './application/team-care.service.js';
import { TeamMeetingsService } from './application/team-meetings.service.js';
import { TeamCareController } from './http/team-care.controller.js';
import { TeamMeetingsController } from './http/team-meetings.controller.js';

import { TeamLifecycleService } from './application/team-lifecycle.service.js';
import { TeamCleanupService } from './application/team-cleanup.service.js';
import { TeamLifecycleController } from './http/team-lifecycle.controller.js';

import { TeamCollaborationService } from './application/team-collaboration.service.js';
import { TeamPlanningService } from './application/team-planning.service.js';
import { TeamCompletionController } from './http/team-completion.controller.js';
import { TeamOperationsController } from './http/team-operations.controller.js';
import { TeamFilesController } from './http/team-files.controller.js';
import { TeamFilesService } from './application/team-files.service.js';
import { TeamWorkToolsController } from './http/team-work-tools.controller.js';
import { TeamWorkToolsService } from './application/team-work-tools.service.js';
import { TeamOperationsService } from './application/team-operations.service.js';
import { TeamInsightsService } from './application/team-insights.service.js';
