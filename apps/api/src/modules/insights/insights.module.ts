import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { AuditModule } from '../../platform/audit/audit.service.js';
import { AccountModule } from '../account/public/index.js';
import { SpacesModule } from '../spaces/public/index.js';
import { HabitsModule } from '../habits/public/index.js';
import { InsightsService } from './application/insights.service.js';
import { InsightsController } from './http/insights.controller.js';
@Module({})
export class InsightsModule {
  static register(sources: DynamicModule[]): DynamicModule {
    return {
      module: InsightsModule,
      imports: [
        AuditModule,
        DatabaseModule,
        AccountModule,
        SpacesModule,
        HabitsModule,
        ...sources,
      ],
      providers: [InsightsService],
      controllers: [InsightsController],
    };
  }
}
