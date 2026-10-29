import { AnalyticsFocus } from './public/analytics.js';
import { AnalyticsFocusRepository } from './infrastructure/analytics.repository.js';
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { AuditModule } from '../../platform/audit/audit.service.js';
import { SpacesModule } from '../spaces/public/index.js';
import { AccountModule } from '../account/public/index.js';
import { FocusService } from './application/focus.service.js';
import { FOCUS_REPOSITORY } from './application/focus.port.js';
import { FocusRepository } from './infrastructure/focus.repository.js';
import {
  FocusController,
  TimeEntriesController,
  ProductivityController,
} from './http/focus.controller.js';
@Module({})
export class FocusModule {
  static register(tasks: DynamicModule): DynamicModule {
    return {
      module: FocusModule,
      imports: [
        DatabaseModule,
        AuditModule,
        SpacesModule,
        AccountModule,
        tasks,
      ],
      providers: [
        { provide: AnalyticsFocus, useClass: AnalyticsFocusRepository },
        FocusService,
        { provide: FOCUS_REPOSITORY, useClass: FocusRepository },
      ],
      exports: [AnalyticsFocus],
      controllers: [
        FocusController,
        TimeEntriesController,
        ProductivityController,
      ],
    };
  }
}
