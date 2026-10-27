import { Inject, Injectable } from '@nestjs/common';
import { PersonalSpaceSchema } from '@mehran/api-contracts';
import { SPACES_REPOSITORY } from './spaces.port.js';
import type { SpacesPort } from './spaces.port.js';
import { SpacePolicyService } from '../../../platform/authorization/space-policy.service.js';

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
}
