import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import type { InsightReadModel } from '@mehran/api-contracts';
/** Source owner retains all reads and canonical calculations. No source writes. */
export abstract class AnalyticsFocus {
  abstract read(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    range: {
      from: string;
      to: string;
      timezone: string;
      cohort: 'DUE_DATE' | 'SCHEDULED_DATE' | 'COMPLETED_AT';
    },
    now: Date,
  ): Promise<InsightReadModel>;
  /** B4: recorded time entries (TRACKED and MANUAL) overlapping the instants. */
  abstract entries(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    from: Date,
    to: Date,
  ): Promise<{ kind: 'MANUAL' | 'TRACKED'; startAt: string; endAt: string }[]>;
  /**
   * B4 estimates: recorded minutes per task, the union of each task's current
   * RECORDED time entries (TRACKED and MANUAL) so overlaps never count twice.
   * Tasks without recorded time are omitted.
   */
  abstract taskMinutes(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    taskIds: string[],
  ): Promise<Map<string, number>>;
}
