import { Global, Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { OperationsPolicy } from './operations-policy.js';
import { QueueControl } from './queue-control.js';
import { ApiMetrics } from './api-metrics.js';
import { SystemHealth } from './system-health.js';
import { BackupRuns } from './backup-runs.js';
import { OperationsControl } from './operations-control.js';
import { OperationsController } from './operations.controller.js';
import { OperationsWorker } from './operations-worker.js';
import { BackupOperator } from './backup-operator.js';
@Global()
@Module({})
export class OperationsModule {
  static register(storage: DynamicModule): DynamicModule {
    return {
      module: OperationsModule,
      imports: [DatabaseModule, AdminModule, storage],
      providers: [
        OperationsPolicy,
        QueueControl,
        ApiMetrics,
        SystemHealth,
        BackupRuns,
        BackupOperator,
        OperationsControl,
        OperationsWorker,
      ],
      controllers: [OperationsController],
      exports: [
        ApiMetrics,
        OperationsControl,
        OperationsWorker,
        BackupRuns,
        BackupOperator,
      ],
    };
  }
}
