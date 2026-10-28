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
        CaptureService,
        { provide: CAPTURE_REPOSITORY, useClass: CaptureRepository },
      ],
      controllers: [CaptureController, PersonalSearchController],
    };
  }
}
