import type { RequestActor } from '../../platform/auth/request-actor.js';
import type { AdminCommand } from '../../platform/admin/admin-command.js';
import { ForbiddenException, ConflictException } from '@nestjs/common';
import { json } from './engagement-core.js';
import { P4Attachment } from '@mehran/api-contracts';
import {
  Injectable,
  Inject,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { EngagementCore } from './engagement-core.js';
import {
  STORAGE_PORT,
  type StoragePort,
} from '../../platform/storage/storage.port.js';
import {
  SupportInboundEvidence,
  validateInboundAttachments,
  type InboundAttachment,
  type StagedSupportEvidence,
} from '../../platform/admin/support-inbound.js';
import type { Prisma } from '../../generated/prisma/client.js';
@Injectable()
export class EngagementEvidence extends SupportInboundEvidence {
  constructor(
    @Inject(EngagementCore) private readonly core: EngagementCore,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
  ) {
    super();
  }
  async stage(
    attachments: readonly InboundAttachment[],
    ownerUserId: string | null = null,
  ) {
    validateInboundAttachments(attachments);
    const group = randomUUID(),
      result: StagedSupportEvidence[] = [];
    try {
      for (const item of attachments) {
        const id = randomUUID(),
          objectKey = randomUUID(),
          attemptId = randomUUID(),
          sha256 = createHash('sha256').update(item.content).digest('hex');
        await this.core.db.client.p4Evidence.create({
          data: {
            id,
            ownerUserId,
            objectKey,
            attemptId,
            filename: item.filename,
            mediaType: item.mediaType,
            size: item.content.byteLength,
            sha256,
            scanEngine: 'PENDING',
            stagingGroup: group,
            expiresAt: new Date(Date.now() + 3600000),
          },
        });
        result.push({ id, digest: sha256 });
        const evidence = await this.storage.write(
          objectKey,
          attemptId,
          Readable.from([item.content]),
          {
            size: item.content.byteLength,
            mimeType: item.mediaType,
            sha256,
            maxBytes: 5242880,
          },
          AbortSignal.timeout(30000),
        );
        if (!evidence.scan) throw new NotFoundException();
        await this.core.db.client.p4Evidence.update({
          where: { id },
          data: { scanEngine: evidence.scan.engine },
        });
      }
      return result;
    } catch (error) {
      await this.cleanup(result);
      throw error;
    }
  }
  async attach(
    tx: Prisma.TransactionClient,
    staged: readonly StagedSupportEvidence[],
    target: { ticketId?: string; caseId?: string; replyId?: string },
    ownerUserId: string | null,
  ) {
    const count = await tx.p4Evidence.count({
      where: {
        ...(target.ticketId
          ? { ticketId: target.ticketId }
          : { caseId: target.caseId! }),
        state: 'ATTACHED',
      },
    });
    if (count + staged.length > 100) throw new PayloadTooLargeException();
    for (const item of staged) {
      await this.core.lock(tx, 'p4-evidence:' + item.id);
      const changed = await tx.p4Evidence.updateMany({
        where: {
          id: item.id,
          sha256: item.digest,
          ownerUserId,
          state: 'STAGED',
          scanEngine: { not: 'PENDING' },
          expiresAt: { gt: new Date() },
        },
        data: { ...target, state: 'ATTACHED' },
      });
      if (changed.count !== 1) throw new NotFoundException();
    }
  }
  async cleanup(staged: readonly StagedSupportEvidence[]) {
    for (const item of staged)
      await this.core.db.client.$transaction(async (tx) => {
        await this.core.lock(tx, 'p4-evidence:' + item.id);
        await tx.p4Evidence.updateMany({
          where: { id: item.id, sha256: item.digest, state: 'STAGED' },
          data: { state: 'DELETING' },
        });
      });
  }
  async open(id: string, target: { ticketId?: string; caseId?: string }) {
    this.core.privacy.assert();
    const row = await this.core.db.client.p4Evidence.findFirst({
      where: {
        id,
        ...target,
        state: 'ATTACHED',
        scanEngine: { not: 'PENDING' },
      },
    });
    if (!row) throw new NotFoundException();
    return {
      stream: await this.storage.open(row.objectKey, {
        size: row.size,
        sha256: row.sha256,
        verified: false,
      }),
      mimeType: row.mediaType,
    };
  }
  async adminDownload(
    command: AdminCommand,
    target: { ticketId?: string; caseId?: string },
    evidenceId: string,
  ) {
    await this.core.db.client.$transaction(async (tx) => {
      await command.verify(tx);
      if (target.ticketId) await this.core.ticket(tx, target.ticketId);
      else {
        const row = await this.core.case(tx, target.caseId!);
        if (row.state === 'CLOSED') throw new ForbiddenException();
      }
      if (
        !(await tx.p4Evidence.findFirst({
          where: { id: evidenceId, state: 'ATTACHED', ...target },
        }))
      )
        throw new NotFoundException();
      await tx.adminAuditEvent.update({
        where: { id: command.auditId },
        data: {
          actorAdminId: command.adminId,
          outcome: 'SUCCEEDED',
          metadata: {
            caseId: target.caseId ?? null,
            ticketId: target.ticketId ?? null,
            evidenceId,
          },
        },
      });
    });
    return this.open(evidenceId, target);
  }
  async userDownload(
    actor: RequestActor,
    target: { ticketId?: string; caseId?: string },
    evidenceId: string,
  ) {
    await this.core.db.client.$transaction(async (tx) => {
      if (target.ticketId)
        await this.core.ticket(tx, target.ticketId, actor.userId);
      else await this.core.case(tx, target.caseId!, actor.userId);
      await this.core.event(tx, target, 'EVIDENCE_DOWNLOAD', {
        userId: actor.userId,
      });
    });
    return this.open(evidenceId, target);
  }
  async upload(
    actor: RequestActor,
    key: string,
    target: { ticketId?: string; caseId?: string },
    input: unknown,
  ) {
    const b = P4Attachment.parse(input);
    await this.core.db.client.$transaction(async (tx) => {
      if (target.ticketId)
        await this.core.ticket(tx, target.ticketId, actor.userId);
      else await this.core.case(tx, target.caseId!, actor.userId);
    });
    const bytes = Buffer.from(b.base64, 'base64');
    if (bytes.toString('base64') !== b.base64) throw new ConflictException();
    const staged = await this.stage(
      [{ filename: b.filename, mediaType: b.mediaType, content: bytes }],
      actor.userId,
    );
    try {
      const result = await this.core.userWork(
        actor,
        target.ticketId ? 'support.evidence' : 'moderation.evidence',
        key,
        json({ ...target, ...b }),
        async (tx) => {
          if (target.ticketId) {
            const ticket = await this.core.ticket(
              tx,
              target.ticketId,
              actor.userId,
            );
            if (ticket.archivedAt) throw new ConflictException();
          } else {
            const row = await this.core.case(tx, target.caseId!, actor.userId);
            if (row.state === 'CLOSED') throw new ConflictException();
          }
          await this.attach(tx, staged, target, actor.userId);
          await this.core.event(
            tx,
            target,
            'EVIDENCE_ATTACHED',
            { userId: actor.userId },
            null,
            true,
          );
          return { id: staged[0]!.id };
        },
      );
      return json(
        await this.core.db.client.p4Evidence.findUniqueOrThrow({
          where: { id: (result as { id: string }).id },
        }),
      );
    } finally {
      await this.cleanup(staged);
    }
  }
  async verifyForRestore() {
    const rows = await this.core.db.client.p4Evidence.findMany({
      where: { state: 'ATTACHED' },
      take: 100001,
    });
    if (rows.length > 100000)
      throw new Error('Restore case-evidence inventory bound');
    for (const row of rows) {
      if (row.scanEngine === 'PENDING')
        throw new Error('Unscanned case evidence');
      const stream = await this.storage.open(row.objectKey, {
        size: row.size,
        sha256: row.sha256,
        verified: false,
      });
      for await (const chunk of stream) {
        void chunk;
      }
    }
    return rows.length;
  }
  async sweep() {
    const now = new Date();
    await this.core.db.client.p4Evidence.updateMany({
      where: {
        OR: [
          { state: 'STAGED', expiresAt: { lte: now } },
          { state: 'ATTACHED', ticketId: null, caseId: null },
        ],
      },
      data: { state: 'DELETING' },
    });
    const rows = await this.core.db.client.p4Evidence.findMany({
      where: { state: 'DELETING' },
      take: 25,
    });
    for (const row of rows) {
      await this.storage.remove(row.objectKey, row.attemptId);
      await this.core.db.client.p4Evidence.deleteMany({
        where: { id: row.id, state: 'DELETING' },
      });
    }
    return rows.length > 0;
  }
}
