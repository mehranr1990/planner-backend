import {
  Inject,
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { FileUpload, VoiceFileUpload } from '@mehran/api-contracts';
import type { Prisma, StoredFile } from '../../generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';
import { idempotent } from '../database/idempotency.js';
import { scopedWhere } from '../database/scoped-where.js';
import { writeAudit, AuditService } from '../audit/audit.service.js';
import type { AuthorizedSpace } from '../authorization/authorized-space.js';
import type { FileEvidence } from './storage.port.js';

@Injectable()
export class FilesRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly auditSink: AuditService,
  ) {}
  private where(scope: AuthorizedSpace, id: string) {
    return scopedWhere(scope, { id, ownerUserId: scope.actor.userId });
  }
  async owned(
    scope: AuthorizedSpace,
    id: string,
    allowDeleted = false,
  ): Promise<StoredFile> {
    const file = await this.database.client.storedFile.findFirst({
      where: this.where(scope, id),
    });
    if (!file || (!allowDeleted && file.status === 'DELETED')) {
      await this.auditSink.record({
        action: 'FILE_ACCESS_DENIED',
        outcome: 'DENIED',
        resourceId: id,
        actorUserId: scope.actor.userId,
        requestId: scope.actor.requestId,
        correlationId: scope.actor.correlationId,
      });
      throw new NotFoundException();
    }
    return file;
  }
  private audit(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    id: string,
    action: 'FILE_INITIATE' | 'FILE_COMPLETE' | 'FILE_DELETE' | 'FILE_CLEANUP',
    outcome: 'ATTEMPTED' | 'SUCCEEDED',
  ) {
    return writeAudit(tx, {
      action,
      outcome,
      resourceId: id,
      actorUserId: scope.actor.userId,
      requestId: scope.actor.requestId,
      correlationId: scope.actor.correlationId,
    });
  }
  async initiate(
    scope: AuthorizedSpace,
    input: FileUpload | VoiceFileUpload,
    expiresAt: Date,
    key?: string,
  ) {
    const work = async (tx: Prisma.TransactionClient) => {
      await scope.fence(tx);
      const file = await tx.storedFile.create({
        data: {
          id: randomUUID(),
          objectKey: randomUUID(),
          spaceId: scope.spaceId,
          ownerUserId: scope.actor.userId,
          filename: input.filename,
          mimeType: input.mimeType,
          expectedSize: input.expectedSize,
          expectedSha256: input.sha256 ?? null,
          uploadExpiresAt: expiresAt,
        },
      });
      await this.audit(tx, scope, file.id, 'FILE_INITIATE', 'SUCCEEDED');
      return { resultId: file.id, statusCode: 201 };
    };
    const receipt =
      key === undefined
        ? await this.database.client.$transaction(work)
        : await idempotent(
            this.database.client,
            scope,
            'post.files.uploads',
            key,
            input,
            work,
          );
    const file = await this.owned(scope, receipt.resultId);
    if (
      file.status !== 'READY' &&
      (file.status !== 'INITIATED' ||
        file.uploadExpiresAt.getTime() <= Date.now())
    )
      throw new ConflictException();
    return file;
  }
  async claim(scope: AuthorizedSpace, id: string, attempt: string) {
    const file = await this.owned(scope, id);
    return this.database.client.$transaction(async (tx) => {
      await scope.fence(tx);
      const update = await tx.storedFile.updateMany({
        where: {
          ...this.where(scope, id),
          status: 'INITIATED',
          revision: file.revision,
          uploadAttemptId: null,
          uploadExpiresAt: { gt: new Date() },
        },
        data: {
          uploadAttemptId: attempt,
          uploadStartedAt: new Date(),
          revision: { increment: 1 },
        },
      });
      if (update.count !== 1) throw new ConflictException();
      const audit = await this.audit(
        tx,
        scope,
        id,
        'FILE_COMPLETE',
        'ATTEMPTED',
      );
      return { file, auditId: audit.id };
    });
  }
  async ready(
    scope: AuthorizedSpace,
    id: string,
    attempt: string,
    evidence: FileEvidence,
    auditId: string,
  ) {
    return this.database.client.$transaction(async (tx) => {
      await scope.fence(tx);
      const update = await tx.storedFile.updateMany({
        where: {
          ...this.where(scope, id),
          status: 'INITIATED',
          uploadAttemptId: attempt,
          uploadExpiresAt: { gt: new Date() },
        },
        data: {
          status: 'READY',
          actualSize: evidence.size,
          sha256: evidence.sha256,
          completedAt: new Date(),
          uploadAttemptId: null,
          uploadStartedAt: null,
          revision: { increment: 1 },
        },
      });
      if (update.count !== 1) throw new ConflictException();
      await tx.securityAuditEvent.update({
        where: { id: auditId },
        data: { outcome: 'SUCCEEDED' },
      });
      return tx.storedFile.findFirstOrThrow({ where: this.where(scope, id) });
    });
  }
  async reject(
    scope: AuthorizedSpace,
    id: string,
    attempt: string,
    auditId: string,
  ): Promise<boolean> {
    return this.database.client.$transaction(async (tx) => {
      await scope.fence(tx);
      await tx.storedFile.updateMany({
        where: {
          ...this.where(scope, id),
          uploadAttemptId: attempt,
          status: 'INITIATED',
        },
        data: { status: 'REJECTED', revision: { increment: 1 } },
      });
      const current = await tx.storedFile.findFirstOrThrow({
        where: this.where(scope, id),
      });
      // A lost COMMIT response must never cause deletion of an already READY blob.
      if (
        current.status === 'READY' ||
        (current.status === 'INITIATED' && current.uploadAttemptId !== attempt)
      )
        return false;
      await tx.securityAuditEvent.update({
        where: { id: auditId },
        data: { outcome: 'FAILED' },
      });
      return true;
    });
  }
  async markDeleted(scope: AuthorizedSpace, id: string) {
    const file = await this.owned(scope, id, true);
    return this.database.client.$transaction(async (tx) => {
      await scope.fence(tx);
      await tx.storedFile.updateMany({
        where: { ...this.where(scope, id), status: { not: 'DELETED' } },
        data: {
          status: 'DELETED',
          deletedAt: new Date(),
          purgedAt: null,
          revision: { increment: 1 },
        },
      });
      const audit = await this.audit(tx, scope, id, 'FILE_DELETE', 'ATTEMPTED');
      return { file, auditId: audit.id };
    });
  }
  async stale(scope: AuthorizedSpace, cutoff: Date) {
    return this.database.client.storedFile.findMany({
      where: scopedWhere(scope, {
        ownerUserId: scope.actor.userId,
        purgedAt: null,
        OR: [
          { status: 'INITIATED', uploadExpiresAt: { lt: cutoff } },
          { status: { in: ['REJECTED', 'DELETED'] } },
        ],
        AND: [
          {
            OR: [
              { uploadStartedAt: null },
              { uploadStartedAt: { lt: cutoff } },
            ],
          },
        ],
      }),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 100,
    });
  }
  async claimCleanup(scope: AuthorizedSpace, file: StoredFile, cutoff: Date) {
    return this.database.client.$transaction(async (tx) => {
      await scope.fence(tx);
      const updated = await tx.storedFile.updateMany({
        where: {
          ...this.where(scope, file.id),
          revision: file.revision,
          status: { not: 'READY' },
          OR: [{ uploadStartedAt: null }, { uploadStartedAt: { lt: cutoff } }],
        },
        data: {
          status: file.status === 'DELETED' ? 'DELETED' : 'REJECTED',
          revision: { increment: 1 },
        },
      });
      if (updated.count !== 1) return null;
      return this.audit(tx, scope, file.id, 'FILE_CLEANUP', 'ATTEMPTED');
    });
  }
  async cleanupFinished(
    scope: AuthorizedSpace,
    id: string,
    attempt: string | null,
  ) {
    await this.database.client.storedFile.updateMany({
      where: {
        ...this.where(scope, id),
        uploadAttemptId: attempt,
        status: { in: ['REJECTED', 'DELETED'] },
      },
      data: {
        uploadAttemptId: null,
        uploadStartedAt: null,
        purgedAt: new Date(),
      },
    });
  }
}
