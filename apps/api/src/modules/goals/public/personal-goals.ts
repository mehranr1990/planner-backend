import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import type { SearchRequest, PersonalSearchHit } from '@mehran/api-contracts';
export abstract class PersonalGoals {
  abstract require(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    id: string,
  ): Promise<void>;
  abstract search(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    r: SearchRequest,
  ): Promise<PersonalSearchHit[]>;
}
