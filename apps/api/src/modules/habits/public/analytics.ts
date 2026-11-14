import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import type { InsightReadModel } from '@mehran/api-contracts';
/** Source owner retains all reads and canonical calculations. No source writes. */
export abstract class AnalyticsHabits {
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
  /** B4: recorded (done) habit days with the habit title. */
  abstract entries(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    fromDate: string,
    toDate: string,
  ): Promise<{ habitId: string; title: string; localDate: string }[]>;
}
