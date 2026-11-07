import { CompanyStaffContext } from './application/company-staff.context.js';
import { CompanyStaffService } from './application/company-staff.service.js';
import { CompanyEmployeeCasesService } from './application/company-employee-cases.service.js';
import { CompanyStaffController } from './http/company-staff.controller.js';
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
export class CompaniesModule {}
