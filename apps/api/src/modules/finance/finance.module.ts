import { AuditModule } from '../../platform/audit/audit.service.js';
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { SpacesModule } from '../spaces/public/index.js';
import { AccountModule } from '../account/public/index.js';
import { FINANCE_REPOSITORY } from './application/finance.port.js';
import { FinanceRepository } from './infrastructure/finance.repository.js';
import { LedgerService } from './application/ledger.service.js';
import { FinancePlanningService } from './application/planning.service.js';
import { FinanceReportsService } from './application/reports.service.js';
import { FinanceController } from './http/finance.controller.js';
@Module({})
export class FinanceModule {
  static register(capture: DynamicModule): DynamicModule {
    return {
      module: FinanceModule,
      imports: [
        AuditModule,
        DatabaseModule,
        SpacesModule,
        AccountModule,
        capture,
      ],
      providers: [
        { provide: FINANCE_REPOSITORY, useClass: FinanceRepository },
        LedgerService,
        FinancePlanningService,
        FinanceReportsService,
      ],
      controllers: [FinanceController],
    };
  }
}
