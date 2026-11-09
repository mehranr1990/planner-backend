import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import type {
  TaskCreate,
  SearchRequest,
  PersonalSearchHit,
} from '@mehran/api-contracts';
export abstract class CaptureTasks {
  /** Exact owner-scoped Task reference for explicit meeting action-item linking. */
  abstract read(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    id: string,
  ): Promise<{ id: string; revision: number; title: string }>;
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
