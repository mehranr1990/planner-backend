import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { AuditModule } from '../../platform/audit/audit.service.js';
import { SpacesModule } from '../spaces/public/index.js';
import { AccountModule } from '../account/public/index.js';
import {
  HabitsController,
  RoutinesController,
} from './http/habits.controller.js';
import { HabitsService } from './application/habits.service.js';
import { HABITS_REPOSITORY } from './application/habits.port.js';
import {
  HabitsRepository,
  GoalHabitsRepository,
} from './infrastructure/habits.repository.js';
import { GoalHabits } from './public/goal-habits.js';
@Module({
  imports: [DatabaseModule, AuditModule, SpacesModule, AccountModule],
  providers: [
    HabitsService,
    { provide: GoalHabits, useClass: GoalHabitsRepository },
    { provide: HABITS_REPOSITORY, useClass: HabitsRepository },
  ],
  controllers: [HabitsController, RoutinesController],
  exports: [GoalHabits],
})
export class HabitsModule {}
