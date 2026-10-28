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
  JournalEntry as JournalRow,
  MoodEntry as MoodRow,
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
import { PlanningPreferences } from '../../account/public/index.js';
import { PersonalJournal } from '../public/personal-journal.js';
import { JournalService } from '../application/journal.service.js';
import type {
  JournalPort,
  JournalTransaction,
  JournalWrite,
  MoodWrite,
  PageQuery,
} from '../application/journal.port.js';
const rootView = (r: JournalRow | MoodRow) => ({
  id: r.logicalId,
  revisionId: r.id,
  previousRevisionId: r.previousId,
  spaceId: r.spaceId,
  createdByUserId: r.createdByUserId,
  revision: r.revision,
  current: r.current,
  createdAt: r.createdAt.toISOString(),
  recordedAt: r.recordedAt.toISOString(),
  localDate: r.localDate.toISOString().slice(0, 10),
  timezone: r.timezone,
});
const view = (r: JournalRow): c.JournalEntry =>
  c.JournalEntrySchema.parse({
    ...rootView(r),
    title: r.title,
    content: {
      format: r.contentFormat,
      version: r.contentVersion,
      content: r.content,
    },
    kind: r.kind,
    deleted: r.deleted,
  });
const moodView = (r: MoodRow): c.MoodEntry =>
  c.MoodEntrySchema.parse({
    ...rootView(r),
    mood: r.mood,
    energy: r.energy,
    note: r.note,
    state: r.state,
    journalEntryId: r.journalEntryId,
  });
