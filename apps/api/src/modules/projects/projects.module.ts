import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { AuditModule } from '../../platform/audit/audit.service.js';
import { SpacesModule } from '../spaces/public/index.js';
import { ProjectsService } from './application/projects.service.js';
import {
  ProjectsController,
  ProjectGuard,
  ResourceInvitationController,
} from './http/projects.controller.js';
@Module({})
export class ProjectsModule {
  static register(tasks: DynamicModule, goals: DynamicModule): DynamicModule {
    return {
      module: ProjectsModule,
      imports: [DatabaseModule, AuditModule, SpacesModule, tasks, goals],
      providers: [ProjectsService, ProjectGuard],
      controllers: [ProjectsController, ResourceInvitationController],
      exports: [ProjectsService],
    };
  }
}
