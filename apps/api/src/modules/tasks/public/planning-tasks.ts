import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';

export type PlanningTaskSnapshot = {
  id: string;
  revision: number;
  title: string | null;
  status: 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELED';
  dueAt: string | null;
  scheduledDate: string | null;
  deleted: boolean;
  isMaster: boolean;
  occurrenceState: 'PENDING' | 'DONE' | 'SKIPPED' | 'CANCELED' | null;
};
/** Narrow owner read contract for a caller-owned linking transaction. No Task writes. */
export abstract class PlanningTasks {
  abstract lock(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
  ): Promise<void>;
  abstract describe(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    ids: string[],
  ): Promise<PlanningTaskSnapshot[]>;
}
