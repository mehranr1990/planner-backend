import { JournalModule } from '../journal/public/index.js';
import { InsightPatternsService } from './application/insight-patterns.service.js';
import { InsightPatternsController } from './http/insight-patterns.controller.js';
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
        JournalModule,
        ...sources,
      ],
      providers: [InsightsService, InsightPatternsService],
      // Static 'patterns' must register before the ':family' route.
      controllers: [InsightPatternsController, InsightsController],
    };
  }
}