class Store implements JournalTransaction {
  constructor(
    private readonly tx: Prisma.TransactionClient,
    private readonly scope: AuthorizedSpace,
    private readonly account: PlanningPreferences,
  ) {}
  private where<T extends object>(q: T) {
    return scopedWhere(this.scope, q);
  }
  async timezone() {
    return (await this.account.read(this.tx, this.scope)).timezone;
  }
  async entry(id: string) {
    const r = await this.tx.journalEntry.findFirst({
      where: this.where({ logicalId: id, current: true }),
    });
    if (!r) throw new NotFoundException();
    return view(r);
  }
  async checkin(date: string) {
    const r = await this.tx.journalEntry.findFirst({
      where: this.where({
        current: true,
        kind: 'CHECK_IN',
        deleted: false,
        localDate: new Date(date + 'T00:00:00Z'),
      }),
    });
    if (!r) throw new NotFoundException();
    return view(r);
  }
  async entries(q: z.infer<typeof c.JournalQuerySchema>) {
    const ctx = writingContext('journal:', [
        q.from ?? null,
        q.to ?? null,
        q.kind ?? null,
        q.deleted ?? 'false',
      ]),
      rows = await this.tx.journalEntry.findMany({
        where: this.where({
          current: true,
          deleted: q.deleted === 'true',
          ...(q.kind ? { kind: q.kind } : {}),
          ...(q.from && q.to
            ? {
                localDate: {
                  gte: new Date(q.from + 'T00:00:00Z'),
                  lt: new Date(q.to + 'T00:00:00Z'),
                },
              }
            : {}),
          ...afterLogical(writingPosition(this.scope, ctx, q)),
        }),
        orderBy: [{ createdAt: 'asc' }, { logicalId: 'asc' }],
        take: Number(q.limit ?? 25) + 1,
      });
    return writingPage(this.scope, ctx, q, rows, view);
  }
  async history(id: string, q: PageQuery) {
    const ctx = writingContext('journal-history:', id),
      p = cursorPosition(this.scope, ctx, q.cursor),
      limit = Number(q.limit ?? 25),
      before = p
        ? await this.tx.journalEntry.findFirst({
            where: this.where({
              logicalId: id,
              id: p.id,
              createdAt: p.createdAt,
            }),
          })
        : null;
    if (p && !before) throw new BadRequestException();
    const rows = await this.tx.journalEntry.findMany({
        where: this.where({
          logicalId: id,
          ...(before ? { revision: { gt: before.revision } } : {}),
        }),
        orderBy: { revision: 'asc' },
        take: limit + 1,
      }),
      page = cursorPage(this.scope, ctx, limit, rows);
    return { ...page, items: page.items.map(view) };
  }
  async append(input: JournalWrite, before?: c.JournalEntry) {
    const id = randomUUID(),
      now = new Date();
    if (
      before &&
      (
        await this.tx.journalEntry.updateMany({
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
    const { content, localDate, ...rest } = input;
    return view(
      await this.tx.journalEntry.create({
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
          localDate: new Date(localDate + 'T00:00:00Z'),
          createdAt: before ? new Date(before.createdAt) : now,
          recordedAt: new Date(
            Math.max(now.getTime(), before ? Date.parse(before.recordedAt) : 0),
          ),
        },
      }),
    );
  }
  async mood(id: string) {
    const r = await this.tx.moodEntry.findFirst({
      where: this.where({ logicalId: id, current: true }),
    });
    if (!r) throw new NotFoundException();
    return moodView(r);
  }
  async moodForJournal(id: string) {
    const r = await this.tx.moodEntry.findFirst({
      where: this.where({
        journalEntryId: id,
        current: true,
        state: 'RECORDED',
      }),
    });
    return r ? moodView(r) : null;
  }
  async moods(q: z.infer<typeof c.MoodQuerySchema>) {
    if (q.journalEntryId) await this.entry(q.journalEntryId);
    const ctx = writingContext('moods:', [
        q.from ?? null,
        q.to ?? null,
        q.state ?? 'RECORDED',
        q.mood ?? null,
        q.energy ?? null,
        q.journalEntryId ?? null,
      ]),
      rows = await this.tx.moodEntry.findMany({
        where: this.where({
          current: true,
          state: q.state ?? 'RECORDED',
          ...(q.mood ? { mood: Number(q.mood) } : {}),
          ...(q.energy ? { energy: Number(q.energy) } : {}),
          ...(q.journalEntryId ? { journalEntryId: q.journalEntryId } : {}),
          ...(q.from && q.to
            ? {
                localDate: {
                  gte: new Date(q.from + 'T00:00:00Z'),
                  lt: new Date(q.to + 'T00:00:00Z'),
                },
              }
            : {}),
          ...afterLogical(writingPosition(this.scope, ctx, q)),
        }),
        orderBy: [{ createdAt: 'asc' }, { logicalId: 'asc' }],
        take: Number(q.limit ?? 25) + 1,
      });
    return writingPage(this.scope, ctx, q, rows, moodView);
  }
  async moodHistory(id: string, q: PageQuery) {
    const ctx = writingContext('mood-history:', id),
      p = cursorPosition(this.scope, ctx, q.cursor),
      limit = Number(q.limit ?? 25),
      before = p
        ? await this.tx.moodEntry.findFirst({
            where: this.where({
              logicalId: id,
              id: p.id,
              createdAt: p.createdAt,
            }),
          })
        : null;
    if (p && !before) throw new BadRequestException();
    const rows = await this.tx.moodEntry.findMany({
        where: this.where({
          logicalId: id,
          ...(before ? { revision: { gt: before.revision } } : {}),
        }),
        orderBy: { revision: 'asc' },
        take: limit + 1,
      }),
      page = cursorPage(this.scope, ctx, limit, rows);
    return { ...page, items: page.items.map(moodView) };
  }
  async appendMood(input: MoodWrite, before?: c.MoodEntry) {
    const id = randomUUID(),
      now = new Date();
    if (
      before &&
      (
        await this.tx.moodEntry.updateMany({
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
    return moodView(
      await this.tx.moodEntry.create({
        data: {
          ...input,
          id,
          logicalId: before?.id ?? id,
          previousId: before?.revisionId ?? null,
          revision: before ? before.revision + 1 : 1,
          spaceId: this.scope.spaceId,
          createdByUserId: this.scope.actor.userId,
          localDate: new Date(input.localDate + 'T00:00:00Z'),
          createdAt: before ? new Date(before.createdAt) : now,
          recordedAt: new Date(
            Math.max(now.getTime(), before ? Date.parse(before.recordedAt) : 0),
          ),
        },
      }),
    );
  }
  async audit(action: Parameters<JournalTransaction['audit']>[0], id: string) {
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
export class JournalRepository implements JournalPort {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(PlanningPreferences) private readonly account: PlanningPreferences,
  ) {}
  async inside<T>(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    work: (tx: JournalTransaction) => Promise<T>,
  ) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`journal:${scope.spaceId}`},0))::text`;
    return work(new Store(tx, scope, this.account));
  }
  run<T>(scope: AuthorizedSpace, work: (tx: JournalTransaction) => Promise<T>) {
    return this.db.client.$transaction((tx) => this.inside(tx, scope, work), {
      timeout: 30000,
    });
  }
  async once<T extends { id: string }>(
    scope: AuthorizedSpace,
    operation: string,
    key: string,
    input: unknown,
    work: (tx: JournalTransaction) => Promise<T>,
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
export class PersonalJournalRepository extends PersonalJournal {
  constructor(
    @Inject(JournalRepository) private readonly repo: JournalRepository,
    @Inject(JournalService) private readonly service: JournalService,
  ) {
    super();
  }
  async lock(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`journal:${scope.spaceId}`},0))::text`;
  }
  create(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    input: c.JournalCreate,
  ) {
    return this.repo.inside(tx, scope, (work) =>
      this.service.createInside(work, input),
    );
  }
  async search(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    r: c.SearchRequest,
    kind: 'JOURNAL' | 'MOOD',
  ): Promise<c.PersonalSearchHit[]> {
    const text = { contains: literalSearch(r.q), mode: 'insensitive' as const };
    if (kind === 'JOURNAL') {
      const rows = await tx.journalEntry.findMany({
        where: {
          spaceId: scope.spaceId,
          current: true,
          deleted: false,
          AND: [
            { OR: [{ title: text }, { content: text }] },
            searchAfter(r, kind),
          ],
        },
        orderBy: [{ createdAt: 'asc' }, { logicalId: 'asc' }],
        take: r.limit,
      });
      return rows.map((v) => ({
        kind,
        id: v.logicalId,
        revision: v.revision,
        title: v.title,
        snippet: searchSnippet(v.content),
        createdAt: v.createdAt.toISOString(),
      }));
    }
    const rows = await tx.moodEntry.findMany({
      where: {
        spaceId: scope.spaceId,
        current: true,
        state: 'RECORDED',
        AND: [{ note: text }, searchAfter(r, kind)],
      },
      orderBy: [{ createdAt: 'asc' }, { logicalId: 'asc' }],
      take: r.limit,
    });
    return rows.map((v) => ({
      kind,
      id: v.logicalId,
      revision: v.revision,
      title: null,
      snippet: searchSnippet(v.note ?? ''),
      createdAt: v.createdAt.toISOString(),
    }));
  }
}
