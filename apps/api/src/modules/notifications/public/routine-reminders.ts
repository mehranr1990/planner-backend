import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import type { RoutineSchedule } from '@mehran/api-contracts';
export abstract class RoutineReminders {
  abstract sync(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    id: string,
    title: string,
    schedule: RoutineSchedule | null,
  ): Promise<void>;
}
