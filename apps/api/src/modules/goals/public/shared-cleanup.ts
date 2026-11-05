import type { Prisma } from '../../../generated/prisma/client.js';
import type { SharedCleanupScope } from '../../../platform/lifecycle/shared-cleanup.js';
export abstract class SharedGoalsCleanup {
  abstract batch(
    tx: Prisma.TransactionClient,
    scope: SharedCleanupScope,
  ): Promise<boolean>;
}
