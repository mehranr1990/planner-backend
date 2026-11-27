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
    await budget.collect(
      'productAnalytics',
      (after: string | undefined) =>
        tx.productAnalyticsEvent.findMany({
          where: {
            userId: scope.actor.userId,
            ...(after ? { id: { gt: after } } : {}),
          },
          orderBy: { id: 'asc' },
          take: 250,
          select: {
            id: true,
            name: true,
            version: true,
            feature: true,
            workspaceType: true,
            meaningful: true,
            occurredAt: true,
          },
        }),
      (r) => r.id,
    );
    await budget.collect(
      'systemEmailMetadata',
      (after: string | undefined) =>
        tx.systemEmailObservation.findMany({
          where: {
            OR: [
              { userId: scope.actor.userId },
              { subjectUserId: scope.actor.userId },
            ],
            ...(after ? { id: { gt: after } } : {}),
          },
          orderBy: { id: 'asc' },
          take: 250,
          select: {
            id: true,
            category: true,
            createdAt: true,
            completedAt: true,
            state: true,
            code: true,
          },
        }),
      (r) => r.id,
    );
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
    await tx.systemEmailObservation.deleteMany({
      where: {
        OR: [
          { userId: scope.actor.userId },
          { subjectUserId: scope.actor.userId },
        ],
      },
    });
    await tx.productAnalyticsEvent.deleteMany({
      where: { userId: scope.actor.userId },
    });
    await tx.securityAuditEvent.deleteMany({
      where: { actorUserId: scope.actor.userId },
    });
    await tx.idempotencyRecord.deleteMany({
      where: { spaceId: scope.spaceId },
    });
    await tx.outboxEvent.deleteMany({ where: { spaceId: scope.spaceId } });
  }
}
