import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { AuditModule } from '../../platform/audit/audit.service.js';
import { SpacesModule } from '../spaces/public/index.js';
import { AccountModule } from '../account/public/index.js';
import { PlanningController } from './http/planning.controller.js';
import { PlanningService } from './application/planning.service.js';
import { PLANNING_REPOSITORY } from './application/planning.port.js';
import { PlanningRepository } from './infrastructure/planning.repository.js';
@Module({})
export class PlanningModule {
  static register(tasks: DynamicModule): DynamicModule {
    return {
      module: PlanningModule,
      imports: [
        DatabaseModule,
        AuditModule,
        SpacesModule,
        AccountModule,
        tasks,
      ],
      providers: [
        PlanningService,
        { provide: PLANNING_REPOSITORY, useClass: PlanningRepository },
      ],
      controllers: [PlanningController],
    };
  }
}
