import { Module } from '@nestjs/common';
import { ProjectExecutionContext } from './application/project-execution-context.js';
import { ProjectRegisterService } from './application/project-register.service.js';
import { ProjectPlansService } from './application/project-plans.service.js';
import { ProjectWorkMetricsService } from './application/project-work-metrics.service.js';
import { ProjectExecutionController } from './http/project-execution.controller.js';
import type { DynamicModule } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { AuditModule } from '../../platform/audit/audit.service.js';
import { SpacesModule } from '../spaces/public/index.js';
import { ProjectsService } from './application/projects.service.js';
import { WorkService } from './application/work.service.js';
import { ProjectToolsService } from './application/project-tools.service.js';
import { ProjectToolsController } from './http/project-tools.controller.js';
import {
  WorkController,
  WorkProjectionController,
} from './http/work.controller.js';
import {
  ProjectsController,
  ProjectGuard,
  ResourceInvitationController,
} from './http/projects.controller.js';
@Module({})
export class ProjectsModule {
  static register(
    tasks: DynamicModule,
    goals: DynamicModule,
    calendar: DynamicModule,
    notifications: DynamicModule,
  ): DynamicModule {
    return {
      module: ProjectsModule,
      imports: [
        DatabaseModule,
        AuditModule,
        SpacesModule,
        tasks,
        goals,
        calendar,
        notifications,
      ],
      providers: [
        ProjectExecutionContext,
        ProjectRegisterService,
        ProjectPlansService,
        ProjectWorkMetricsService,
        ProjectsService,
        ProjectGuard,
        WorkService,
        ProjectToolsService,
      ],
      controllers: [
        ProjectExecutionController,
        ProjectToolsController,
        ProjectsController,
        ResourceInvitationController,
        WorkController,
        WorkProjectionController,
      ],
      exports: [ProjectsService, WorkService],
    };
  }
}
