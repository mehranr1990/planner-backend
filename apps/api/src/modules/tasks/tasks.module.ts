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
      imports: [DatabaseModule, AuditModule, SpacesModule, storage],
      providers: [
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
        AnalyticsTasks,
        PlanningTasks,
        ProductivityTasks,
        CaptureTasks,
        ReminderTasks,
      ],
    };
  }
}
