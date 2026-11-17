import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { APP_CONFIG } from '../../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../../bootstrap/environment.js';
import { assertFileContentAvailable } from '../file-content-policy.js';
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
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}
  async requireReady(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    id: string,
  ): Promise<void> {
    assertFileContentAvailable(this.config);
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
    if (ids.length) assertFileContentAvailable(this.config);
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
