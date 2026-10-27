import { Inject, Injectable } from '@nestjs/common';
import { PersonalSpaceSchema } from '@mehran/api-contracts';
import { SPACES_REPOSITORY } from './spaces.port.js';
import type { SpacesPort } from './spaces.port.js';
import { SpacePolicyService } from '../../../platform/authorization/space-policy.service.js';
import { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';

@Injectable()
export class SpacesService {
  constructor(
    @Inject(SPACES_REPOSITORY) private readonly repository: SpacesPort,
    @Inject(SpacePolicyService) private readonly policy: SpacePolicyService,
  ) {}
  async personalFor(userId: string) {
    const space = await this.repository.personalFor(userId);
    this.policy.assertOwner(userId, space);
    return PersonalSpaceSchema.parse({
      ...space,
      createdAt: space.createdAt.toISOString(),
      updatedAt: space.updatedAt.toISOString(),
    });
  }
  async assertOwned(userId: string, spaceId: string) {
    const space = await this.repository.findOwned(userId, spaceId);
    this.policy.assertOwner(userId, space);
    return space.id;
  }
  async authorizePersonal(actor: RequestActor) {
    const space = await this.repository.personalFor(actor.userId);
    this.policy.assertOwner(actor.userId, space);
    return AuthorizedSpace.personal(actor, space);
  }
}
