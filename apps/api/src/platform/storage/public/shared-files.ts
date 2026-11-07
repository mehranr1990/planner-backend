import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { FileUpload } from '@mehran/api-contracts';
import type { Prisma, StoredFile } from '../../../generated/prisma/client.js';
import { APP_CONFIG } from '../../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../../bootstrap/environment.js';
import { STORAGE_PORT, StorageFailure } from '../storage.port.js';
import type { StoragePort, FileEvidence } from '../storage.port.js';
import { sharedDeleteBatch } from '../../lifecycle/shared-cleanup.js';
import type { SharedRestoreScope } from '../../lifecycle/shared-replay.js';
import type {
  SharedCleanupScope,
  CleanupFile,
} from '../../lifecycle/shared-cleanup.js';
/** Caller owns source authority/fencing. Verification is required in every DB phase.
 * This callback must reject use outside its issuing transaction. No Personal scope is accepted. */
export type SharedFileScope = {
  spaceId: string;
  scopeId: string;
  actorId: string;
  verify: (tx: Prisma.TransactionClient, write: boolean) => void;
};
export type SharedUploadTicket = { file: StoredFile; attempt: string };
@Injectable()
export class SharedFiles {
  constructor(
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
  async restoreDeleted(
    tx: Prisma.TransactionClient,
    scope: SharedRestoreScope,
    id: string | null,
  ) {
    scope.verify(tx);
    if (id)
      await tx.storedFile.updateMany({
        where: {
          id,
          spaceId: scope.spaceId,
          scopeId: scope.spaceId,
          ownerUserId: null,
          status: { not: 'DELETED' },
        },
        data: {
          status: 'DELETED',
          deletedAt: new Date(),
          revision: { increment: 1 },
        },
      });
    return tx.storedFile.findMany({
      where: {
        spaceId: scope.spaceId,
        scopeId: scope.spaceId,
        ownerUserId: null,
        status: 'DELETED',
        purgedAt: null,
      },
      orderBy: { id: 'asc' },
      take: 25,
    });
  }
  async restoreRemoved(
    tx: Prisma.TransactionClient,
    scope: SharedRestoreScope,
    rows: StoredFile[],
  ) {
    scope.verify(tx);
    if (rows.length > 25) throw new ConflictException();
    for (const row of rows)
      await tx.storedFile.updateMany({
        where: {
          id: row.id,
          spaceId: scope.spaceId,
          ownerUserId: null,
          status: 'DELETED',
          objectKey: row.objectKey,
          uploadAttemptId: row.uploadAttemptId,
        },
        data: {
          purgedAt: new Date(),
          uploadAttemptId: null,
          uploadStartedAt: null,
        },
      });
  }
  async purgePlan(
    tx: Prisma.TransactionClient,
    s: SharedCleanupScope,
  ): Promise<CleanupFile[]> {
    s.verify(tx);
    const rows = await tx.storedFile.findMany({
      where: {
        spaceId: s.spaceId,
        scopeId: s.spaceId,
        ownerUserId: null,
        purgedAt: null,
      },
      orderBy: { id: 'asc' },
      take: 25,
    });
    await tx.storedFile.updateMany({
      where: { id: { in: rows.map((r) => r.id) }, spaceId: s.spaceId },
      data: {
        status: 'DELETED',
        deletedAt: new Date(),
        revision: { increment: 1 },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      key: r.objectKey,
      attempt: r.uploadAttemptId,
    }));
  }
  async purgeRemove(files: CleanupFile[]) {
    if (files.length > 25) throw new ConflictException();
    for (const file of files) await this.storage.remove(file.key, file.attempt);
  }
  async purgeAck(
    tx: Prisma.TransactionClient,
    s: SharedCleanupScope,
    files: CleanupFile[],
  ) {
    s.verify(tx);
    if (files.length > 25) throw new ConflictException();
    for (const file of files) {
      const row = await tx.storedFile.findFirst({
        where: {
          id: file.id,
          spaceId: s.spaceId,
          scopeId: s.spaceId,
          ownerUserId: null,
          status: 'DELETED',
          objectKey: file.key,
          uploadAttemptId: file.attempt,
        },
      });
      if (!row) throw new ConflictException();
      await tx.storedFile.update({
        where: { id: row.id },
        data: {
          purgedAt: new Date(),
          uploadAttemptId: null,
          uploadStartedAt: null,
        },
      });
    }
  }
  async purgeRows(tx: Prisma.TransactionClient, s: SharedCleanupScope) {
    s.verify(tx);
    if (
      await tx.storedFile.count({
        where: { spaceId: s.spaceId, purgedAt: null },
      })
    )
      throw new ConflictException();
    return sharedDeleteBatch(tx, s, ['StoredFile']);
  }
  async row(tx: Prisma.TransactionClient, s: SharedFileScope, id: string) {
    s.verify(tx, false);
    const row = await tx.storedFile.findFirst({
      where: { id, spaceId: s.spaceId, scopeId: s.scopeId, ownerUserId: null },
    });
    if (!row) throw new NotFoundException();
    return row;
  }
  async describeMany(
    tx: Prisma.TransactionClient,
    s: SharedFileScope,
    ids: string[],
  ) {
    s.verify(tx, false);
    return tx.storedFile.findMany({
      where: {
        spaceId: s.spaceId,
        scopeId: s.scopeId,
        ownerUserId: null,
        id: { in: ids },
        status: { not: 'DELETED' },
      },
      orderBy: { id: 'asc' },
    });
  }
  async reconcile(
    tx: Prisma.TransactionClient,
    s: SharedFileScope,
    now: Date,
    claim: boolean,
    ids?: string[],
  ) {
    s.verify(tx, true);
    const cutoff = new Date(
        now.getTime() - this.config.FILE_UPLOAD_TIMEOUT_MS - 30000,
      ),
      rows = await tx.storedFile.findMany({
        where: {
          spaceId: s.spaceId,
          scopeId: s.scopeId,
          ownerUserId: null,
          ...(ids ? { id: { in: ids } } : {}),
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
        },
        orderBy: { id: 'asc' },
        take: 25,
      });
    if (claim)
      for (const row of rows)
        await tx.storedFile.update({
          where: { id: row.id },
          data: {
            status: row.status === 'DELETED' ? 'DELETED' : 'REJECTED',
            revision: { increment: 1 },
          },
        });
    return rows;
  }
  async initiate(
    tx: Prisma.TransactionClient,
    s: SharedFileScope,
    id: string,
    input: FileUpload,
    now: Date,
  ) {
    s.verify(tx, true);
    if (input.expectedSize > this.config.FILE_MAX_BYTES)
      throw new PayloadTooLargeException();
    return tx.storedFile.create({
      data: {
        id,
        spaceId: s.spaceId,
        scopeId: s.scopeId,
        ownerUserId: null,
        createdByActorId: s.actorId,
        objectKey: randomUUID(),
        filename: input.filename,
        mimeType: input.mimeType,
        expectedSize: input.expectedSize,
        expectedSha256: input.sha256 ?? null,
        uploadExpiresAt: new Date(
          now.getTime() + this.config.FILE_UPLOAD_TTL_SECONDS * 1000,
        ),
      },
    });
  }
  async claim(
    tx: Prisma.TransactionClient,
    s: SharedFileScope,
    id: string,
    now: Date,
  ): Promise<SharedUploadTicket> {
    s.verify(tx, true);
    const file = await this.row(tx, s, id);
    if (file.createdByActorId !== s.actorId) throw new ForbiddenException();
    // Never reclaim a live/stale attempt into a new writer. Reconcile first, then initiate a new file.
    if (
      file.status !== 'INITIATED' ||
      file.uploadAttemptId ||
      file.uploadExpiresAt <= now
    )
      throw new ConflictException();
    const attempt = randomUUID();
    await tx.storedFile.update({
      where: { id },
      data: {
        uploadAttemptId: attempt,
        uploadStartedAt: now,
        revision: { increment: 1 },
      },
    });
    return { file, attempt };
  }
  async write(
    ticket: SharedUploadTicket,
    source: Readable,
    length: string | undefined,
    signal: AbortSignal,
  ) {
    if (
      length !== undefined &&
      (!/^\d+$/.test(length) || Number(length) !== ticket.file.expectedSize)
    )
      throw new BadRequestException();
    try {
      return await this.storage.write(
        ticket.file.objectKey,
        ticket.attempt,
        source,
        {
          size: ticket.file.expectedSize,
          mimeType: ticket.file.mimeType,
          sha256: ticket.file.expectedSha256,
        },
        signal,
      );
    } catch (error) {
      if (error instanceof StorageFailure) {
        if (error.code === 'LIMIT') throw new PayloadTooLargeException();
        if (error.code === 'INVALID') throw new BadRequestException();
        throw new ServiceUnavailableException();
      }
      throw error;
    }
  }
  async ready(
    tx: Prisma.TransactionClient,
    s: SharedFileScope,
    ticket: SharedUploadTicket,
    e: FileEvidence,
    now: Date,
  ) {
    s.verify(tx, true);
    const file = await this.row(tx, s, ticket.file.id);
    if (
      file.status !== 'INITIATED' ||
      file.createdByActorId !== s.actorId ||
      file.uploadAttemptId !== ticket.attempt ||
      file.uploadExpiresAt <= now
    )
      throw new ConflictException();
    return tx.storedFile.update({
      where: { id: file.id },
      data: {
        status: 'READY',
        actualSize: e.size,
        sha256: e.sha256,
        completedAt: now,
        uploadAttemptId: null,
        uploadStartedAt: null,
        revision: { increment: 1 },
      },
    });
  }
  async reject(
    tx: Prisma.TransactionClient,
    s: SharedFileScope,
    id: string,
    attempt: string,
  ) {
    s.verify(tx, true);
    const row = await this.row(tx, s, id);
    if (row.status === 'READY' || row.uploadAttemptId !== attempt) return null;
    if (row.createdByActorId !== s.actorId) throw new ForbiddenException();
    return tx.storedFile.update({
      where: { id },
      data: {
        status: row.status === 'DELETED' ? 'DELETED' : 'REJECTED',
        revision: { increment: 1 },
      },
    });
  }
  async deleted(
    tx: Prisma.TransactionClient,
    s: SharedFileScope,
    id: string,
    revision: number,
    now: Date,
  ) {
    s.verify(tx, true);
    const row = await this.row(tx, s, id);
    if (row.revision !== revision) throw new ConflictException();
    if (row.status === 'DELETED') return row;
    return tx.storedFile.update({
      where: { id },
      data: { status: 'DELETED', deletedAt: now, revision: { increment: 1 } },
    });
  }
  async open(file: StoredFile) {
    if (file.status !== 'READY' || file.actualSize === null || !file.sha256)
      throw new NotFoundException();
    try {
      return await this.storage.open(file.objectKey, {
        size: file.actualSize,
        sha256: file.sha256,
      });
    } catch (error) {
      if (error instanceof StorageFailure)
        throw new ServiceUnavailableException();
      throw error;
    }
  }
  async remove(file: StoredFile) {
    await this.storage.remove(file.objectKey, file.uploadAttemptId);
  }
  async cleanupFinished(
    tx: Prisma.TransactionClient,
    s: SharedFileScope,
    id: string,
    attempt: string | null,
  ) {
    s.verify(tx, true);
    return tx.storedFile.updateMany({
      where: {
        id,
        spaceId: s.spaceId,
        scopeId: s.scopeId,
        ownerUserId: null,
        status: { in: ['DELETED', 'REJECTED'] },
        uploadAttemptId: attempt,
      },
      data: {
        purgedAt: new Date(),
        uploadAttemptId: null,
        uploadStartedAt: null,
      },
    });
  }
}
