import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import type { Availability } from '@mehran/api-contracts';
export type PlanningPreferencesSnapshot = {
  timezone: string;
  firstDayOfWeek: number;
  revision: number;
  availability: Availability | null;
};
/** Account-owned settings access within a narrowly scoped linking transaction. */
export abstract class PlanningPreferences {
  abstract read(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
  ): Promise<PlanningPreferencesSnapshot>;
  abstract setAvailability(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    revision: number,
    availability: Availability | null,
  ): Promise<PlanningPreferencesSnapshot>;
}
