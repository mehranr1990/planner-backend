import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
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
    // P6-04: undecided loan requests/offers end; agreed and custody loans persist.
    const now = new Date();
    await tx.socialLoan.updateMany({
      where: {
        state: { in: ['REQUESTED', 'OFFERED'] },
        OR: [{ lenderUserId: userId }, { borrowerUserId: userId }],
      },
      data: {
        state: 'CANCELED',
        closedAt: now,
        revision: { increment: 1 },
        updatedAt: now,
      },
    });
    await tx.socialLostFoundClaim.updateMany({
      where: { claimantUserId: userId, state: 'PENDING' },
      data: { state: 'WITHDRAWN', revision: { increment: 1 }, updatedAt: now },
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
  /**
   * P6-04 erasure never deletes the other party's obligation record. Undecided
   * loans are canceled; agreed or custody loans keep their state, are marked
   * orphaned and detach the identity (final treatment POLICY-GATED, P6-06).
   * Owned assets are archived and detached. The person's Lost & Found posts and
   * claims are withdrawn and their text and evidence removed.
   */
  private async eraseLending(tx: Prisma.TransactionClient, userId: string) {
    const now = new Date();
    const parties = {
      OR: [{ lenderUserId: userId }, { borrowerUserId: userId }],
    };
    const loans = await tx.socialLoan.findMany({
      where: parties,
      select: { id: true, state: true },
    });
    for (const l of loans) {
      const pending = ['REQUESTED', 'OFFERED'].includes(l.state);
      const open = [
        'ACCEPTED',
        'HANDED_OVER',
        'RETURN_REQUESTED',
        'DISPUTED',
      ].includes(l.state);
      if (!pending && !open) continue;
      await tx.socialLendingEvent.create({
        data: {
          id: randomUUID(),
          loanId: l.id,
          action: 'loan.party-erased',
          fromState: l.state,
          toState: pending ? 'CANCELED' : l.state,
        },
      });
    }
    await tx.socialLoan.updateMany({
      where: { ...parties, state: { in: ['REQUESTED', 'OFFERED'] } },
      data: {
        state: 'CANCELED',
        closedAt: now,
        revision: { increment: 1 },
        updatedAt: now,
      },
    });
    await tx.socialLoan.updateMany({
      where: {
        ...parties,
        state: {
          in: ['ACCEPTED', 'HANDED_OVER', 'RETURN_REQUESTED', 'DISPUTED'],
        },
      },
      data: {
        orphanedAt: now,
        pendingOutcome: null,
        pendingOutcomeByUserId: null,
        revision: { increment: 1 },
        updatedAt: now,
      },
    });
    // ADR 0064 decision C: the person's own free text goes; states, timestamps
    // and the minimal asset title stay for the other party's shared history.
    await tx.socialLoan.updateMany({
      where: {
        OR: [
          { origin: 'REQUEST', borrowerUserId: userId },
          { origin: 'OFFER', lenderUserId: userId },
        ],
      },
      data: { note: null },
    });
    // DISPUTED requires a note (CHECK); a fixed marker replaces the erased text.
    await tx.socialLoan.updateMany({
      where: { disputedByUserId: userId, state: 'DISPUTED' },
      data: { disputeNote: '[erased]' },
    });
    await tx.socialLoan.updateMany({
      where: { disputedByUserId: userId, state: { not: 'DISPUTED' } },
      data: { disputeNote: null },
    });
    // No one remains to decide a due-date proposal on these loans.
    await tx.socialLoan.updateMany({
      where: { ...parties, proposedDueAt: { not: null } },
      data: {
        proposedDueAt: null,
        dueProposedByUserId: null,
        dueProposedAt: null,
      },
    });
    for (const field of [
      'lenderUserId',
      'borrowerUserId',
      'pendingOutcomeByUserId',
      'disputedByUserId',
    ] as const)
      await tx.socialLoan.updateMany({
        where: { [field]: userId },
        data: { [field]: null },
      });
    await tx.socialAsset.updateMany({
      where: { ownerUserId: userId },
      data: {
        ownerUserId: null,
        state: 'ARCHIVED',
        description: null,
        orphanedAt: now,
        revision: { increment: 1 },
        updatedAt: now,
      },
    });
    const reports = await tx.socialLostFoundReport.findMany({
      where: { reporterUserId: userId },
      select: { id: true },
    });
    const reportIds = reports.map((r) => r.id);
    await tx.socialLostFoundClaim.updateMany({
      where: {
        reportId: { in: reportIds },
        state: { in: ['PENDING', 'ACKNOWLEDGED', 'DISPUTED'] },
      },
      data: {
        state: 'SUPERSEDED',
        stateBeforeDispute: null,
        revision: { increment: 1 },
        updatedAt: now,
      },
    });
    await tx.socialLostFoundReport.updateMany({
      where: { id: { in: reportIds }, state: { in: ['OPEN', 'HIDDEN'] } },
      data: { state: 'WITHDRAWN', closedAt: now },
    });
    await tx.socialLostFoundReport.updateMany({
      where: { id: { in: reportIds } },
      data: {
        reporterUserId: null,
        title: null,
        description: null,
        assetId: null,
        erasedAt: now,
        revision: { increment: 1 },
        updatedAt: now,
      },
    });
    await tx.socialLostFoundClaim.updateMany({
      where: {
        claimantUserId: userId,
        state: { in: ['PENDING', 'ACKNOWLEDGED', 'DISPUTED'] },
      },
      data: {
        state: 'WITHDRAWN',
        stateBeforeDispute: null,
        revision: { increment: 1 },
        updatedAt: now,
      },
    });
    await tx.socialLostFoundClaim.updateMany({
      where: { claimantUserId: userId },
      data: { claimantUserId: null, note: null },
    });
    await tx.socialLostFoundClaim.updateMany({
      where: { disputedByUserId: userId },
      data: { disputedByUserId: null, disputeNote: null },
    });
    // Evidence the person added is their own description (loan or Lost & Found).
    await tx.socialEvidence.deleteMany({ where: { addedByUserId: userId } });
    await tx.socialLendingEvent.updateMany({
      where: { actorUserId: userId },
      data: { actorUserId: null, note: null },
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
    await this.eraseLending(tx, scope.actor.userId);
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
    const page = { orderBy: { id: 'asc' as const }, take: 100 };
    const after = (a: string | undefined) => (a ? { id: { gt: a } } : {});
    const id = (r: { id: string }) => r.id;
    await budget.collect(
      'socialAssets',
      (a: string | undefined) =>
        tx.socialAsset.findMany({
          where: { ownerUserId: userId, ...after(a) },
          ...page,
        }),
      id,
    );
    await budget.collect(
      'socialLoans',
      (a: string | undefined) =>
        tx.socialLoan.findMany({
          where: {
            OR: [{ lenderUserId: userId }, { borrowerUserId: userId }],
            ...after(a),
          },
          ...page,
        }),
      id,
    );
    await budget.collect(
      'socialLostFoundReports',
      (a: string | undefined) =>
        tx.socialLostFoundReport.findMany({
          where: { reporterUserId: userId, ...after(a) },
          ...page,
        }),
      id,
    );
    await budget.collect(
      'socialLostFoundClaims',
      (a: string | undefined) =>
        tx.socialLostFoundClaim.findMany({
          where: { claimantUserId: userId, ...after(a) },
          ...page,
        }),
      id,
    );
    await budget.collect(
      'socialEvidence',
      (a: string | undefined) =>
        tx.socialEvidence.findMany({
          where: { addedByUserId: userId, ...after(a) },
          ...page,
        }),
      id,
    );
    await budget.collect(
      'socialLendingEvents',
      (a: string | undefined) =>
        tx.socialLendingEvent.findMany({
          where: { actorUserId: userId, ...after(a) },
          ...page,
        }),
      id,
    );
  }
}
