import { TeamCustodyGraph } from './application/teams-custody-graph.js';
import { TeamCompanyAssociations } from './application/team-company-associations.js';
import { TeamWorkService } from './application/team-work.service.js';
import { TeamWorkController } from './http/team-work.controller.js';
import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/public/index.js';
import type { DynamicModule } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { AuditModule } from '../../platform/audit/audit.service.js';
import { SpacesModule } from '../spaces/public/index.js';
import { TeamsService } from './application/teams.service.js';
import {
  TeamGuard,
  TeamsController,
  TeamInvitationController,
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
  ): DynamicModule {
    return {
      module: TeamsModule,
      imports: [
        MessagingModule,
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
      ],
      controllers: [
        TeamsController,
        TeamInvitationController,
        TeamWorkController,
        TeamAnalyticsController,
        TeamCareController,
        TeamMeetingsController,
        TeamLifecycleController,
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
