import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import * as c from '@mehran/api-contracts';
import { CaptureSync } from '../public/sync-access.js';
import { CaptureRepository } from './capture.repository.js';
import { CaptureService } from '../application/capture.service.js';
@Injectable()
export class CaptureSyncRepository extends CaptureSync {
  readonly entities = ['CAPTURE'] as const;
  constructor(
    @Inject(CaptureRepository) private readonly repo: CaptureRepository,
  ) {
    super();
  }
  async command(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    op: c.SyncCommand,
  ) {
    const store = await this.repo.store(tx, scope),
      service = new CaptureService({
        run: async (_s, w) => w(store),
        once: async (_s, _o, _k, _r, w) => w(store),
      });
    let value: c.Capture;
    if (op.operation === 'CAPTURE_CREATE') {
      if (op.baseRevision !== 0) throw new ConflictException();
      if (op.body.type === 'VOICE_MEMO' || op.body.voiceFileId)
        throw new BadRequestException({ code: 'ONLINE_ONLY' });
      value = await service.create(scope, op.clientMutationId, op.body);
    } else if (op.operation === 'CAPTURE_PATCH' && op.resourceId) {
      if ((await store.capture(op.resourceId)).type === 'VOICE_MEMO')
        throw new NotFoundException();
      if (op.body.type === 'VOICE_MEMO' || op.body.voiceFileId)
        throw new BadRequestException({ code: 'ONLINE_ONLY' });
      value = await service.patch(
        scope,
        op.resourceId,
        op.baseRevision,
        op.body,
      );
    } else throw new BadRequestException();
    return (await this.read(tx, scope, 'CAPTURE', value.id))!;
  }
  async read(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    _entity: c.SyncEntity,
    id: string,
  ) {
    const row = await tx.captureItem.findFirst({
      where: { spaceId: scope.spaceId, id, type: { not: 'VOICE_MEMO' } },
      select: { revision: true },
    });
    if (!row) return null;
    const data = await (await this.repo.store(tx, scope)).capture(id);
    return c.SyncResourceSchema.parse({
      entity: 'CAPTURE',
      id,
      revision: row.revision,
      deleted: false,
      data,
    });
  }
  async list(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    entity: c.SyncEntity,
    after: string | undefined,
    limit: number,
  ) {
    const rows = await tx.captureItem.findMany({
      where: {
        spaceId: scope.spaceId,
        type: { not: 'VOICE_MEMO' },
        ...(after ? { id: { gt: after } } : {}),
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: limit,
    });
    return Promise.all(
      rows.map((row) => this.read(tx, scope, entity, row.id).then((v) => v!)),
    );
  }
}
