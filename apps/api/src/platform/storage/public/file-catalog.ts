import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../authorization/authorized-space.js';

export type CatalogFile = {
  id: string;
  filename: string;
  mimeType: string;
  status: 'INITIATED' | 'READY' | 'REJECTED' | 'DELETED';
  size: number | null;
};
/** Narrow metadata contract for a caller-owned linking transaction. Never exposes bytes/keys. */
@Injectable()
export class FileCatalog {
  async requireReady(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    id: string,
  ): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "StoredFile" WHERE "id"=${id}::uuid AND "spaceId"=${scope.spaceId}::uuid
      AND "ownerUserId"=${scope.actor.userId}::uuid AND "status"='READY' FOR SHARE`;
    if (rows.length !== 1) throw new NotFoundException();
  }
  async describe(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    ids: string[],
  ): Promise<CatalogFile[]> {
    const rows = await tx.storedFile.findMany({
      where: {
        spaceId: scope.spaceId,
        ownerUserId: scope.actor.userId,
        id: { in: ids },
      },
      select: {
        id: true,
        filename: true,
        mimeType: true,
        status: true,
        actualSize: true,
      },
    });
    if (rows.length !== new Set(ids).size) throw new NotFoundException();
    return rows.map((row) => ({
      id: row.id,
      filename: row.filename,
      mimeType: row.mimeType,
      status: row.status,
      size: row.actualSize,
    }));
  }
}
