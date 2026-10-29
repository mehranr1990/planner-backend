import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { RewardPreferencesAccess } from '../public/reward-preferences.js';
import { RewardPreferencesSchema } from '@mehran/api-contracts';
@Injectable()
export class RewardPreferencesRepository extends RewardPreferencesAccess {
  async read(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    const row = await tx.userSettings.findFirst({
      where: { userId: scope.actor.userId, user: { emailVerified: true } },
      select: {
        revision: true,
        rewardsEnabled: true,
        rewardsEnabledSince: true,
        rewardsDisplayAchievements: true,
      },
    });
    if (!row) throw new NotFoundException();
    return RewardPreferencesSchema.parse({
      revision: row.revision,
      enabled: row.rewardsEnabled,
      enabledSince: row.rewardsEnabledSince?.toISOString() ?? null,
      displayAchievements: row.rewardsDisplayAchievements,
    });
  }
  async update(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    revision: number,
    value: { enabled: boolean; displayAchievements: boolean },
  ) {
    await tx.$queryRaw`SELECT "userId" FROM "UserSettings" WHERE "userId"=${scope.actor.userId}::uuid FOR UPDATE`;
    const before = await this.read(tx, scope);
    if (before.revision !== revision) throw new ConflictException();
    if (
      before.enabled === value.enabled &&
      before.displayAchievements === value.displayAchievements
    )
      return before;
    const clock = await tx.$queryRaw<
      Array<{ now: Date }>
    >`SELECT clock_timestamp() AS now`;
    const now = clock[0]!.now;
    const updated = await tx.userSettings.updateMany({
      where: { userId: scope.actor.userId, revision },
      data: {
        rewardsEnabled: value.enabled,
        rewardsDisplayAchievements: value.displayAchievements,
        ...(value.enabled && !before.enabled
          ? { rewardsEnabledSince: now }
          : {}),
        revision: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new ConflictException();
    return this.read(tx, scope);
  }
}
