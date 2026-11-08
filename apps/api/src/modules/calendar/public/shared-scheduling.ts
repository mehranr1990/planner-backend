import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import type { z } from 'zod';
import type * as c from '@mehran/api-contracts';
import type { SharedCleanupScope } from '../../../platform/lifecycle/shared-cleanup.js';
export type PrivateSharedBlock = {
  blockId: string;
  revision: number;
  link: z.infer<typeof c.SharedTaskBlockLinkSchema> | null;
};
export abstract class SharedScheduling {
  abstract cleanupHints(
    spaceId: string,
    scopeId?: string,
  ): Promise<{ blockIds: string[]; userIds: string[] }>;
  abstract cleanup(
    tx: Prisma.TransactionClient,
    scope: SharedCleanupScope,
    blockIds: string[],
  ): Promise<boolean>;
  abstract read(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    id: string,
  ): Promise<PrivateSharedBlock>;
  abstract change(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    id: string,
    revision: number,
    input: z.infer<typeof c.SharedTaskBlockInputSchema> | null,
  ): Promise<PrivateSharedBlock>;
}
