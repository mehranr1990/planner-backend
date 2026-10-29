import { appendSyncChanges } from '../../../platform/sync/change-feed.js';
import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type {
  Prisma,
  Note as NoteRow,
  NoteFolder as FolderRow,
} from '../../../generated/prisma/client.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { scopedWhere } from '../../../platform/database/scoped-where.js';
import { idempotent } from '../../../platform/database/idempotency.js';
import type { MutationReceipt } from '../../../platform/database/idempotency.js';
import { writeAudit } from '../../../platform/audit/audit.service.js';
import {
  cursorPage,
  cursorPosition,
  afterCursor,
} from '../../../platform/database/cursor-pagination.js';
import {
  writingContext,
  writingPosition,
  afterLogical,
  writingPage,
} from '../../../platform/database/writing-pagination.js';
import {
  searchAfter,
  literalSearch,
  searchSnippet,
} from '../../../platform/database/personal-search.js';
import { PlanningTasks } from '../../tasks/public/index.js';
import { PersonalGoals } from '../../goals/public/index.js';
import { PersonalNotes } from '../public/personal-notes.js';
import { NotesService } from '../application/notes.service.js';
import type {
  NotesPort,
  NotesTransaction,
  NoteWrite,
  PageQuery,
} from '../application/notes.port.js';
const noteView = (r: NoteRow): c.Note =>
  c.NoteSchema.parse({
    id: r.logicalId,
    revisionId: r.id,
    previousRevisionId: r.previousId,
    spaceId: r.spaceId,
    createdByUserId: r.createdByUserId,
    revision: r.revision,
    current: r.current,
    createdAt: r.createdAt.toISOString(),
    recordedAt: r.recordedAt.toISOString(),
    title: r.title,
    content: {
      format: r.contentFormat,
      version: r.contentVersion,
      content: r.content,
    },
    state: r.state,
    folderId: r.folderId,
    taskId: r.taskId,
    goalId: r.goalId,
  });
const folderView = (r: FolderRow) =>
  c.NoteFolderSchema.parse({
    ...r,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  });
class Store implements NotesTransaction {
  constructor(
    private readonly tx: Prisma.TransactionClient,
    private readonly scope: AuthorizedSpace,
    private readonly tasks: PlanningTasks,
    private readonly goals: PersonalGoals,
  ) {}
  private where<T extends object>(q: T) {
    return scopedWhere(this.scope, q);
  }
  async folder(id: string) {
    const r = await this.tx.noteFolder.findFirst({ where: this.where({ id }) });
    if (!r) throw new NotFoundException();
    return folderView(r);
  }
  async folders(q: PageQuery) {
    const ctx = 'note-folders',
      limit = Number(q.limit ?? 25),
      rows = await this.tx.noteFolder.findMany({
        where: this.where(
          afterCursor(cursorPosition(this.scope, ctx, q.cursor)),
        ),
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit + 1,
      }),
      page = cursorPage(this.scope, ctx, limit, rows);
    return { ...page, items: page.items.map(folderView) };
  }
  async graph() {
    const rows = await this.tx.noteFolder.findMany({
      where: this.where({}),
      select: { id: true, parentId: true },
      take: 1001,
    });
    if (rows.length > 1000) throw new BadRequestException();
    return rows;
  }
  async createFolder(input: c.NoteFolderCreate) {
    return folderView(
      await this.tx.noteFolder.create({
        data: {
          ...input,
          spaceId: this.scope.spaceId,
          createdByUserId: this.scope.actor.userId,
        },
      }),
    );
  }
  async updateFolder(before: c.NoteFolder, input: c.NoteFolderPatch) {
    const data = {
      title: input.title ?? before.title,
      parentId: input.parentId === undefined ? before.parentId : input.parentId,
      position: input.position ?? before.position,
      state: input.state ?? before.state,
      revision: { increment: 1 },
    };
    if (
      (
        await this.tx.noteFolder.updateMany({
          where: this.where({ id: before.id, revision: before.revision }),
          data,
        })
      ).count !== 1
    )
      throw new ConflictException();
    return this.folder(before.id);
  }
  async note(id: string) {
    const r = await this.tx.note.findFirst({
      where: this.where({ logicalId: id, current: true }),
    });
    if (!r) throw new NotFoundException();
    return noteView(r);
  }
  async notes(q: z.infer<typeof c.NoteQuerySchema>) {
    if (q.folderId) await this.folder(q.folderId);
    if (q.taskId) await this.task(q.taskId, true);
    if (q.goalId) await this.goal(q.goalId);
    const ctx = writingContext('notes:', [
      q.state ?? 'ACTIVE',
      q.folderId ?? null,
      q.taskId ?? null,
      q.goalId ?? null,
    ]);
    const rows = await this.tx.note.findMany({
      where: this.where({
        current: true,
        state: q.state ?? 'ACTIVE',
        ...(q.folderId ? { folderId: q.folderId } : {}),
        ...(q.taskId ? { taskId: q.taskId } : {}),
        ...(q.goalId ? { goalId: q.goalId } : {}),
        ...afterLogical(writingPosition(this.scope, ctx, q)),
      }),
      orderBy: [{ createdAt: 'asc' }, { logicalId: 'asc' }],
      take: Number(q.limit ?? 25) + 1,
    });
    return writingPage(this.scope, ctx, q, rows, noteView);
  }
  async history(id: string, q: PageQuery) {
    const ctx = writingContext('note-history:', id),
      p = cursorPosition(this.scope, ctx, q.cursor),
      limit = Number(q.limit ?? 25),
      before = p
        ? await this.tx.note.findFirst({
            where: this.where({
              id: p.id,
              logicalId: id,
              createdAt: p.createdAt,
            }),
          })
        : null;
    if (p && !before) throw new BadRequestException();
    const rows = await this.tx.note.findMany({
        where: this.where({
          logicalId: id,
          ...(before ? { revision: { gt: before.revision } } : {}),
        }),
        orderBy: { revision: 'asc' },
        take: limit + 1,
      }),
      page = cursorPage(this.scope, ctx, limit, rows);
    return { ...page, items: page.items.map(noteView) };
  }
  async append(input: NoteWrite, before?: c.Note) {
    const id = randomUUID(),
      at = new Date();
    if (
      before &&
      (
        await this.tx.note.updateMany({
          where: this.where({
            id: before.revisionId,
            current: true,
            revision: before.revision,
          }),
          data: { current: false },
        })
      ).count !== 1
    )
      throw new ConflictException();
    const { content, ...rest } = input;
    const created = noteView(
      await this.tx.note.create({
        data: {
          ...rest,
          id,
          logicalId: before?.id ?? id,
          previousId: before?.revisionId ?? null,
          revision: before ? before.revision + 1 : 1,
          spaceId: this.scope.spaceId,
          createdByUserId: this.scope.actor.userId,
          content: content.content,
          contentFormat: content.format,
          contentVersion: content.version,
          createdAt: before ? new Date(before.createdAt) : at,
          recordedAt: new Date(
            Math.max(at.getTime(), before ? Date.parse(before.recordedAt) : 0),
          ),
        },
      }),
    );
    await appendSyncChanges(this.tx, this.scope, [
      {
        entity: 'NOTE',
        resourceId: created.id,
        revision: created.revision,
        deleted: created.state === 'DELETED',
      },
    ]);
    return created;
  }

