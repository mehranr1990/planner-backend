import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { ExportBudget } from '../../../platform/lifecycle/personal-data.js';
import { CaptureData } from '../public/personal-data.js';
@Injectable()
export class CaptureDataRepository extends CaptureData {
  override async detach(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    await tx.captureItem.updateMany({
      where: { spaceId: scope.spaceId },
      data: {
        state: 'ARCHIVED',
        targetTaskId: null,
        targetNoteId: null,
        targetJournalId: null,
        targetHabitId: null,
        targetHabitEntryId: null,
        targetTransactionId: null,
      },
    });
  }
  async snapshot(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    budget: ExportBudget,
  ) {
    await budget.collect(
      'captureItem',
      (after: string | undefined) =>
        tx.captureItem.findMany({
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
    await tx.captureItem.deleteMany({ where });
  }
}
