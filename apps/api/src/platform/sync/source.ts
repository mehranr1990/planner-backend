import type { Prisma } from '../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../authorization/authorized-space.js';
import type {
  SyncCommand,
  SyncResource,
  SyncEntity,
} from '@mehran/api-contracts';
/** A source owner implements only its approved operations and current-state reads. */
export abstract class SyncSource {
  abstract readonly entities: readonly SyncEntity[];
  abstract command(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    c: SyncCommand,
  ): Promise<SyncResource>;
  abstract read(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    entity: SyncEntity,
    id: string,
    parentId?: string,
  ): Promise<SyncResource | null>;
  abstract list(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    entity: SyncEntity,
    after: string | undefined,
    limit: number,
  ): Promise<SyncResource[]>;
}
