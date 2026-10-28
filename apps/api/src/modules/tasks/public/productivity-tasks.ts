import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
export type ProductivityTaskSummary = {
  scope: 'CURRENT_ACTIONABLE';
  count: number;
  estimatedMinutes: number;
  unknownEstimates: number;
  quadrants: {
    DO: number;
    SCHEDULE: number;
    DELEGATE: number;
    ELIMINATE: number;
    UNCLASSIFIED: number;
  };
};
export abstract class ProductivityTasks {
  abstract summary(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
  ): Promise<ProductivityTaskSummary>;
}
