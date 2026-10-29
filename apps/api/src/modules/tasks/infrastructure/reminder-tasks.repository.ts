import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { ReminderTasks } from '../public/reminder-tasks.js';
@Injectable()
export class ReminderTasksRepository extends ReminderTasks {
  async lock(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    await scope.fence(tx);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`tasks:${scope.spaceId}`},0))::text`;
  }
  async read(tx: Prisma.TransactionClient, scope: AuthorizedSpace, id: string) {
    const r = await tx.task.findFirst({
      where: { spaceId: scope.spaceId, id },
      select: {
        id: true,
        revision: true,
        status: true,
        dueAt: true,
        plannedStartAt: true,
        scheduledDate: true,
        deletedAt: true,
        masterRecurrence: { select: { id: true } },
        occurrence: { select: { state: true } },
      },
    });
    if (!r) return null;
    const { masterRecurrence, occurrence, ...row } = r;
    return {
      ...row,
      master: !!masterRecurrence,
      occurrenceState: occurrence?.state ?? null,
    };
  }
}
