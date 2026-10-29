import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { ExportBudget } from '../../../platform/lifecycle/personal-data.js';
import { HabitsData } from '../public/personal-data.js';
@Injectable()
export class HabitsDataRepository extends HabitsData {
  async snapshot(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    budget: ExportBudget,
  ) {
    await budget.collect(
      'habit',
      (after: string | undefined) =>
        tx.habit.findMany({
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
      'habitSchedule',
      (after: string | undefined) =>
        tx.habitSchedule.findMany({
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
      'habitEntry',
      (after: string | undefined) =>
        tx.habitEntry.findMany({
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
      'routine',
      (after: string | undefined) =>
        tx.routine.findMany({
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
      'routineHabit',
      (after: { routineId: string; habitId: string } | undefined) =>
        tx.routineHabit.findMany({
          where: {
            spaceId: scope.spaceId,
            ...(after
              ? {
                  OR: [
                    { routineId: { gt: after.routineId } },
                    {
                      routineId: after.routineId,
                      habitId: { gt: after.habitId },
                    },
                  ],
                }
              : {}),
          },
          orderBy: [{ routineId: 'asc' }, { habitId: 'asc' }],
          take: 100,
        }),
      (row) => ({ routineId: row.routineId, habitId: row.habitId }),
    );
  }
  async erase(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    const where = { spaceId: scope.spaceId };
    await tx.routineHabit.deleteMany({ where });
    await tx.routine.deleteMany({ where });
    await tx.habitEntry.deleteMany({ where });
    await tx.habitSchedule.deleteMany({ where });
    await tx.habit.deleteMany({ where });
  }
}
