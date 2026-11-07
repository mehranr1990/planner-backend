import { CompanyAccess } from './application/company-access.service.js';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { SpacesRepository } from './infrastructure/spaces.repository.js';
import { SpacesService } from './application/spaces.service.js';
import { SpacePolicyService } from '../../platform/authorization/space-policy.service.js';
import { SPACES_REPOSITORY } from './application/spaces.port.js';
import { SharedKernel } from './application/shared-kernel.service.js';
import { SharedLifecycleService } from './application/shared-lifecycle.service.js';
import { SharedIdentity } from '../../platform/auth/shared-identity.js';
import { SharedControl } from '../../platform/storage/shared-control.js';
import { AuditModule } from '../../platform/audit/audit.service.js';
import { CollaborationService } from './application/collaboration.service.js';
import { ResourceGrants } from './application/resource-grants.service.js';
import {
  SharedFeaturePolicy,
  freeSharedFeaturePolicy,
} from './public/shared-features.js';
import { CollaborationLimit } from './application/collaboration-limit.js';
import {
  CollaborationGuard,
  SpaceCollaborationController,
  InvitationRecipientController,
} from './http/collaboration.controller.js';

@Module({
  imports: [DatabaseModule, AuditModule],
  providers: [
    CompanyAccess,
    SharedKernel,
    SharedLifecycleService,
    SharedIdentity,
    SharedControl,
    CollaborationService,
    ResourceGrants,
    { provide: SharedFeaturePolicy, useValue: freeSharedFeaturePolicy },
    CollaborationLimit,
    CollaborationGuard,
    { provide: SPACES_REPOSITORY, useClass: SpacesRepository },
    SpacesService,
    SpacePolicyService,
  ],
  controllers: [SpaceCollaborationController, InvitationRecipientController],
  exports: [
    CompanyAccess,
    SpacesService,
    SharedKernel,
    SharedLifecycleService,
    SharedControl,
    CollaborationService,
    ResourceGrants,
    SharedFeaturePolicy,
  ],
})
export class SpacesModule {}
