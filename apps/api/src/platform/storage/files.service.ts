import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { StoredFileSchema, VoiceStoredFileSchema } from '@mehran/api-contracts';
import type {
  FileUpload,
  VoiceFileUpload,
  FileDownloadQuery,
} from '@mehran/api-contracts';
import type { StoredFile } from '../../generated/prisma/client.js';
import { APP_CONFIG } from '../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../bootstrap/environment.js';
import type { AuthorizedSpace } from '../authorization/authorized-space.js';
import { AuditService } from '../audit/audit.service.js';
import { FilesRepository } from './files.repository.js';
import { STORAGE_PORT, StorageFailure } from './storage.port.js';
import type { StoragePort } from './storage.port.js';
import { fileDownloadLink, verifyFileLink } from './download-links.js';

function mapped(error: unknown): unknown {
  if (!(error instanceof StorageFailure)) return error;
  if (error.code === 'INVALID') return new BadRequestException();
  if (error.code === 'LIMIT') return new PayloadTooLargeException();
  return new ServiceUnavailableException();
}
@Injectable()
export class FilesService {
  private readonly active = new Map<
    string,
    { abort: AbortController; finished: Promise<void> }
  >();
  constructor(
    @Inject(FilesRepository) private readonly repository: FilesRepository,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}
  private family(file: StoredFile, voice: boolean) {
    if ((file.mimeType === 'audio/wav') !== voice)
      throw new NotFoundException();
  }
  private view(scope: AuthorizedSpace, file: StoredFile, voice = false) {
    this.family(file, voice);
    const link =
      file.status === 'READY'
        ? fileDownloadLink(this.config, scope, file.id)
        : null;
    if (voice && link) link.url = link.url.replace('/files/', '/files/voice/');
    return (voice ? VoiceStoredFileSchema : StoredFileSchema).parse({
      id: file.id,
      status: file.status,
      filename: file.filename,
      mimeType: file.mimeType,
      expectedSize: file.expectedSize,
      actualSize: file.actualSize,
      sha256: file.sha256,
      createdAt: file.createdAt.toISOString(),
      uploadExpiresAt: file.uploadExpiresAt.toISOString(),
      completedAt: file.completedAt?.toISOString() ?? null,
      download: link,
    });
  }
  async initiate(
    scope: AuthorizedSpace,
    input: FileUpload | VoiceFileUpload,
    key?: string,
    voice = false,
  ) {
    if ((input.mimeType === 'audio/wav') !== voice)
      throw new BadRequestException();
    if (input.expectedSize > this.config.FILE_MAX_BYTES)
      throw new PayloadTooLargeException();
    return this.view(
      scope,
      await this.repository.initiate(
        scope,
        input,
        new Date(Date.now() + this.config.FILE_UPLOAD_TTL_SECONDS * 1000),
        key,
      ),
      voice,
    );
  }
  async retryComplete(scope: AuthorizedSpace, id: string, voice = false) {
    const file = await this.repository.owned(scope, id);
    this.family(file, voice);
    if (file.status !== 'READY') throw new ConflictException();
    await this.audit.record({
      action: 'FILE_COMPLETE',
      outcome: 'SUCCEEDED',
      resourceId: id,
      actorUserId: scope.actor.userId,
      requestId: scope.actor.requestId,
      correlationId: scope.actor.correlationId,
    });
    return this.view(scope, file, voice);
  }
  async complete(
    scope: AuthorizedSpace,
    id: string,
    source: Readable,
    contentLength?: string,
    voice = false,
  ) {
    this.family(await this.repository.owned(scope, id), voice);
    const attempt = randomUUID();
    const { file, auditId } = await this.repository.claim(scope, id, attempt);
    const abort = new AbortController();
    const timeout = setTimeout(
      () => abort.abort(),
      this.config.FILE_UPLOAD_TIMEOUT_MS,
    );
    timeout.unref();
    let finished!: () => void;
    const upload = {
      abort,
      finished: new Promise<void>((resolve) => {
        finished = resolve;
      }),
    };
    this.active.set(id, upload);
    try {
      if (
        contentLength !== undefined &&
        (!/^[0-9]+$/.test(contentLength) ||
          Number(contentLength) !== file.expectedSize)
      )
        throw new BadRequestException();
      const evidence = await this.storage.write(
        file.objectKey,
        attempt,
        source,
        {
          size: file.expectedSize,
          mimeType: file.mimeType,
          sha256: file.expectedSha256,
        },
        abort.signal,
      );
      const ready = await this.repository.ready(
        scope,
        id,
        attempt,
        evidence,
        auditId,
      );
      return this.view(scope, ready, voice);
    } catch (error) {
      // Decide from authoritative state before deleting bytes. On DB uncertainty,
      // retain the private blob/attempt for reconciliation, never guess rollback.
      if (await this.repository.reject(scope, id, attempt, auditId)) {
        try {
          await this.storage.remove(file.objectKey, attempt);
          await this.repository.cleanupFinished(scope, id, attempt);
        } catch {
          /* Retained DB marker drives explicit reconciliation. */
        }
      }
      throw mapped(error);
    } finally {
      clearTimeout(timeout);
      if (this.active.get(id) === upload) this.active.delete(id);
      finished();
    }
  }
  async download(
    scope: AuthorizedSpace,
    id: string,
    query: FileDownloadQuery,
    voice = false,
  ) {
    const file = await this.repository.owned(scope, id);
    if (
      file.status !== 'READY' ||
      file.actualSize === null ||
      file.sha256 === null
    )
      throw new NotFoundException();
    this.family(file, voice);
    verifyFileLink(this.config, scope, id, query);
    const audit = await this.audit.record({
      action: 'FILE_DOWNLOAD',
      outcome: 'ATTEMPTED',
      resourceId: id,
      actorUserId: scope.actor.userId,
      requestId: scope.actor.requestId,
      correlationId: scope.actor.correlationId,
    });
    try {
      return {
        file,
        stream: await this.storage.open(file.objectKey, {
          size: file.actualSize,
          sha256: file.sha256,
        }),
        auditId: audit.id,
      };
    } catch (error) {
      await this.audit.outcome(audit.id, 'FAILED', scope.actor.userId);
      throw mapped(error);
    }
  }
  async delete(scope: AuthorizedSpace, id: string, voice = false) {
    this.family(await this.repository.owned(scope, id, true), voice);
    const { file, auditId } = await this.repository.markDeleted(scope, id);
    try {
      const active = this.active.get(id);
      if (active) {
        active.abort.abort();
        await active.finished;
      }
      await this.storage.remove(file.objectKey, file.uploadAttemptId);
      // Another API process may still hold an upload. Keep its durable marker
      // until that process finishes or stale-attempt reconciliation confirms cleanup.
      if (file.uploadAttemptId === null)
        await this.repository.cleanupFinished(scope, id, null);
      await this.audit.outcome(auditId, 'SUCCEEDED', scope.actor.userId);
    } catch (error) {
      await this.audit.outcome(auditId, 'FAILED', scope.actor.userId);
      throw mapped(error);
    }
  }
  /** Explicit scoped maintenance only; no HTTP route, scheduler or worker. */
  async reconcileIncomplete(scope: AuthorizedSpace) {
    const cutoff = new Date(
      Date.now() - this.config.FILE_UPLOAD_TIMEOUT_MS - 30000,
    );
    let cleaned = 0;
    for (const file of await this.repository.stale(scope, cutoff)) {
      const audit = await this.repository.claimCleanup(scope, file, cutoff);
      if (!audit) continue;
      try {
        await this.storage.remove(file.objectKey, file.uploadAttemptId);
        await this.repository.cleanupFinished(
          scope,
          file.id,
          file.uploadAttemptId,
        );
        await this.audit.outcome(audit.id, 'SUCCEEDED', scope.actor.userId);
        cleaned++;
      } catch (error) {
        await this.audit.outcome(audit.id, 'FAILED', scope.actor.userId);
        throw mapped(error);
      }
    }
    return { cleaned };
  }
}
