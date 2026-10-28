import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';

export type GoalHabitSnapshot = {
  id: string;
  revision: number;
  timezone: string;
  asOfDate: string;
  scheduleIds: string[];
  entries: Array<{ id: string; revision: number }>;
  numerator: number;
  denominator: number;
};
/** Owner-authorized canonical habit completion reads; never writes habit state. */
export abstract class GoalHabits {
  abstract lock(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
  ): Promise<void>;
  abstract describe(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    habitId: string,
    range: { from: string; to: string },
    now: Date,
  ): Promise<GoalHabitSnapshot>;
}
