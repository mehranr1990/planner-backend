import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import type {
  TaskCreate,
  SearchRequest,
  PersonalSearchHit,
} from '@mehran/api-contracts';
export abstract class CaptureTasks {
  abstract create(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    input: TaskCreate,
  ): Promise<{ id: string; revision: number }>;
  abstract search(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    request: SearchRequest,
  ): Promise<PersonalSearchHit[]>;
}
