import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { ExportBudget } from '../../../platform/lifecycle/personal-data.js';
import { RewardsData } from '../public/personal-data.js';
@Injectable()
export class RewardsDataRepository extends RewardsData {
  async snapshot(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    budget: ExportBudget,
  ) {
    await budget.collect(
      'xpLedger',
      (after: string | undefined) =>
        tx.xpLedger.findMany({
          where: {
            spaceId: scope.spaceId,
            ...(after ? { id: { gt: after } } : {}),
          },
          orderBy: { id: 'asc' },
          take: 100,
        }),
      (row) => row.id,
    );
    await budget.collect(
      'achievementUnlock',
      (after: string | undefined) =>
        tx.achievementUnlock.findMany({
          where: {
            spaceId: scope.spaceId,
            ...(after ? { id: { gt: after } } : {}),
          },
          orderBy: { id: 'asc' },
          take: 100,
        }),
      (row) => row.id,
    );
  }
  async erase(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    const where = { spaceId: scope.spaceId };
    await tx.achievementUnlock.deleteMany({ where });
    await tx.xpLedger.deleteMany({ where });
  }
}
