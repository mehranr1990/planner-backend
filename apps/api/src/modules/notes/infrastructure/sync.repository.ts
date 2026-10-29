import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import * as c from '@mehran/api-contracts';
import { NotesSync } from '../public/sync-access.js';
import { NotesRepository } from './notes.repository.js';
import { NotesService } from '../application/notes.service.js';
@Injectable()
export class NotesSyncRepository extends NotesSync {
  readonly entities = ['NOTE'] as const;
  constructor(@Inject(NotesRepository) private readonly repo: NotesRepository) {
    super();
  }
  command(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    op: c.SyncCommand,
  ): Promise<c.SyncResource> {
    return this.repo.inside(tx, scope, async (store) => {
      const service = new NotesService({
        run: async (_s, w) => w(store),
        once: async (_s, _o, _k, _i, w) => w(store),
      });
      let value: c.Note;
      if (op.operation === 'NOTE_CREATE') {
        if (op.baseRevision !== 0) throw new ConflictException();
        value = await service.create(scope, op.clientMutationId, op.body);
      } else {
        if (!op.resourceId) throw new BadRequestException();
        if (op.operation === 'NOTE_PATCH')
          value = await service.patch(
            scope,
            op.resourceId,
            op.baseRevision,
            op.body,
          );
        else if (
          op.operation === 'NOTE_DELETE' ||
          op.operation === 'NOTE_RESTORE'
        )
          value = await service.patch(scope, op.resourceId, op.baseRevision, {
            state: op.operation === 'NOTE_DELETE' ? 'DELETED' : 'ACTIVE',
          });
        else throw new BadRequestException();
      }
      return this.read(tx, scope, 'NOTE', value.id).then((v) => v!);
    });
  }
  async read(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    _entity: c.SyncEntity,
    id: string,
  ) {
    const row = await tx.note.findFirst({
      where: { spaceId: scope.spaceId, logicalId: id, current: true },
      select: { logicalId: true, revision: true, state: true },
    });
    if (!row) return null;
    return this.repo.inside(tx, scope, async (store) =>
      c.SyncResourceSchema.parse({
        entity: 'NOTE',
        id,
        revision: row.revision,
        deleted: row.state === 'DELETED',
        data: row.state === 'DELETED' ? null : await store.note(id),
      }),
    );
  }
  async list(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    entity: c.SyncEntity,
    after: string | undefined,
    limit: number,
  ) {
    const rows = await tx.note.findMany({
      where: {
        spaceId: scope.spaceId,
        current: true,
        ...(after ? { logicalId: { gt: after } } : {}),
      },
      select: { logicalId: true },
      orderBy: { logicalId: 'asc' },
      take: limit,
    });
    return Promise.all(
      rows.map((row) =>
        this.read(tx, scope, entity, row.logicalId).then((v) => v!),
      ),
    );
  }
}
