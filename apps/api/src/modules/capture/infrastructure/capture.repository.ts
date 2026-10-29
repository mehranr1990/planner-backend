import { appendSyncChanges } from '../../../platform/sync/change-feed.js';
import { FinanceCaptures } from '../public/finance-captures.js';
import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type { Prisma, CaptureItem } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import { scopedWhere } from '../../../platform/database/scoped-where.js';
import {
  cursorPage,
  cursorPosition,
  afterCursor,
} from '../../../platform/database/cursor-pagination.js';
import { writingContext } from '../../../platform/database/writing-pagination.js';
import {
  searchAfter,
  literalSearch,
  searchSnippet,
} from '../../../platform/database/personal-search.js';
import { idempotent } from '../../../platform/database/idempotency.js';
import type { MutationReceipt } from '../../../platform/database/idempotency.js';
import { writeAudit } from '../../../platform/audit/audit.service.js';
import { appendOutbox } from '../../../platform/outbox/outbox.js';
import { FileCatalog } from '../../../platform/storage/public/index.js';
import { PlanningTasks, CaptureTasks } from '../../tasks/public/index.js';
import { GoalHabits, CaptureHabits } from '../../habits/public/index.js';
import { PersonalGoals } from '../../goals/public/index.js';
import { PersonalNotes } from '../../notes/public/index.js';
import { PersonalJournal } from '../../journal/public/index.js';
import { PlanningPreferences } from '../../account/public/index.js';
import type {
  CapturePort,
  CaptureTransaction,
  CaptureWrite,
} from '../application/capture.port.js';
const view = (r: CaptureItem): c.Capture =>
  c.CaptureSchema.parse({
    id: r.id,
    spaceId: r.spaceId,
    createdByUserId: r.createdByUserId,
    revision: r.revision,
    type: r.type,
    text: r.text,
    voiceFileId: r.voiceFileId,
    state: r.state,
    targetTaskId: r.targetTaskId,
    targetNoteId: r.targetNoteId,
    targetJournalId: r.targetJournalId,
    targetHabitEntryId: r.targetHabitEntryId,
    targetHabitId: r.targetHabitId,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  });
class Store implements CaptureTransaction {
  constructor(
    private readonly tx: Prisma.TransactionClient,
    private readonly scope: AuthorizedSpace,
    private readonly tasks: CaptureTasks,
    private readonly habits: CaptureHabits,
    private readonly notes: PersonalNotes,
    private readonly journal: PersonalJournal,
    private readonly goals: PersonalGoals,
    private readonly account: PlanningPreferences,
    private readonly files: FileCatalog,
  ) {}
  private where<T extends object>(q: T) {
    return scopedWhere(this.scope, q);
  }
  async timezone() {
    return (await this.account.read(this.tx, this.scope)).timezone;
  }
  async capture(id: string) {
    const row = await this.tx.captureItem.findFirst({
      where: this.where({ id }),
    });
    if (!row) throw new NotFoundException();
    return view(row);
  }
  async captures(q: z.infer<typeof c.CaptureQuerySchema>) {
    const ctx = writingContext('capture:', [
        q.state ?? 'INBOX',
        q.type ?? null,
      ]),
      limit = Number(q.limit ?? 25),
      rows = await this.tx.captureItem.findMany({
        where: this.where({
          state: q.state ?? 'INBOX',
          ...(q.type ? { type: q.type } : {}),
          ...afterCursor(cursorPosition(this.scope, ctx, q.cursor)),
        }),
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit + 1,
      }),
      page = cursorPage(this.scope, ctx, limit, rows);
    return { ...page, items: page.items.map(view) };
  }
  async create(input: c.CaptureCreate) {
    const created = view(
      await this.tx.captureItem.create({
        data: {
          ...input,
          spaceId: this.scope.spaceId,
          createdByUserId: this.scope.actor.userId,
        },
      }),
    );
    if (created.type !== 'VOICE_MEMO')
      await appendSyncChanges(this.tx, this.scope, [
        {
          entity: 'CAPTURE',
          resourceId: created.id,
          revision: created.revision,
        },
      ]);
    return created;
  }

