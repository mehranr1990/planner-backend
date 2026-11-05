import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  Prisma,
  SharedAssignmentNotification,
} from '../../../generated/prisma/client.js';
import type { SharedAuthority } from '../../spaces/public/index.js';
import { SharedWorkNotifications } from '../public/shared-work-notifications.js';
import { sharedDeleteBatch } from '../../../platform/lifecycle/shared-cleanup.js';
import type { SharedCleanupScope } from '../../../platform/lifecycle/shared-cleanup.js';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
const view = (row: SharedAssignmentNotification) =>
  c.SharedAssignmentNotificationSchema.strip().parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
  });
@Injectable()
export class SharedWorkNotificationsRepository extends SharedWorkNotifications {
  cleanup(tx: Prisma.TransactionClient, s: SharedCleanupScope) {
    return sharedDeleteBatch(tx, s, ['SharedAssignmentNotification']);
  }
  async append(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    input: {
      spaceId: string;
      assignmentId: string;
      recipientActorId: string;
      assignmentRevision: number;
      kind: z.infer<typeof c.SharedAssignmentNotificationSchema>['kind'];
    },
  ) {
    a.require(tx, input.spaceId, 'task.read');
    await tx.sharedAssignmentNotification.create({
      data: { id: randomUUID(), scopeId: input.spaceId, ...input },
    });
  }
  async list(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    spaces: string[],
    assignments: string[],
    after: string | undefined,
    limit: number,
  ) {
    if (!spaces.length || !assignments.length) return [];
    const targets = spaces.map((spaceId) => ({
      spaceId,
      recipientActorId: a.require(tx, spaceId, 'task.read').actorId,
    }));
    return (
      await tx.sharedAssignmentNotification.findMany({
        where: {
          OR: targets,
          assignmentId: { in: assignments },
          ...(after ? { id: { gt: after } } : {}),
        },
        orderBy: { id: 'asc' },
        take: limit,
      })
    ).map(view);
  }
  async read(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    spaceId: string,
    id: string,
    revision: number,
  ) {
    const actorId = a.require(tx, spaceId, 'task.read').actorId;
    const row = await tx.sharedAssignmentNotification.findFirst({
      where: { id, spaceId, recipientActorId: actorId },
    });
    if (!row) throw new NotFoundException();
    if (row.revision !== revision) throw new ConflictException();
    if (row.readAt) return view(row);
    const now = (
      await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() now`
    )[0]!.now;
    return view(
      await tx.sharedAssignmentNotification.update({
        where: { id },
        data: { readAt: now, revision: { increment: 1 } },
      }),
    );
  }
}
