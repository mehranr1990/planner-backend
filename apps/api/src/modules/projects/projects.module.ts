import { ProjectCustodyGraph } from './application/projects-custody-graph.js';
import { ProjectOverviewService } from './application/project-overview.service.js';
import { ProjectOverviewController } from './http/project-overview.controller.js';
import { ProjectCompanyAssociations } from './application/project-company-associations.js';
import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/public/index.js';
import { MeetingsModule } from '../meetings/public/index.js';
import { ProjectContentService } from './application/project-content.service.js';
import { ProjectExportService } from './application/project-export.service.js';
import { ProjectTransferService } from './application/project-transfer.service.js';
import { ProjectTransferController } from './http/project-transfer.controller.js';
import { ProjectCleanupService } from './application/project-cleanup.service.js';
import { ProjectLifecycleController } from './http/project-lifecycle.controller.js';
import { ProjectFilesService } from './application/project-files.service.js';
import { ProjectViewsService } from './application/project-views.service.js';
import { ProjectCollaborationController } from './http/project-collaboration.controller.js';
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
    storage: DynamicModule,
  ): DynamicModule {
    return {
      module: ProjectsModule,
      imports: [
        MessagingModule,
        MeetingsModule,
        DatabaseModule,
        AuditModule,
        SpacesModule,
        tasks,
        goals,
        calendar,
        notifications,
        storage,
      ],
      providers: [
        ProjectOverviewService,
        ProjectCustodyGraph,
        ProjectCompanyAssociations,
        ProjectFinanceReferences,
        TeamProjects,
        ProjectContentService,
        ProjectExportService,
        ProjectTransferService,
        ProjectCleanupService,
        ProjectFilesService,
        ProjectViewsService,
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
        ProjectOverviewController,
        ProjectLifecycleController,
        ProjectTransferController,
        ProjectCollaborationController,
        ProjectExecutionController,
        ProjectToolsController,
        ProjectsController,
        ResourceInvitationController,
        WorkController,
        WorkProjectionController,
      ],
      exports: [
        ProjectCustodyGraph,
        ProjectCompanyAssociations,
        ProjectFinanceReferences,
        TeamProjects,
        ProjectsService,
        WorkService,
        ProjectContentService,
        ProjectFilesService,
        ProjectViewsService,
        ProjectExportService,
        ProjectTransferService,
        ProjectCleanupService,
      ],
    };
  }
}
import { TeamProjects } from './application/team-projects.service.js';

import { ProjectFinanceReferences } from './application/project-finance-references.js';
