import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import type {
  RewardPreferences,
  RewardProgressSchema,
  AchievementsSchema,
  RewardRecalculatedSchema,
} from '@mehran/api-contracts';
import type { z } from 'zod';
export abstract class RewardsPort {
  abstract preferences(scope: AuthorizedSpace): Promise<RewardPreferences>;
  abstract setPreferences(
    scope: AuthorizedSpace,
    revision: number,
    key: string,
    value: { enabled: boolean; displayAchievements: boolean },
  ): Promise<RewardPreferences>;
  abstract progress(
    scope: AuthorizedSpace,
    q: { cursor?: string | undefined; limit?: string | undefined },
  ): Promise<z.infer<typeof RewardProgressSchema>>;
  abstract achievements(
    scope: AuthorizedSpace,
  ): Promise<z.infer<typeof AchievementsSchema>>;
  abstract recalculate(
    scope: AuthorizedSpace,
    revision: number,
    key: string,
    q: { after?: string | undefined; limit: number },
  ): Promise<z.infer<typeof RewardRecalculatedSchema>>;
  abstract consume(): Promise<boolean>;
}
