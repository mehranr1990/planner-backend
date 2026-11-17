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
    // P6-02: pending Activity invitations end; accepted history is retained.
    await tx.socialActivityParticipant.updateMany({
      where: { userId, state: 'INVITED' },
      data: { state: 'DECLINED', rsvp: 'DECLINED', revision: { increment: 1 } },
    });
  }
  /**
   * P6-02/P6-03 erasure detaches the identity from shared Activity and ledger
   * history; amounts stay reconcilable for the remaining participants.
   * Departure settlement obligations remain a P6-06 decision.
   */
  private async eraseActivities(tx: Prisma.TransactionClient, userId: string) {
    await tx.socialNotice.deleteMany({ where: { userId } });
    const mine = await tx.socialActivityParticipant.findMany({
      where: { userId },
      select: { id: true },
    });
    const ids = mine.map((p) => p.id);
    // ADR 0060 decision A: erasure is never blocked and never silently promotes
    // anyone. An independent Activity losing its last organizer is closed and
    // marked orphaned; participants keep their content and ledger rights.
    const organizing = await tx.socialActivityParticipant.findMany({
      where: { userId, state: 'ACTIVE', role: 'ORGANIZER' },
      include: { activity: true },
    });
    for (const p of organizing) {
      if (p.activity.groupId) continue;
      const others = await tx.socialActivityParticipant.count({
        where: {
          activityId: p.activityId,
          role: 'ORGANIZER',
          state: 'ACTIVE',
          userId: { not: null },
          id: { not: p.id },
        },
      });
      if (others) continue;
      await tx.socialActivity.update({
        where: { id: p.activityId },
        data: {
          orphanedAt: new Date(),
          successorParticipantId: null,
          ...(p.activity.state === 'PLANNED' ? { state: 'CLOSED' } : {}),
          revision: { increment: 1 },
        },
      });
    }
    await tx.socialActivity.updateMany({
      where: { successorParticipantId: { in: ids } },
      data: { successorParticipantId: null },
    });
    await tx.socialActivityBusy.deleteMany({
      where: { participantId: { in: ids } },
    });
    await tx.socialActivityParticipant.updateMany({
      where: { id: { in: ids }, rsvp: 'GOING' },
      data: {
        rsvp: 'DECLINED',
        seat: 'NONE',
        waitlistedAt: null,
        offerExpiresAt: null,
      },
    });
    await tx.socialActivityParticipant.updateMany({
      where: { id: { in: ids } },
      data: {
        userId: null,
        state: 'LEFT',
        role: 'PARTICIPANT',
        seat: 'NONE',
        waitlistedAt: null,
        offerExpiresAt: null,
        reminderMinutes: null,
        revision: { increment: 1 },
      },
    });
    await tx.socialActivity.updateMany({
      where: { createdByUserId: userId },
      data: { createdByUserId: null },
    });
    await tx.socialExpense.updateMany({
      where: { proposedByUserId: userId },
      data: { proposedByUserId: null },
    });
    for (const field of [
      'payerUserId',
      'proposedByUserId',
      'decidedByUserId',
    ] as const)
      await tx.socialExpenseRevision.updateMany({
        where: { [field]: userId },
        data: { [field]: null },
      });
    await tx.socialExpenseShare.updateMany({
      where: { userId },
      data: { userId: null },
    });
    for (const field of ['payerUserId', 'payeeUserId'] as const)
      await tx.socialSettlement.updateMany({
        where: { [field]: userId },
        data: { [field]: null },
      });
    await tx.socialAuditEvent.updateMany({
      where: { actorUserId: userId },
      data: { actorUserId: null },
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
    await this.eraseActivities(tx, scope.actor.userId);
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
      'socialActivityParticipations',
      (after: string | undefined) =>
        tx.socialActivityParticipant.findMany({
          where: { userId, ...(after ? { id: { gt: after } } : {}) },
          orderBy: { id: 'asc' },
          take: 100,
        }),
      (r) => r.id,
    );
    await budget.collect(
      'socialNotices',
      (after: string | undefined) =>
        tx.socialNotice.findMany({
          where: { userId, ...(after ? { id: { gt: after } } : {}) },
          orderBy: { id: 'asc' },
          take: 100,
        }),
      (r) => r.id,
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
