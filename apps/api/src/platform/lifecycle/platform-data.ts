import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../authorization/authorized-space.js';
import { ExportBudget } from './personal-data.js';
@Injectable()
export class PlatformPersonalData {
  async snapshot(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    budget: ExportBudget,
  ) {
    budget.add(
      'securityAudit',
      await tx.securityAuditEvent.findMany({
        where: { actorUserId: scope.actor.userId },
        take: budget.remaining() + 1,
      }),
    );
    budget.add(
      'outboxHistory',
      await tx.outboxEvent.findMany({
        where: { spaceId: scope.spaceId },
        take: budget.remaining() + 1,
        select: {
          id: true,
          type: true,
          version: true,
          occurredAt: true,
          aggregateId: true,
        },
      }),
    );
  }
  async erase(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    await tx.securityAuditEvent.deleteMany({
      where: { actorUserId: scope.actor.userId },
    });
    await tx.idempotencyRecord.deleteMany({
      where: { spaceId: scope.spaceId },
    });
    await tx.outboxEvent.deleteMany({ where: { spaceId: scope.spaceId } });
  }
}
