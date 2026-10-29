import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { AuditModule } from '../../platform/audit/audit.service.js';
import { RewardOutbox } from '../../platform/outbox/reward-consumer.js';
import { AccountModule } from '../account/public/index.js';
import { SpacesModule } from '../spaces/public/index.js';
import { HabitsModule } from '../habits/public/index.js';
import { RewardsPort } from './application/rewards.port.js';
import { RewardsRepository } from './infrastructure/rewards.repository.js';
import { RewardsController } from './http/rewards.controller.js';
@Module({})
export class RewardsModule {
  static register(tasks: DynamicModule): DynamicModule {
    return {
      module: RewardsModule,
      imports: [
        AuditModule,
        DatabaseModule,
        AccountModule,
        SpacesModule,
        HabitsModule,
        tasks,
      ],
      providers: [
        RewardOutbox,
        { provide: RewardsPort, useClass: RewardsRepository },
      ],
      controllers: [RewardsController],
      exports: [RewardsPort],
    };
  }
}
