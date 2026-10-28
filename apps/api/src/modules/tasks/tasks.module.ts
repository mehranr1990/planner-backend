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
        TasksService,
        TaskToolsService,
        RecurrenceService,
        { provide: PlanningTasks, useClass: PlanningTasksRepository },
        { provide: TASKS_REPOSITORY, useClass: TasksRepository },
      ],
      controllers: [
        TaskToolsController,
        RecurrenceController,
        TasksController,
        LabelsController,
      ],
      exports: [PlanningTasks],
    };
  }
}
