import { appendSyncChanges } from '../../../platform/sync/change-feed.js';
import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { ProductivityTaskSchema } from '@mehran/api-contracts';
import type { ProductivityTaskPatch } from '@mehran/api-contracts';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import { writeAudit } from '../../../platform/audit/audit.service.js';
import { appendOutbox } from '../../../platform/outbox/outbox.js';
import { ProductivityTasks } from '../public/productivity-tasks.js';
import { PlanningTasks } from '../public/planning-tasks.js';
import type {
  TaskProductivityPort,
  TaskProductivityTransaction,
} from '../application/productivity.port.js';
function quadrant(important: boolean | null, urgent: boolean | null) {
  return important === null || urgent === null
    ? ('UNCLASSIFIED' as const)
    : important
      ? urgent
        ? ('DO' as const)
        : ('SCHEDULE' as const)
      : urgent
        ? ('DELEGATE' as const)
        : ('ELIMINATE' as const);
}
@Injectable()
export class TaskProductivityRepository
  extends ProductivityTasks
  implements TaskProductivityPort
{
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(PlanningTasks) private readonly tasks: PlanningTasks,
  ) {
    super();
  }
  async summary(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    const rows = await tx.task.findMany({
      where: {
        spaceId: scope.spaceId,
        deletedAt: null,
        status: { in: ['OPEN', 'IN_PROGRESS'] },
        masterRecurrence: null,
        OR: [{ occurrence: null }, { occurrence: { state: 'PENDING' } }],
      },
      select: { important: true, urgent: true, estimatedMinutes: true },
      take: 10001,
    });
    if (rows.length > 10000) throw new BadRequestException();
    const quadrants = {
      DO: 0,
      SCHEDULE: 0,
      DELEGATE: 0,
      ELIMINATE: 0,
      UNCLASSIFIED: 0,
    };
    for (const r of rows) quadrants[quadrant(r.important, r.urgent)]++;
    return {
      scope: 'CURRENT_ACTIONABLE' as const,
      count: rows.length,
      estimatedMinutes: rows.reduce((n, r) => n + (r.estimatedMinutes ?? 0), 0),
      unknownEstimates: rows.filter((r) => r.estimatedMinutes === null).length,
      quadrants,
    };
  }
  run<T>(
    scope: AuthorizedSpace,
    work: (tx: TaskProductivityTransaction) => Promise<T>,
  ) {
    return this.db.client.$transaction(
      async (tx) => {
        await this.tasks.lock(tx, scope);
        const read = async (id: string) => {
          const row = await tx.task.findFirst({
            where: { spaceId: scope.spaceId, id, deletedAt: null },
            include: {
              masterRecurrence: { select: { id: true } },
              occurrence: { select: { state: true } },
            },
          });
          if (!row) throw new NotFoundException();
          return {
            ...ProductivityTaskSchema.parse({
              taskId: id,
              revision: row.revision,
              estimatedMinutes: row.estimatedMinutes,
              important: row.important,
              urgent: row.urgent,
              quadrant: quadrant(row.important, row.urgent),
            }),
            unavailable:
              row.masterRecurrence !== null ||
              row.occurrence?.state === 'SKIPPED' ||
              row.occurrence?.state === 'CANCELED',
          };
        };
        return work({
          read,
          update: async (
            id: string,
            revision: number,
            input: ProductivityTaskPatch,
          ) => {
            const fields = Object.keys(input) as Array<
              'estimatedMinutes' | 'important' | 'urgent'
            >;
            const data = {
              ...(input.estimatedMinutes === undefined
                ? {}
                : { estimatedMinutes: input.estimatedMinutes }),
              ...(input.important === undefined
                ? {}
                : { important: input.important }),
              ...(input.urgent === undefined ? {} : { urgent: input.urgent }),
              revision: { increment: 1 },
            };
            if (
              (
                await tx.task.updateMany({
                  where: { spaceId: scope.spaceId, id, revision },
                  data,
                })
              ).count !== 1
            )
              throw new ConflictException();
            await writeAudit(tx, {
              action: 'TASK_PRODUCTIVITY_UPDATE',
              outcome: 'SUCCEEDED',
              actorUserId: scope.actor.userId,
              resourceId: id,
              requestId: scope.actor.requestId,
              correlationId: scope.actor.correlationId,
              productivityFields: fields,
            });
            await appendOutbox(tx, scope, {
              type: 'task.updated',
              version: 1,
              aggregateId: id,
              payload: {},
            });
            await appendSyncChanges(tx, scope, [
              { entity: 'TASK', resourceId: id, revision: revision + 1 },
            ]);
            const { unavailable: _, ...rest } = await read(id);
            return rest;
          },
        });
      },
      { timeout: 30000 },
    );
  }
}
