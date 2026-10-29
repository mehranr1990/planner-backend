import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
/** Verified delivery address and current zone, never authentication/session material. */
export abstract class NotificationIdentity {
  abstract read(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
  ): Promise<{ timezone: string; email: string } | null>;
}
