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
  static register(projects: DynamicModule): DynamicModule {
    return {
      module: TeamsModule,
      imports: [DatabaseModule, AuditModule, SpacesModule, projects],
      providers: [TeamsService, TeamGuard],
      controllers: [TeamsController, TeamInvitationController],
      exports: [TeamsService],
    };
  }
}
