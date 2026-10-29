import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
export abstract class RewardHabits {
  abstract achieved(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    habitId: string,
    eventId: string,
    now: Date,
  ): Promise<string[]>;
}
