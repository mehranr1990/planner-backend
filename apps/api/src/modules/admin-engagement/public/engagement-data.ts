import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import {
  STORAGE_PORT,
  type StoragePort,
} from '../../../platform/storage/storage.port.js';
import type { AttachmentManifest } from '../../../platform/storage/public/index.js';
import {
  PersonalData,
  ExportBudget,
} from '../../../platform/lifecycle/personal-data.js';
import {
  suspensionOwner,
  type PersonalSuspensionScope,
} from '../../../platform/lifecycle/account-closure-authority.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import type { Prisma } from '../../../generated/prisma/client.js';
/** P4 owns its portability projection. Internal notes, tokens and operator details
 * never enter the ordinary Personal export. Physical disposal stays durable. */
@Injectable()
export class EngagementData extends PersonalData {
  constructor(@Inject(STORAGE_PORT) private readonly storage: StoragePort) {
    super();
  }
  async manifest(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    limit: number,
  ): Promise<AttachmentManifest[]> {
    const rows = await tx.p4Evidence.findMany({
      where: {
        ownerUserId: scope.actor.userId,
        state: 'ATTACHED',
        scanEngine: { not: 'PENDING' },
      },
      orderBy: { id: 'asc' },
      take: limit,
      select: {
        id: true,
        filename: true,
        mediaType: true,
        size: true,
        sha256: true,
      },
    });
    return rows.map((row) => ({
      id: row.id,
      filename: row.filename,
      mimeType: row.mediaType,
      size: row.size,
      sha256: row.sha256,
      status: 'READY',
      source: 'P4_EVIDENCE',
    }));
  }
  async bytes(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    item: AttachmentManifest,
  ) {
    const row = await tx.p4Evidence.findFirst({
      where: {
        id: item.id,
        ownerUserId: scope.actor.userId,
        state: 'ATTACHED',
        scanEngine: { not: 'PENDING' },
      },
    });
    if (!row || item.source !== 'P4_EVIDENCE' || item.status !== 'READY')
      throw new NotFoundException({ code: 'ATTACHMENT_UNAVAILABLE' });
    if (row.sha256 !== item.sha256 || row.size !== item.size)
      throw new ConflictException({ code: 'ATTACHMENT_CHANGED' });
    return this.storage.open(row.objectKey, {
      size: row.size,
      sha256: row.sha256,
      verified: false,
    });
  }
  override async suspend(
    tx: Prisma.TransactionClient,
    scope: PersonalSuspensionScope,
  ) {
    const userId = await suspensionOwner(tx, scope);
    await tx.supportTicket.updateMany({
      where: { ownerUserId: userId },
      data: { correlationHash: null, correlationEmailHash: null },
    });
    await tx.adminCommunicationRecipient.updateMany({
      where: { userId, state: { in: ['PENDING', 'SENDING'] } },
      data: { state: 'SUPPRESSED', lastCode: 'ACCOUNT_CLOSED' },
    });
    await tx.p4Notice.updateMany({
      where: { userId, deliveryState: { in: ['PENDING', 'SENDING'] } },
      data: { deliveryState: 'SUPPRESSED', lastCode: 'ACCOUNT_CLOSED' },
    });
  }
  async snapshot(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    budget: ExportBudget,
  ) {
    const userId = scope.actor.userId;
    await budget.collect(
      'supportTickets',
      (after: string | undefined) =>
        tx.supportTicket.findMany({
          where: {
            ownerUserId: userId,
            ...(after ? { id: { gt: after } } : {}),
          },
          select: {
            id: true,
            subject: true,
            category: true,
            priority: true,
            state: true,
            createdAt: true,
            resolvedAt: true,
            feedback: true,
            feedbackText: true,
          },
          orderBy: { id: 'asc' },
          take: 100,
        }),
      (r) => r.id,
    );
    const tickets = await tx.supportTicket.findMany({
      where: { ownerUserId: userId },
      select: { id: true },
      take: 100001,
    });
    if (tickets.length > 100000) {
      budget.add(
        'supportLimit',
        Array.from({ length: 100001 }, () => null),
      );
      return;
    }
    await budget.collect(
      'supportReplies',
      (after: string | undefined) =>
        tx.supportReply.findMany({
          where: {
            ticketId: { in: tickets.map((t) => t.id) },
            internal: false,
            ...(after ? { id: { gt: after } } : {}),
          },
          select: {
            id: true,
            ticketId: true,
            body: true,
            source: true,
            createdAt: true,
          },
          orderBy: { id: 'asc' },
          take: 100,
        }),
      (r) => r.id,
    );
    await budget.collect(
      'reportedCases',
      (after: string | undefined) =>
        tx.moderationCase.findMany({
          where: {
            OR: [{ reporterUserId: userId }, { targetUserId: userId }],
            ...(after ? { id: { gt: after } } : {}),
          },
          select: {
            id: true,
            sourceKind: true,
            category: true,
            description: true,
            state: true,
            publicOutcome: true,
            appealText: true,
            createdAt: true,
            decidedAt: true,
          },
          orderBy: { id: 'asc' },
          take: 100,
        }),
      (r) => r.id,
    );
    await budget.collect(
      'caseEvidence',
      (after: string | undefined) =>
        tx.p4Evidence.findMany({
          where: {
            ownerUserId: userId,
            state: 'ATTACHED',
            ...(after ? { id: { gt: after } } : {}),
          },
          select: {
            id: true,
            ticketId: true,
            caseId: true,
            filename: true,
            mediaType: true,
            size: true,
            sha256: true,
            createdAt: true,
          },
          orderBy: { id: 'asc' },
          take: 100,
        }),
      (r) => r.id,
    );
    budget.add(
      'communicationPreferences',
      await tx.p4CommunicationPreference.findMany({
        where: { userId },
        select: {
          kind: true,
          inApp: true,
          email: true,
          webPush: true,
          revision: true,
        },
      }),
    );
    await budget.collect(
      'communicationInbox',
      (after: string | undefined) =>
        tx.adminCommunicationRecipient.findMany({
          where: {
            userId,
            channel: 'IN_APP',
            state: 'SENT',
            ...(after ? { id: { gt: after } } : {}),
          },
          select: {
            id: true,
            subject: true,
            body: true,
            readAt: true,
            createdAt: true,
          },
          orderBy: { id: 'asc' },
          take: 100,
        }),
      (r) => r.id,
    );
  }
  async erase(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    const userId = scope.actor.userId;
    await tx.p4Evidence.updateMany({
      where: { ownerUserId: userId },
      data: { state: 'DELETING', ownerUserId: null },
    });
    await tx.supportTicket.deleteMany({ where: { ownerUserId: userId } });
    await tx.p4CommunicationPreference.deleteMany({ where: { userId } });
    await tx.p4UserReceipt.deleteMany({ where: { userId } });
    await tx.adminCommunicationRecipient.deleteMany({ where: { userId } });
    await tx.p4Notice.deleteMany({ where: { userId } });
  }
}
