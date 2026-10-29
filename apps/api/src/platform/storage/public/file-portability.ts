import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../authorization/authorized-space.js';
import { STORAGE_PORT } from '../storage.port.js';
import type { StoragePort } from '../storage.port.js';
export type AttachmentManifest = {
  id: string;
  filename: string;
  mimeType: string;
  status: string;
  size: number | null;
  sha256: string | null;
};
@Injectable()
export class FilePortability {
  constructor(@Inject(STORAGE_PORT) private readonly storage: StoragePort) {}
  async manifest(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    limit: number,
  ) {
    const rows = await tx.storedFile.findMany({
      where: { spaceId: scope.spaceId, ownerUserId: scope.actor.userId },
      take: limit,
      orderBy: { id: 'asc' },
      select: {
        id: true,
        filename: true,
        mimeType: true,
        status: true,
        actualSize: true,
        sha256: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      filename: r.filename,
      mimeType: r.mimeType,
      status: r.status,
      size: r.actualSize,
      sha256: r.sha256,
    }));
  }
  async bytes(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    item: AttachmentManifest,
  ) {
    const row = await tx.storedFile.findFirst({
      where: {
        id: item.id,
        spaceId: scope.spaceId,
        ownerUserId: scope.actor.userId,
        status: 'READY',
      },
    });
    if (!row || item.status !== 'READY' || !item.sha256 || item.size === null)
      throw new NotFoundException({ code: 'ATTACHMENT_UNAVAILABLE' });
    if (row.sha256 !== item.sha256 || row.actualSize !== item.size)
      throw new ConflictException({ code: 'ATTACHMENT_CHANGED' });
    return this.storage.open(row.objectKey, {
      size: item.size,
      sha256: item.sha256,
    });
  }
  async eraseBatch(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    after: string | null,
  ) {
    return tx.storedFile.findMany({
      where: {
        spaceId: scope.spaceId,
        ownerUserId: scope.actor.userId,
        ...(after ? { id: { gt: after } } : {}),
      },
      take: 25,
      orderBy: { id: 'asc' },
      select: { id: true, objectKey: true, uploadAttemptId: true },
    });
  }
  async removeFile(file: {
    objectKey: string;
    uploadAttemptId: string | null;
  }) {
    await this.storage.remove(file.objectKey, file.uploadAttemptId);
  }
  async verifyInventory(
    tx: Prisma.TransactionClient,
    extra: Array<{ key: string; attempt: string | null }>,
  ) {
    if (!this.storage.inventory) return false;
    const rows = await tx.storedFile.findMany({
      select: { objectKey: true, uploadAttemptId: true },
      take: 100001,
    });
    if (rows.length > 100000) return false;
    const known = new Set([
      ...rows.map((v) => v.objectKey + ':' + (v.uploadAttemptId ?? '')),
      ...rows.map((v) => v.objectKey + ':'),
      ...extra.map((v) => v.key + ':' + (v.attempt ?? '')),
    ]);
    return (await this.storage.inventory()).every((v) =>
      known.has(v.key + ':' + (v.attempt ?? '')),
    );
  }
}
