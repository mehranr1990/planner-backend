import { Module } from '@nestjs/common';
import type { DynamicModule, Type } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { AuditModule } from '../../platform/audit/audit.service.js';
import { SpacesModule } from '../spaces/public/index.js';
import { SyncService } from './sync.service.js';
import { SyncController } from './sync.controller.js';
@Module({})
export class SyncModule {
  static register(owners: Array<DynamicModule | Type>): DynamicModule {
    return {
      module: SyncModule,
      imports: [DatabaseModule, AuditModule, SpacesModule, ...owners],
      providers: [SyncService],
      controllers: [SyncController],
    };
  }
}
