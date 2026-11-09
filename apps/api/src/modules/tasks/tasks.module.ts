import { TaskCustodyGraph } from './application/tasks-custody-graph.js';
import { TasksData } from './public/personal-data.js';
import { PersonalTaskTransfer } from './public/personal-transfer.js';
import { SharedTasksCleanup } from './public/shared-cleanup.js';
import { SharedTasksCleanupRepository } from './infrastructure/shared-cleanup.repository.js';
import { PersonalTaskTransferRepository } from './infrastructure/personal-transfer.repository.js';
import { SharedTaskWork } from './public/shared-task-work.js';
import { SharedTaskWorkRepository } from './infrastructure/shared-task-work.repository.js';
import { SharedTasks } from './public/shared-tasks.js';
import { ProjectTaskTools } from './public/project-tools.js';
import { ProjectTaskToolsRepository } from './infrastructure/project-tools.repository.js';
import { WorkflowTools } from './infrastructure/workflow-tools.repository.js';
import { FieldTools } from './infrastructure/field-tools.repository.js';
import { DependencyTools } from './infrastructure/dependency-tools.repository.js';
import { SharedTasksRepository } from './infrastructure/shared-tasks.repository.js';
import { TasksDataRepository } from './infrastructure/personal-data.repository.js';
import { TasksSync } from './public/sync-access.js';
import { TasksSyncRepository } from './infrastructure/sync.repository.js';
import { AnalyticsTasks } from './public/analytics.js';
import { AnalyticsTasksRepository } from './infrastructure/analytics.repository.js';
import { CaptureTasks } from './public/capture-tasks.js';
import { ReminderTasks } from './public/reminder-tasks.js';
import { ReminderTasksRepository } from './infrastructure/reminder-tasks.repository.js';
import { CaptureTasksRepository } from './infrastructure/tasks.repository.js';
import { TaskProductivityController } from './http/productivity.controller.js';
import { TaskProductivityService } from './application/productivity.service.js';
import { TASK_PRODUCTIVITY } from './application/productivity.port.js';
import { TaskProductivityRepository } from './infrastructure/productivity.repository.js';
import { ProductivityTasks } from './public/productivity-tasks.js';
import { Module } from '@nestjs/common';
import { MeetingsModule } from '../meetings/public/kernel.js';
import type { DynamicModule } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { AuditModule } from '../../platform/audit/audit.service.js';
import { SpacesModule } from '../spaces/public/index.js';
import { TasksService } from './application/tasks.service.js';
import { TaskToolsService } from './application/task-tools.service.js';
import { RecurrenceService } from './application/recurrence.service.js';
import {
  TaskToolsController,
  RecurrenceController,
} from './http/task-tools.controller.js';
import { TASKS_REPOSITORY } from './application/tasks.port.js';
import { TasksRepository } from './infrastructure/tasks.repository.js';
import { PlanningTasks } from './public/planning-tasks.js';
import { PlanningTasksRepository } from './infrastructure/planning-tasks.repository.js';
import { TasksController, LabelsController } from './http/tasks.controller.js';

@Module({})
export class TasksModule {
  static register(storage: DynamicModule): DynamicModule {
    return {
      module: TasksModule,
      imports: [
        DatabaseModule,
        AuditModule,
        SpacesModule,
        MeetingsModule,
        storage,
      ],
      providers: [
        TaskCustodyGraph,
        { provide: SharedTasksCleanup, useClass: SharedTasksCleanupRepository },
        {
          provide: PersonalTaskTransfer,
          useClass: PersonalTaskTransferRepository,
        },
        { provide: SharedTaskWork, useClass: SharedTaskWorkRepository },
        WorkflowTools,
        FieldTools,
        DependencyTools,
        { provide: ProjectTaskTools, useClass: ProjectTaskToolsRepository },
        { provide: SharedTasks, useClass: SharedTasksRepository },
        { provide: TasksData, useClass: TasksDataRepository },
        { provide: TasksSync, useClass: TasksSyncRepository },
        { provide: AnalyticsTasks, useClass: AnalyticsTasksRepository },
        TasksService,
        { provide: ReminderTasks, useClass: ReminderTasksRepository },
        { provide: CaptureTasks, useClass: CaptureTasksRepository },
        TaskProductivityService,
        TaskProductivityRepository,
        { provide: TASK_PRODUCTIVITY, useExisting: TaskProductivityRepository },
        { provide: ProductivityTasks, useExisting: TaskProductivityRepository },
        TaskToolsService,
        RecurrenceService,
        { provide: PlanningTasks, useClass: PlanningTasksRepository },
        { provide: TASKS_REPOSITORY, useClass: TasksRepository },
      ],
      controllers: [
        TaskToolsController,
        RecurrenceController,
        TasksController,
        TaskProductivityController,
        LabelsController,
      ],
      exports: [
        TaskCustodyGraph,
        SharedTasksCleanup,
        PersonalTaskTransfer,
        SharedTaskWork,
        ProjectTaskTools,
        SharedTasks,
        TasksData,
        TasksSync,
        AnalyticsTasks,
        PlanningTasks,
        ProductivityTasks,
        CaptureTasks,
        ReminderTasks,
      ],
    };
  }
}
