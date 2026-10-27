import { Injectable, NotFoundException } from '@nestjs/common';

export type PersonalOwnership = {
  id: string;
  kind: string;
  ownerUserId: string;
};

@Injectable()
export class SpacePolicyService {
  assertOwner(
    actorUserId: string,
    space: PersonalOwnership | null | undefined,
  ): asserts space is PersonalOwnership {
    if (
      !space ||
      space.kind !== 'PERSONAL' ||
      space.ownerUserId !== actorUserId
    )
      throw new NotFoundException();
  }
}
