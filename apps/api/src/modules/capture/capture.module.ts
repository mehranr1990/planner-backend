import { CaptureData } from './public/personal-data.js';
import { CaptureDataRepository } from './infrastructure/personal-data.repository.js';
import { CaptureSync } from './public/sync-access.js';
import { CaptureSyncRepository } from './infrastructure/sync.repository.js';
import { FinanceCaptures } from './public/finance-captures.js';
import { FinanceCapturesRepository } from './infrastructure/capture.repository.js';
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { AuditModule } from '../../platform/audit/audit.service.js';
import { SpacesModule } from '../spaces/public/index.js';
import { AccountModule } from '../account/public/index.js';
import { HabitsModule } from '../habits/public/index.js';
import { JournalModule } from '../journal/public/index.js';
import { CaptureService } from './application/capture.service.js';
import { CAPTURE_REPOSITORY } from './application/capture.port.js';
import { CaptureRepository } from './infrastructure/capture.repository.js';
import {
  CaptureController,
  PersonalSearchController,
} from './http/capture.controller.js';
@Module({})
export class CaptureModule {
  static register(
    tasks: DynamicModule,
    goals: DynamicModule,
    notes: DynamicModule,
    storage: DynamicModule,
  ): DynamicModule {
    return {
      module: CaptureModule,
      imports: [
        DatabaseModule,
        AuditModule,
        SpacesModule,
        AccountModule,
        HabitsModule,
        JournalModule,
        tasks,
        goals,
        notes,
        storage,
      ],
      providers: [
        { provide: CaptureData, useClass: CaptureDataRepository },
        { provide: CaptureSync, useClass: CaptureSyncRepository },
        CaptureService,
        CaptureRepository,
        { provide: FinanceCaptures, useClass: FinanceCapturesRepository },
        { provide: CAPTURE_REPOSITORY, useExisting: CaptureRepository },
      ],
      controllers: [CaptureController, PersonalSearchController],
      exports: [CaptureData, CaptureSync, FinanceCaptures],
    };
  }
}
