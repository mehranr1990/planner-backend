import { CompanyGoalsService } from './application/company-goals.service.js';
import { CompanyRoomsService } from './application/company-rooms.service.js';
import { CompanyKnowledgePagesService } from './application/company-knowledge-pages.service.js';
import { CompanyPaymentRunsService } from './application/company-payment-runs.service.js';
import { CompanyEmployeeFilesService } from './application/company-employee-files.service.js';
import {
  CompanyGapContextController,
  CompanyGapController,
} from './http/company-gap.controller.js';
import { CompanyStaffContext } from './application/company-staff.context.js';
import { CompanyStaffService } from './application/company-staff.service.js';
import { CompanyEmployeeCasesService } from './application/company-employee-cases.service.js';
import { CompanyStaffController } from './http/company-staff.controller.js';
import { CompanyResourceRequestsService } from './application/company-resource-requests.service.js';
import {
  CompanyCompletionController,
  CompanySettingsController,
} from './http/company-completion.controller.js';
import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/public/index.js';
import { MeetingsModule } from '../meetings/public/index.js';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { AuditModule } from '../../platform/audit/audit.service.js';
import { SpacesModule } from '../spaces/public/index.js';
import { CompaniesService } from './application/companies.service.js';
import {
  CompaniesController,
  CompanyInvitationsController,
  CompanyInvitationProofController,
  CompanyInvitationPreviewController,
  CompanyGuard,
} from './http/companies.controller.js';
@Module({
  imports: [
    DatabaseModule,
    SpacesModule,
    AuditModule,
    MessagingModule,
    MeetingsModule,
  ],
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
    CompanyInvitationProofController,
    CompanyInvitationPreviewController,
  ],
  exports: [CompaniesService, CompanyStaffService, CompanyEmployeeCasesService],
})
export class CompaniesModule {
  static register(
    projects: DynamicModule,
    storage: DynamicModule,
    teams: DynamicModule,
    calendar: DynamicModule,
    goals: DynamicModule,
  ): DynamicModule {
    return {
      module: CompaniesModule,
      imports: [projects, storage, teams, calendar, goals],
      providers: [
        CompanyAssociationsService,
        CompanyResourceRequestsService,
        CompanyCleanupService,
        CompanyLifecycleService,
        CompanyKnowledgeService,
        CompanyKnowledgeFilesService,
        CompanyReportsService,
        CompanyFinanceService,
        CompanyReceiptService,
        CompanyFinanceExtensions,
        CompanyReimbursementsService,
        CompanyFinancialApprovalsService,
        CompanyFinanceRequestsService,
        CompanyGoalsService,
        CompanyRoomsService,
        CompanyKnowledgePagesService,
        CompanyPaymentRunsService,
        CompanyEmployeeFilesService,
      ],
      controllers: [
        CompanySettingsController,
        CompanyCompletionController,
        CompanyAssociationsController,
        CompanyLifecycleController,
        CompanyFinanceController,
        CompanyFinanceRequestsController,
        CompanyGapContextController,
        CompanyGapController,
        CompanySettlementsController,
        CompanyKnowledgeController,
      ],
      exports: [
        CompanyCleanupService,
        CompanyLifecycleService,
        CompanyFinanceService,
        CompanyReceiptService,
        CompanyReimbursementsService,
        CompanyFinancialApprovalsService,
      ],
    };
  }
}

import { CompanyFinanceService } from './application/company-finance.service.js';
import { CompanyReceiptService } from './application/company-receipt.service.js';
import { CompanyFinanceController } from './http/company-finance.controller.js';
import { CompanyFinanceRequestsController } from './http/company-finance-requests.controller.js';
import { CompanyFinanceRequestsService } from './application/company-finance-requests.service.js';

import { CompanyFinanceExtensions } from './application/company-finance.extensions.js';
import { CompanyReimbursementsService } from './application/company-reimbursements.service.js';
import { CompanyFinancialApprovalsService } from './application/company-financial-approvals.service.js';
import { CompanySettlementsController } from './http/company-settlements.controller.js';

import { CompanyKnowledgeService } from './application/company-knowledge.service.js';
import { CompanyKnowledgeFilesService } from './application/company-knowledge-files.service.js';
import { CompanyReportsService } from './application/company-reports.service.js';
import { CompanyKnowledgeController } from './http/company-knowledge.controller.js';

import { CompanyLifecycleService } from './application/company-lifecycle.service.js';
import { CompanyLifecycleController } from './http/company-lifecycle.controller.js';

import { CompanyCleanupService } from './application/company-cleanup.service.js';

import { CompanyAssociationsService } from './application/company-associations.service.js';
import { CompanyAssociationsController } from './http/company-associations.controller.js';
