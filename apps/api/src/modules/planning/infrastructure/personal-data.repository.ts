import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { ExportBudget } from '../../../platform/lifecycle/personal-data.js';
import { PlanningData } from '../public/personal-data.js';
@Injectable()
export class PlanningDataRepository extends PlanningData {
  async snapshot(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    budget: ExportBudget,
  ) {
    await budget.collect(
      'dailyPlan',
      (after: string | undefined) =>
        tx.dailyPlan.findMany({
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
      'dailyPlanItem',
      (after: string | undefined) =>
        tx.dailyPlanItem.findMany({
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
      'weeklyPlan',
      (after: string | undefined) =>
        tx.weeklyPlan.findMany({
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
      'planningReview',
      (after: string | undefined) =>
        tx.planningReview.findMany({
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
    await tx.planningReview.deleteMany({ where });
    await tx.dailyPlanItem.deleteMany({ where });
    await tx.dailyPlan.deleteMany({ where });
    await tx.weeklyPlan.deleteMany({ where });
  }
}
