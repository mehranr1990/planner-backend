import { TeamWorkService } from './application/team-work.service.js';
import { TeamWorkController } from './http/team-work.controller.js';
import { Module } from '@nestjs/common';
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
  ): DynamicModule {
    return {
      module: TeamsModule,
      imports: [
        DatabaseModule,
        AuditModule,
        SpacesModule,
        projects,
        tasks,
        goals,
        calendar,
      ],
      providers: [
        TeamsService,
        TeamGuard,
        TeamWorkService,
        TeamAnalyticsService,
      ],
      controllers: [
        TeamsController,
        TeamInvitationController,
        TeamWorkController,
        TeamAnalyticsController,
      ],
      exports: [TeamsService, TeamWorkService, TeamAnalyticsService],
    };
  }
}

import { TeamAnalyticsService } from './application/team-analytics.service.js';
import { TeamAnalyticsController } from './http/team-analytics.controller.js';
