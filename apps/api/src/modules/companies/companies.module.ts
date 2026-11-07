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
  providers: [CompaniesService, CompanyGuard],
  controllers: [
    CompaniesController,
    CompanyInvitationsController,
    CompanyInvitationPreviewController,
  ],
  exports: [CompaniesService],
})
export class CompaniesModule {}
