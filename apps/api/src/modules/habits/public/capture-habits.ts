import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import type { HabitEntryCreate } from '@mehran/api-contracts';
export abstract class CaptureHabits {
  abstract record(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    id: string,
    input: HabitEntryCreate,
  ): Promise<{ id: string; habitId: string; revision: number }>;
}
