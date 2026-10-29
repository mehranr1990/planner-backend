import { PlanningData } from './public/personal-data.js';
import { PlanningDataRepository } from './infrastructure/personal-data.repository.js';
import { PlanningSync } from './public/sync-access.js';
import { PlanningSyncRepository } from './infrastructure/sync.repository.js';
import { AnalyticsPlanning } from './public/analytics.js';
import { AnalyticsPlanningRepository } from './infrastructure/analytics.repository.js';
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
        { provide: PlanningData, useClass: PlanningDataRepository },
        { provide: PlanningSync, useClass: PlanningSyncRepository },
        { provide: AnalyticsPlanning, useClass: AnalyticsPlanningRepository },
        PlanningService,
        { provide: PLANNING_REPOSITORY, useClass: PlanningRepository },
      ],
      exports: [PlanningData, PlanningSync, AnalyticsPlanning],
      controllers: [PlanningController],
    };
  }
}
