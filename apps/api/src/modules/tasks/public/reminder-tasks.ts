import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
export type ReminderTask = {
  id: string;
  revision: number;
  status: string;
  dueAt: Date | null;
  plannedStartAt: Date | null;
  scheduledDate: Date | null;
  deletedAt: Date | null;
  master: boolean;
  occurrenceState: string | null;
};
/** Read-only scheduling snapshot; Tasks retains all Task writes. */
export abstract class ReminderTasks {
  abstract lock(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
  ): Promise<void>;
  abstract read(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    id: string,
  ): Promise<ReminderTask | null>;
}
