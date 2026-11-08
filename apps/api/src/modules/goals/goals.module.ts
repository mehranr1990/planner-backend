import { GoalCustodyGraph } from './application/goals-custody-graph.js';
import { GoalsData } from './public/personal-data.js';
import { PersonalGoalTransfer } from './public/personal-transfer.js';
import { SharedGoalsCleanup } from './public/shared-cleanup.js';
import { SharedGoalsCleanupRepository } from './infrastructure/shared-cleanup.repository.js';
import { PersonalGoalTransferRepository } from './infrastructure/personal-transfer.repository.js';
import { SharedGoals } from './public/shared-goals.js';
import { SharedGoalsRepository } from './infrastructure/shared-goals.repository.js';
import { GoalsDataRepository } from './infrastructure/personal-data.repository.js';
import { AnalyticsGoals } from './public/analytics.js';
import { AnalyticsGoalsRepository } from './infrastructure/analytics.repository.js';
import { PersonalGoals } from './public/personal-goals.js';
import { PersonalGoalsRepository } from './infrastructure/personal-goals.repository.js';
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { AuditModule } from '../../platform/audit/audit.service.js';
import { SpacesModule } from '../spaces/public/index.js';
import { AccountModule } from '../account/public/index.js';
import { HabitsModule } from '../habits/public/index.js';
import {
  GoalsController,
  LifeAreasController,
} from './http/goals.controller.js';
import { GoalsService } from './application/goals.service.js';
import { GOALS_REPOSITORY } from './application/goals.port.js';
import { GoalsRepository } from './infrastructure/goals.repository.js';
@Module({})
export class GoalsModule {
  static register(tasks: DynamicModule): DynamicModule {
    return {
      module: GoalsModule,
      imports: [
        DatabaseModule,
        AuditModule,
        SpacesModule,
        AccountModule,
        HabitsModule,
        tasks,
      ],
      providers: [
        GoalCustodyGraph,
        { provide: SharedGoalsCleanup, useClass: SharedGoalsCleanupRepository },
        {
          provide: PersonalGoalTransfer,
          useClass: PersonalGoalTransferRepository,
        },
        { provide: SharedGoals, useClass: SharedGoalsRepository },
        { provide: GoalsData, useClass: GoalsDataRepository },
        { provide: AnalyticsGoals, useClass: AnalyticsGoalsRepository },
        GoalsService,
        { provide: PersonalGoals, useClass: PersonalGoalsRepository },
        { provide: GOALS_REPOSITORY, useClass: GoalsRepository },
      ],
      controllers: [GoalsController, LifeAreasController],
      exports: [
        GoalCustodyGraph,
        GoalsData,
        AnalyticsGoals,
        PersonalGoals,
        SharedGoals,
        PersonalGoalTransfer,
        SharedGoalsCleanup,
      ],
    };
  }
}
