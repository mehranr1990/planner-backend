import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { ExportBudget } from '../../../platform/lifecycle/personal-data.js';
import { TasksData } from '../public/personal-data.js';
@Injectable()
export class TasksDataRepository extends TasksData {
  async snapshot(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    budget: ExportBudget,
  ) {
    await budget.collect(
      'task',
      (after: string | undefined) =>
        tx.task.findMany({
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
      'taskChecklistItem',
      (after: string | undefined) =>
        tx.taskChecklistItem.findMany({
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
      'label',
      (after: string | undefined) =>
        tx.label.findMany({
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
      'taskLabel',
      (after: { taskId: string; labelId: string } | undefined) =>
        tx.taskLabel.findMany({
          where: {
            spaceId: scope.spaceId,
            ...(after
              ? {
                  OR: [
                    { taskId: { gt: after.taskId } },
                    { taskId: after.taskId, labelId: { gt: after.labelId } },
                  ],
                }
              : {}),
          },
          orderBy: [{ taskId: 'asc' }, { labelId: 'asc' }],
          take: 100,
        }),
      (row) => ({ taskId: row.taskId, labelId: row.labelId }),
    );
    await budget.collect(
      'taskAttachment',
      (after: { taskId: string; fileId: string } | undefined) =>
        tx.taskAttachment.findMany({
          where: {
            spaceId: scope.spaceId,
            ...(after
              ? {
                  OR: [
                    { taskId: { gt: after.taskId } },
                    { taskId: after.taskId, fileId: { gt: after.fileId } },
                  ],
                }
              : {}),
          },
          orderBy: [{ taskId: 'asc' }, { fileId: 'asc' }],
          take: 100,
        }),
      (row) => ({ taskId: row.taskId, fileId: row.fileId }),
    );
    await budget.collect(
      'taskChange',
      (after: string | undefined) =>
        tx.taskChange.findMany({
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
      'taskTemplate',
      (after: string | undefined) =>
        tx.taskTemplate.findMany({
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
      'savedTaskFilter',
      (after: string | undefined) =>
        tx.savedTaskFilter.findMany({
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
      'taskRecurrence',
      (after: string | undefined) =>
        tx.taskRecurrence.findMany({
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
      'taskOccurrence',
      (after: string | undefined) =>
        tx.taskOccurrence.findMany({
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
    await tx.task.updateMany({ where, data: { parentTaskId: null } });
    await tx.taskOccurrence.deleteMany({ where });
    await tx.taskRecurrence.deleteMany({ where });
    await tx.taskChange.deleteMany({ where });
    await tx.taskAttachment.deleteMany({ where });
    await tx.taskLabel.deleteMany({ where });
    await tx.taskChecklistItem.deleteMany({ where });
    await tx.savedTaskFilter.deleteMany({ where });
    await tx.taskTemplate.deleteMany({ where });
    await tx.label.deleteMany({ where });
    await tx.task.deleteMany({ where });
  }
}
