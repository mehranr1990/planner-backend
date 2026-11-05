import type { z } from 'zod';
import type * as c from '@mehran/api-contracts';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import type { SharedAuthority } from '../../spaces/public/index.js';
export abstract class PersonalTaskTransfer {
  abstract preview(
    tx: Prisma.TransactionClient,
    source: AuthorizedSpace,
    selected: z.infer<typeof c.ProjectTransferSelectionSchema>[],
    consent: z.infer<typeof c.ProjectTransferConsentSchema>,
  ): Promise<z.infer<typeof c.ProjectTransferCandidateSchema>[]>;
  abstract apply(
    tx: Prisma.TransactionClient,
    source: AuthorizedSpace,
    a: SharedAuthority,
    destination: string,
    selected: z.infer<typeof c.ProjectTransferSelectionSchema>[],
    now: Date,
  ): Promise<void>;
}
