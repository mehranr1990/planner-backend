import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { FinancePreferences } from '../public/finance-preferences.js';
@Injectable()
export class FinancePreferencesRepository extends FinancePreferences {
  async read(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    const [p] = await tx.$queryRaw<
      Array<{
        timezone: string;
        preferredCalendar: 'GREGORIAN' | 'JALALI';
        firstDayOfWeek: number;
      }>
    >`SELECT timezone,"preferredCalendar","firstDayOfWeek" FROM "UserSettings" WHERE "userId"=${scope.actor.userId}::uuid FOR SHARE`;
    if (!p) throw new NotFoundException();
    return {
      timezone: p.timezone,
      calendar: p.preferredCalendar,
      firstDayOfWeek: p.firstDayOfWeek,
    };
  }
}
