import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import type { z } from 'zod';
import type * as c from '@mehran/api-contracts';
export type PrivateSharedBlock = {
  blockId: string;
  revision: number;
  link: z.infer<typeof c.SharedTaskBlockLinkSchema> | null;
};
export abstract class SharedScheduling {
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
