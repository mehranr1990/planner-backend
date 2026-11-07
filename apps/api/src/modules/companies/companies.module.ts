import { CompanyStaffContext } from './application/company-staff.context.js';
import { CompanyStaffService } from './application/company-staff.service.js';
import { CompanyEmployeeCasesService } from './application/company-employee-cases.service.js';
import { CompanyStaffController } from './http/company-staff.controller.js';
import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { AuditModule } from '../../platform/audit/audit.service.js';
import { SpacesModule } from '../spaces/public/index.js';
import { CompaniesService } from './application/companies.service.js';
import {
  CompaniesController,
  CompanyInvitationsController,
  CompanyInvitationPreviewController,
  CompanyGuard,
} from './http/companies.controller.js';
@Module({
  imports: [DatabaseModule, SpacesModule, AuditModule],
  providers: [
    CompaniesService,
    CompanyGuard,
    CompanyStaffContext,
    CompanyStaffService,
    CompanyEmployeeCasesService,
  ],
  controllers: [
    CompanyStaffController,
    CompaniesController,
    CompanyInvitationsController,
    CompanyInvitationPreviewController,
  ],
  exports: [CompaniesService, CompanyStaffService, CompanyEmployeeCasesService],
})
export class CompaniesModule {
  static register(
    projects: DynamicModule,
    storage: DynamicModule,
  ): DynamicModule {
    return {
      module: CompaniesModule,
      imports: [projects, storage],
      providers: [CompanyFinanceService, CompanyReceiptService],
      controllers: [CompanyFinanceController],
      exports: [CompanyFinanceService, CompanyReceiptService],
    };
  }
}

import { CompanyFinanceService } from './application/company-finance.service.js';
import { CompanyReceiptService } from './application/company-receipt.service.js';
import { CompanyFinanceController } from './http/company-finance.controller.js';
