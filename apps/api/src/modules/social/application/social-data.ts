import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import type { ExportBudget } from '../../../platform/lifecycle/personal-data.js';
import { SocialData } from '../public/personal-data.js';
@Injectable()
export class SocialDataOwner extends SocialData {
  async suspend(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    const userId = scope.actor.userId;
    await tx.socialPrivacy.updateMany({
      where: { ownerUserId: userId },
      data: {
        discoverable: false,
        allowFriendRequests: false,
        revision: { increment: 1 },
      },
    });
    await tx.socialConnection.updateMany({
      where: {
        state: 'PENDING',
        OR: [{ requesterUserId: userId }, { recipientUserId: userId }],
      },
      data: { state: 'CANCELED', revision: { increment: 1 } },
    });
    await tx.socialJoinRequest.updateMany({
      where: { requesterUserId: userId, state: 'PENDING' },
      data: { state: 'CANCELED', revision: { increment: 1 } },
    });
  }
  async erase(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    await tx.socialPrivacy.deleteMany({
      where: { ownerUserId: scope.actor.userId },
    });
    await tx.socialCircle.deleteMany({
      where: { ownerUserId: scope.actor.userId },
    });
    await tx.socialConnection.deleteMany({
      where: {
        OR: [
          { requesterUserId: scope.actor.userId },
          { recipientUserId: scope.actor.userId },
        ],
      },
    });
    await tx.socialJoinRequest.deleteMany({
      where: { requesterUserId: scope.actor.userId },
    });
  }
  async snapshot(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    budget: ExportBudget,
  ) {
    const userId = scope.actor.userId;
    budget.add(
      'socialPrivacy',
      await tx.socialPrivacy.findMany({
        where: { ownerUserId: userId },
        select: {
          discoverable: true,
          allowFriendRequests: true,
          revision: true,
        },
      }),
    );
    await budget.collect(
      'socialConnections',
      (after: string | undefined) =>
        tx.socialConnection.findMany({
          where: {
            OR: [{ requesterUserId: userId }, { recipientUserId: userId }],
            ...(after ? { id: { gt: after } } : {}),
          },
          orderBy: { id: 'asc' },
          take: 100,
        }),
      (r) => r.id,
    );
    await budget.collect(
      'socialCircles',
      (after: string | undefined) =>
        tx.socialCircle.findMany({
          where: {
            ownerUserId: userId,
            ...(after ? { id: { gt: after } } : {}),
          },
          orderBy: { id: 'asc' },
          take: 100,
        }),
      (r) => r.id,
    );
    await budget.collect(
      'socialCircleLabels',
      (after: { circleId: string; connectionId: string } | undefined) =>
        tx.socialCircleMember.findMany({
          where: {
            circle: { ownerUserId: userId },
            ...(after
              ? {
                  OR: [
                    { circleId: { gt: after.circleId } },
                    {
                      circleId: after.circleId,
                      connectionId: { gt: after.connectionId },
                    },
                  ],
                }
              : {}),
          },
          orderBy: [{ circleId: 'asc' }, { connectionId: 'asc' }],
          take: 100,
        }),
      (r) => ({ circleId: r.circleId, connectionId: r.connectionId }),
    );
    await budget.collect(
      'socialJoinRequests',
      (after: string | undefined) =>
        tx.socialJoinRequest.findMany({
          where: {
            requesterUserId: userId,
            ...(after ? { id: { gt: after } } : {}),
          },
          orderBy: { id: 'asc' },
          take: 100,
        }),
      (r) => r.id,
    );
  }
}