  async task(id: string, allowDeleted = false) {
    const t = (await this.tasks.describe(this.tx, this.scope, [id]))[0];
    if (!t || (!allowDeleted && t.deleted)) throw new NotFoundException();
  }
  goal(id: string) {
    return this.goals.require(this.tx, this.scope, id);
  }
  async audit(action: Parameters<NotesTransaction['audit']>[0], id: string) {
    await writeAudit(this.tx, {
      action,
      outcome: 'SUCCEEDED',
      actorUserId: this.scope.actor.userId,
      resourceId: id,
      requestId: this.scope.actor.requestId,
      correlationId: this.scope.actor.correlationId,
    });
  }
}
@Injectable()
export class NotesRepository implements NotesPort {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(PlanningTasks) private readonly tasks: PlanningTasks,
    @Inject(PersonalGoals) private readonly goals: PersonalGoals,
  ) {}
  async inside<T>(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    work: (tx: NotesTransaction) => Promise<T>,
  ) {
    await this.tasks.lock(tx, scope);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`notes:${scope.spaceId}`},0))::text`;
    return work(new Store(tx, scope, this.tasks, this.goals));
  }
  run<T>(scope: AuthorizedSpace, work: (tx: NotesTransaction) => Promise<T>) {
    return this.db.client.$transaction((tx) => this.inside(tx, scope, work), {
      timeout: 30000,
    });
  }
  async once<T extends { id: string }>(
    scope: AuthorizedSpace,
    operation: string,
    key: string,
    input: unknown,
    work: (tx: NotesTransaction) => Promise<T>,
  ) {
    const receipt = await idempotent(
      this.db.client,
      scope,
      operation,
      key,
      input,
      async (tx) => {
        const result = await this.inside(tx, scope, work);
        return {
          resultId: result.id,
          statusCode: 201,
          result: JSON.parse(JSON.stringify(result)) as NonNullable<
            MutationReceipt['result']
          >,
        };
      },
    );
    return receipt.result as T;
  }
}
@Injectable()
export class PersonalNotesRepository extends PersonalNotes {
  constructor(
    @Inject(NotesRepository) private readonly repo: NotesRepository,
    @Inject(NotesService) private readonly service: NotesService,
  ) {
    super();
  }
  async lock(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`notes:${scope.spaceId}`},0))::text`;
  }
  create(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    input: c.NoteCreate,
  ) {
    return this.repo.inside(tx, scope, (work) =>
      this.service.createInside(work, input),
    );
  }
  async search(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    r: c.SearchRequest,
  ): Promise<c.PersonalSearchHit[]> {
    const text = { contains: literalSearch(r.q), mode: 'insensitive' as const };
    const rows = await tx.note.findMany({
      where: {
        spaceId: scope.spaceId,
        current: true,
        state: 'ACTIVE',
        AND: [
          { OR: [{ title: text }, { content: text }] },
          searchAfter(r, 'NOTE'),
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { logicalId: 'asc' }],
      take: r.limit,
    });
    return rows.map((v) => ({
      kind: 'NOTE',
      id: v.logicalId,
      revision: v.revision,
      title: v.title,
      snippet: searchSnippet(v.content),
      createdAt: v.createdAt.toISOString(),
    }));
  }
}
