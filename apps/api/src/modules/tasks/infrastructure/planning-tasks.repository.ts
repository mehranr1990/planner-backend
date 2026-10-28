import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { PlanningTasks } from '../public/planning-tasks.js';
import type { PlanningTaskSnapshot } from '../public/planning-tasks.js';
@Injectable()
export class PlanningTasksRepository extends PlanningTasks {
  async lock(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`tasks:${scope.spaceId}`},0))::text`;
  }
  async describe(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    ids: string[],
  ): Promise<PlanningTaskSnapshot[]> {
    const rows = await tx.task.findMany({
      where: { spaceId: scope.spaceId, id: { in: ids } },
      select: {
        id: true,
        revision: true,
        title: true,
        status: true,
        dueAt: true,
        scheduledDate: true,
        deletedAt: true,
        masterRecurrence: { select: { id: true } },
        occurrence: { select: { state: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      revision: row.revision,
      title: row.deletedAt ? null : row.title,
      status: row.status,
      dueAt: row.dueAt?.toISOString() ?? null,
      scheduledDate: row.scheduledDate?.toISOString().slice(0, 10) ?? null,
      deleted: row.deletedAt !== null,
      isMaster: row.masterRecurrence !== null,
      occurrenceState: (row.occurrence?.state ??
        null) as PlanningTaskSnapshot['occurrenceState'],
    }));
  }
}
