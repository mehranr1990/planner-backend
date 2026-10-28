import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
export abstract class FinancePreferences {
  abstract read(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
  ): Promise<{
    timezone: string;
    calendar: 'GREGORIAN' | 'JALALI';
    firstDayOfWeek: number;
  }>;
}
