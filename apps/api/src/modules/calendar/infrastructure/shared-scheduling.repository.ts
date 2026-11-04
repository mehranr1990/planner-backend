import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { writeAudit } from '../../../platform/audit/audit.service.js';
import { appendOutbox } from '../../../platform/outbox/outbox.js';
import { SharedFeaturePolicy } from '../../spaces/public/index.js';
import { SharedScheduling } from '../public/shared-scheduling.js';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
@Injectable()
export class SharedSchedulingRepository extends SharedScheduling {
  constructor(
    @Inject(SharedFeaturePolicy) private readonly features: SharedFeaturePolicy,
  ) {
    super();
  }
  async read(tx: Prisma.TransactionClient, scope: AuthorizedSpace, id: string) {
    await scope.fence(tx);
    const block = await tx.timeBlock.findFirst({
      where: {
        id,
        spaceId: scope.spaceId,
        createdByUserId: scope.actor.userId,
        deletedAt: null,
      },
    });
    if (!block) throw new NotFoundException();
    const row = await tx.timeBlockSharedTaskLink.findUnique({
      where: { blockId: id },
    });
    const link = row
      ? c.SharedTaskBlockLinkSchema.parse({
          blockId: id,
          spaceId: row.spaceId,
          taskId: row.taskId,
          selectedTaskRevision: row.selectedTaskRevision,
          createdAt: row.createdAt.toISOString(),
        })
      : null;
    return { blockId: id, revision: block.revision, link };
  }
  async change(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    id: string,
    revision: number,
    input: z.infer<typeof c.SharedTaskBlockInputSchema> | null,
  ) {
    await scope.fence(tx);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`calendar:${scope.spaceId}`},0))::text`;
    const block = await tx.timeBlock.findFirst({
      where: {
        id,
        spaceId: scope.spaceId,
        createdByUserId: scope.actor.userId,
        deletedAt: null,
      },
    });
    if (!block) throw new NotFoundException();
    if (
      block.revision !== revision ||
      block.taskId ||
      block.selectedTaskRevision
    )
      throw new ConflictException();
    const existing = await tx.timeBlockSharedTaskLink.findUnique({
      where: { blockId: id },
    });
    if (input) {
      if (existing) throw new ConflictException();
      const decision = await this.features.decide(
        {
          feature: 'calendar.shared-link',
          usageOwner: { kind: 'PERSONAL_ACCOUNT', userId: scope.actor.userId },
          growth: 1,
          currentUsage: await tx.timeBlockSharedTaskLink.count({
            where: { personalSpaceId: scope.spaceId },
          }),
        },
        tx,
      );
      if (!decision.allowed) throw new ForbiddenException();
      await tx.timeBlockSharedTaskLink.create({
        data: {
          blockId: id,
          personalSpaceId: scope.spaceId,
          ownerUserId: scope.actor.userId,
          spaceId: input.spaceId,
          scopeId: input.spaceId,
          taskId: input.taskId,
          selectedTaskRevision: input.sourceRevision,
        },
      });
    } else if (existing)
      await tx.timeBlockSharedTaskLink.delete({ where: { blockId: id } });
    else return this.read(tx, scope, id);
    await tx.timeBlock.update({
      where: { id },
      data: { revision: { increment: 1 } },
    });
    await writeAudit(tx, {
      action: 'TIME_BLOCK_CHANGE',
      outcome: 'SUCCEEDED',
      actorUserId: scope.actor.userId,
      requestId: scope.actor.requestId,
      correlationId: scope.actor.correlationId,
      resourceId: id,
    });
    await appendOutbox(tx, scope, {
      type: 'time_block.changed',
      version: 1,
      aggregateId: id,
      payload: {},
    });
    return this.read(tx, scope, id);
  }
}
