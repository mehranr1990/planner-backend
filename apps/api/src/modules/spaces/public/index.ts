export { SpacesModule } from '../spaces.module.js';
export { SpacesService } from '../application/spaces.service.js';
export { initialSpaceRelations } from './identity-creation.js';
export { personalScope } from './personal-scope.js';
export { SharedKernel } from '../application/shared-kernel.service.js';
export { SharedLifecycleService } from '../application/shared-lifecycle.service.js';
export type {
  LifecycleFile,
  LifecycleStep,
} from '../application/shared-lifecycle.service.js';
export { SharedAuthority } from './shared-authority.js';
export type { SharedRequest } from '../application/shared-kernel.service.js';
export { CollaborationService } from '../application/collaboration.service.js';
export { ResourceGrants } from '../application/resource-grants.service.js';
export {
  SharedFeaturePolicy,
  sharedFeatureKeys,
  freeSharedFeaturePolicy,
} from './shared-features.js';
export type {
  SharedFeatureKey,
  SharedFeatureDecisionInput,
} from './shared-features.js';

export { CompanyAccess } from '../application/company-access.service.js';
export { MessagingAuthority } from './messaging-authority.js';
export { CompanyErasure } from './company-erasure.js';
export type { CompanyTransaction } from '../application/company-access.service.js';
