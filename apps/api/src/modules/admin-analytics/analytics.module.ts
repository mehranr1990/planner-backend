import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { AdminModule } from '../../platform/admin/admin.module.js';
import { AuditModule } from '../../platform/audit/audit.service.js';
import { CommerceModule } from '../admin-commerce/public/index.js';
import {
  AnalyticsController,
  AnalyticsNavigationController,
} from './analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';
import { AnalyticsWorker } from './analytics.worker.js';
@Module({})
export class AnalyticsModule {
  static register(
    imports: NonNullable<DynamicModule['imports']>,
    authority: Provider,
  ): DynamicModule {
    return {
      module: AnalyticsModule,
      imports: [
        DatabaseModule,
        AdminModule,
        AuditModule,
        CommerceModule,
        ...imports,
      ],
      controllers: [AnalyticsController, AnalyticsNavigationController],
      providers: [AnalyticsService, AnalyticsWorker, authority],
      exports: [AnalyticsWorker],
    };
  }
}
