import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import type { RewardPreferences } from '@mehran/api-contracts';
export abstract class RewardPreferencesAccess {
  abstract read(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
  ): Promise<RewardPreferences>;
  abstract update(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    revision: number,
    value: { enabled: boolean; displayAchievements: boolean },
  ): Promise<RewardPreferences>;
}