  async update(before: c.Capture, input: CaptureWrite) {
    if (
      (
        await this.tx.captureItem.updateMany({
          where: this.where({ id: before.id, revision: before.revision }),
          data: { ...input, revision: { increment: 1 } },
        })
      ).count !== 1
    )
      throw new ConflictException();
    const changed = await this.capture(before.id);
    if (changed.type !== 'VOICE_MEMO')
      await appendSyncChanges(this.tx, this.scope, [
        {
          entity: 'CAPTURE',
          resourceId: changed.id,
          revision: changed.revision,
        },
      ]);
    return changed;
  }
  async voice(id: string) {
    await this.files.requireReady(this.tx, this.scope, id);
    const file = (await this.files.describe(this.tx, this.scope, [id]))[0]!;
    if (file.mimeType !== 'audio/wav') throw new BadRequestException();
  }
  createTask(
    input: Extract<c.CaptureTriage, { action: 'CREATE_TASK' }>['task'],
  ) {
    return this.tasks.create(this.tx, this.scope, input);
  }
  createNote(input: c.NoteCreate) {
    return this.notes.create(this.tx, this.scope, input);
  }
  createJournal(input: c.JournalCreate) {
    return this.journal.create(this.tx, this.scope, input);
  }
  recordHabit(
    id: string,
    input: Extract<c.CaptureTriage, { action: 'RECORD_HABIT' }>['entry'],
  ) {
    return this.habits.record(this.tx, this.scope, id, input);
  }
  async search(
    kind: c.PersonalSearchHit['kind'],
    r: c.SearchRequest,
  ): Promise<c.PersonalSearchHit[]> {
    switch (kind) {
      case 'NOTE':
        return this.notes.search(this.tx, this.scope, r);
      case 'TASK':
        return this.tasks.search(this.tx, this.scope, r);
      case 'GOAL':
        return this.goals.search(this.tx, this.scope, r);
      case 'JOURNAL':
      case 'MOOD':
        return this.journal.search(this.tx, this.scope, r, kind);
    }
    const rows = await this.tx.captureItem.findMany({
      where: this.where({
        state: 'INBOX',
        AND: [
          { text: { contains: literalSearch(r.q), mode: 'insensitive' } },
          searchAfter(r, 'CAPTURE', false),
        ],
      }),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: r.limit,
    });
    return rows.map((v) => ({
      kind: 'CAPTURE',
      id: v.id,
      revision: v.revision,
      title: null,
      snippet: searchSnippet(v.text),
      createdAt: v.createdAt.toISOString(),
    }));
  }
  async audit(action: Parameters<CaptureTransaction['audit']>[0], id: string) {
    await writeAudit(this.tx, {
      action,
      outcome: 'SUCCEEDED',
      actorUserId: this.scope.actor.userId,
      resourceId: id,
      requestId: this.scope.actor.requestId,
      correlationId: this.scope.actor.correlationId,
    });
  }
  async event(id: string) {
    await appendOutbox(this.tx, this.scope, {
      type: 'capture.triaged',
      version: 1,
      aggregateId: id,
      payload: {},
    });
  }
}
@Injectable()
export class CaptureRepository implements CapturePort {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(PlanningTasks) private readonly taskLock: PlanningTasks,
    @Inject(GoalHabits) private readonly habitLock: GoalHabits,
    @Inject(CaptureTasks) private readonly tasks: CaptureTasks,
    @Inject(CaptureHabits) private readonly habits: CaptureHabits,
    @Inject(PersonalNotes) private readonly notes: PersonalNotes,
    @Inject(PersonalJournal) private readonly journal: PersonalJournal,
    @Inject(PersonalGoals) private readonly goals: PersonalGoals,
    @Inject(PlanningPreferences) private readonly account: PlanningPreferences,
    @Inject(FileCatalog) private readonly files: FileCatalog,
  ) {}
  async store(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    await this.taskLock.lock(tx, scope);
    await this.habitLock.lock(tx, scope);
    await this.notes.lock(tx, scope);
    await this.journal.lock(tx, scope);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`capture:${scope.spaceId}`},0))::text`;
    return new Store(
      tx,
      scope,
      this.tasks,
      this.habits,
      this.notes,
      this.journal,
      this.goals,
      this.account,
      this.files,
    );
  }
  run<T>(scope: AuthorizedSpace, work: (tx: CaptureTransaction) => Promise<T>) {
    return this.db.client.$transaction(
      async (tx) => work(await this.store(tx, scope)),
      { timeout: 30000 },
    );
  }
  async once<T extends { id: string }>(
    scope: AuthorizedSpace,
    operation: string,
    key: string,
    input: unknown,
    work: (tx: CaptureTransaction) => Promise<T>,
  ) {
    const receipt = await idempotent(
      this.db.client,
      scope,
      operation,
      key,
      input,
      async (tx) => {
        const result = await work(await this.store(tx, scope));
        return {
          resultId: result.id,
          statusCode: operation === 'post.capture' ? 201 : 200,
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
export class FinanceCapturesRepository extends FinanceCaptures {
  constructor(
    @Inject(CaptureRepository) private readonly repo: CaptureRepository,
  ) {
    super();
  }
  async lock(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    await this.repo.store(tx, scope);
  }
  async requireExpense(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    id: string,
    revision: number,
  ) {
    const r = await tx.captureItem.findFirst({
      where: { spaceId: scope.spaceId, id },
    });
    if (!r) throw new NotFoundException();
    if (r.revision !== revision || r.state !== 'INBOX')
      throw new ConflictException();
    if (r.type !== 'EXPENSE') throw new BadRequestException();
  }
  async finish(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    id: string,
    revision: number,
    transactionId: string,
  ) {
    await this.requireExpense(tx, scope, id, revision);
    const r = await tx.captureItem.updateMany({
      where: { spaceId: scope.spaceId, id, revision, state: 'INBOX' },
      data: {
        targetTransactionId: transactionId,
        state: 'TRIAGED',
        revision: { increment: 1 },
      },
    });
    if (r.count !== 1) throw new ConflictException();
    await writeAudit(tx, {
      action: 'CAPTURE_TRIAGE',
      outcome: 'SUCCEEDED',
      actorUserId: scope.actor.userId,
      resourceId: id,
      requestId: scope.actor.requestId,
      correlationId: scope.actor.correlationId,
    });
    await appendOutbox(tx, scope, {
      type: 'capture.triaged',
      version: 1,
      aggregateId: id,
      payload: {},
    });
    return { revision: revision + 1 };
  }
}
