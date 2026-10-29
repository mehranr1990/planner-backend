import { readFocusClock } from './focus-clock.js';

import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import * as c from '@mehran/api-contracts';
import type {
  Prisma,
  FocusSession as SessionRow,
  TimeEntry as EntryRow,
} from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import { scopedWhere } from '../../../platform/database/scoped-where.js';
import {
  cursorPosition,
  cursorPage,
} from '../../../platform/database/cursor-pagination.js';
import { idempotent } from '../../../platform/database/idempotency.js';
import type { MutationReceipt } from '../../../platform/database/idempotency.js';
import { writeAudit } from '../../../platform/audit/audit.service.js';
import { PlanningTasks, ProductivityTasks } from '../../tasks/public/index.js';
import { PlanningPreferences } from '../../account/public/index.js';
import type {
  FocusPort,
  FocusTransaction,
  SessionWrite,
  TimeWrite,
  PageQuery,
} from '../application/focus.port.js';
import type { z } from 'zod';
function sessionView(r: SessionRow): c.FocusRevision {
  return c.FocusRevisionSchema.parse({
    id: r.logicalId,
    revisionId: r.id,
    previousRevisionId: r.previousId,
    revision: r.revision,
    spaceId: r.spaceId,
    createdByUserId: r.createdByUserId,
    title: r.title,
    mode: r.mode,
    timezone: r.timezone,
    taskId: r.taskId,
    selectedTaskRevision: r.selectedTaskRevision,
    pomodoro:
      r.mode === 'POMODORO'
        ? {
            workMinutes: r.workMinutes,
            shortBreakMinutes: r.shortBreakMinutes,
            longBreakMinutes: r.longBreakMinutes,
            longBreakEvery: r.longBreakEvery,
            workIntervals: r.workIntervals,
          }
        : null,
    state: r.state,
    action: r.action,
    elapsedMs: Number(r.elapsedMs),
    runningSince: r.runningSince?.toISOString() ?? null,
    recordedAt: r.recordedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    clockAdjusted: r.clockAdjusted,
    current: r.current,
  });
}
function entryView(r: EntryRow): c.TimeEntry {
  return c.TimeEntrySchema.parse({
    id: r.logicalId,
    revisionId: r.id,
    previousRevisionId: r.previousId,
    revision: r.revision,
    spaceId: r.spaceId,
    createdByUserId: r.createdByUserId,
    kind: r.kind,
    state: r.state,
    sessionId: r.sessionId,
    segmentOrdinal: r.segmentOrdinal,
    taskId: r.taskId,
    selectedTaskRevision: r.selectedTaskRevision,
    startAt: r.startAt.toISOString(),
    endAt: r.endAt.toISOString(),
    durationMs: r.endAt.getTime() - r.startAt.getTime(),
    note: r.note,
    timezone: r.timezone,
    createdAt: r.createdAt.toISOString(),
    recordedAt: r.recordedAt.toISOString(),
    current: r.current,
  });
}
const dense = (): never => {
  throw new BadRequestException({
    code: 'VALIDATION_ERROR',
    details: [{ path: 'range', code: 'RANGE_TOO_DENSE' }],
  });
};
export class Store implements FocusTransaction {
  constructor(
    private readonly tx: Prisma.TransactionClient,
    private readonly scope: AuthorizedSpace,
    private readonly tasks: PlanningTasks,
    private readonly taskStats: ProductivityTasks,
    private readonly account: PlanningPreferences,
  ) {}
  private where<T extends object>(v: T) {
    return scopedWhere(this.scope, v);
  }
  private context(prefix: string, v: unknown) {
    return (
      prefix + createHash('sha256').update(JSON.stringify(v)).digest('hex')
    );
  }
  clock() {
    return readFocusClock(this.tx);
  }
  async timezone() {
    return (await this.account.read(this.tx, this.scope)).timezone;
  }
  async session(logicalId: string) {
    const r = await this.tx.focusSession.findFirst({
      where: this.where({ logicalId, current: true }),
    });
    if (!r) throw new NotFoundException();
    return sessionView(r);
  }
  async sessions(q: z.infer<typeof c.FocusQuerySchema>) {
    if (q.taskId) await this.task(q.taskId);
    const ctx = this.context('focus:', [q.state ?? null, q.taskId ?? null]),
      p = cursorPosition(this.scope, ctx, q.cursor),
      limit = Number(q.limit ?? 25);
    const rows = await this.tx.focusSession.findMany({
      where: this.where({
        current: true,
        ...(q.state ? { state: q.state } : {}),
        ...(q.taskId ? { taskId: q.taskId } : {}),
        ...(p
          ? {
              OR: [
                { createdAt: { gt: p.createdAt } },
                { createdAt: p.createdAt, logicalId: { gt: p.id } },
              ],
            }
          : {}),
      }),
      orderBy: [{ createdAt: 'asc' }, { logicalId: 'asc' }],
      take: limit + 1,
    });
    const page = cursorPage(
      this.scope,
      ctx,
      limit,
      rows.map((r) => ({ id: r.logicalId, createdAt: r.createdAt })),
    );
    return { ...page, items: rows.slice(0, limit).map(sessionView) };
  }
  async versions(id: string) {
    const rows = await this.tx.focusSession.findMany({
      where: this.where({ logicalId: id }),
      orderBy: { revision: 'asc' },
      take: 1001,
    });
    if (rows.length > 1000) dense();
    return rows.map(sessionView);
  }
  async history(id: string, q: PageQuery) {
    const ctx = this.context('focus-history:', id),
      p = cursorPosition(this.scope, ctx, q.cursor),
      limit = Number(q.limit ?? 25);
    const before = p
      ? await this.tx.focusSession.findFirst({
          where: this.where({
            logicalId: id,
            id: p.id,
            createdAt: p.createdAt,
          }),
        })
      : null;
    if (p && !before) throw new BadRequestException();
    const rows = await this.tx.focusSession.findMany({
      where: this.where({
        logicalId: id,
        ...(before ? { revision: { gt: before.revision } } : {}),
      }),
      orderBy: { revision: 'asc' },
      take: limit + 1,
    });
    const page = cursorPage(this.scope, ctx, limit, rows);
    return { ...page, items: page.items.map(sessionView) };
  }
  async appendSession(data: SessionWrite, before?: c.FocusRevision) {
    const id = randomUUID(),
      logicalId = before?.id ?? id;
    if (
      before &&
      (
        await this.tx.focusSession.updateMany({
          where: this.where({
            id: before.revisionId,
            revision: before.revision,
            current: true,
          }),
          data: { current: false },
        })
      ).count !== 1
    )
      throw new ConflictException();
    const { pomodoro, recordedAt, runningSince, ...rest } = data;
    return sessionView(
      await this.tx.focusSession.create({
        data: {
          ...rest,
          id,
          logicalId,
          spaceId: this.scope.spaceId,
          createdByUserId: this.scope.actor.userId,
          previousId: before?.revisionId ?? null,
          revision: before ? before.revision + 1 : 1,
          createdAt: new Date(before?.createdAt ?? recordedAt),
          recordedAt: new Date(recordedAt),
          runningSince: runningSince ? new Date(runningSince) : null,
          workMinutes: pomodoro?.workMinutes ?? null,
          shortBreakMinutes: pomodoro?.shortBreakMinutes ?? null,
          longBreakMinutes: pomodoro?.longBreakMinutes ?? null,
          longBreakEvery: pomodoro?.longBreakEvery ?? null,
          workIntervals: pomodoro?.workIntervals ?? null,
        },
      }),
    );
  }
  async entry(logicalId: string) {
    const r = await this.tx.timeEntry.findFirst({
      where: this.where({ logicalId, current: true }),
    });
    if (!r) throw new NotFoundException();
    return entryView(r);
  }
  async entries(q: z.infer<typeof c.TimeQuerySchema>) {
    if (q.taskId) await this.task(q.taskId);
    if (q.sessionId) await this.session(q.sessionId);
    const ctx = this.context('time:', [
        q.taskId ?? null,
        q.sessionId ?? null,
        q.state ?? null,
      ]),
      p = cursorPosition(this.scope, ctx, q.cursor),
      limit = Number(q.limit ?? 25);
    const rows = await this.tx.timeEntry.findMany({
      where: this.where({
        current: true,
        ...(q.state ? { state: q.state } : {}),
        ...(q.taskId ? { taskId: q.taskId } : {}),
        ...(q.sessionId ? { sessionId: q.sessionId } : {}),
        ...(p
          ? {
              OR: [
                { createdAt: { gt: p.createdAt } },
                { createdAt: p.createdAt, logicalId: { gt: p.id } },
              ],
            }
          : {}),
      }),
      orderBy: [{ createdAt: 'asc' }, { logicalId: 'asc' }],
      take: limit + 1,
    });
    const page = cursorPage(
      this.scope,
      ctx,
      limit,
      rows.map((r) => ({ id: r.logicalId, createdAt: r.createdAt })),
    );
    return { ...page, items: rows.slice(0, limit).map(entryView) };
  }
  async entryHistory(id: string, q: PageQuery) {
    const ctx = this.context('time-history:', id),
      p = cursorPosition(this.scope, ctx, q.cursor),
      limit = Number(q.limit ?? 25);
    const before = p
      ? await this.tx.timeEntry.findFirst({
          where: this.where({
            logicalId: id,
            id: p.id,
            createdAt: p.createdAt,
          }),
        })
      : null;
    if (p && !before) throw new BadRequestException();
    const rows = await this.tx.timeEntry.findMany({
      where: this.where({
        logicalId: id,
        ...(before ? { revision: { gt: before.revision } } : {}),
      }),
      orderBy: { revision: 'asc' },
      take: limit + 1,
    });
    const page = cursorPage(this.scope, ctx, limit, rows);
    return { ...page, items: page.items.map(entryView) };
  }
  async appendEntry(data: TimeWrite, before?: c.TimeEntry) {
    const id = randomUUID(),
      logicalId = before?.id ?? id;
    if (
      before &&
      (
        await this.tx.timeEntry.updateMany({
          where: this.where({
            id: before.revisionId,
            revision: before.revision,
            current: true,
          }),
          data: { current: false },
        })
      ).count !== 1
    )
      throw new ConflictException();
    const { recordedAt, startAt, endAt, ...rest } = data;
    return entryView(
      await this.tx.timeEntry.create({
        data: {
          ...rest,
          id,
          logicalId,
          spaceId: this.scope.spaceId,
          createdByUserId: this.scope.actor.userId,
          previousId: before?.revisionId ?? null,
          revision: before ? before.revision + 1 : 1,
          createdAt: new Date(before?.createdAt ?? recordedAt),
          recordedAt: new Date(recordedAt),
          startAt: new Date(startAt),
          endAt: new Date(endAt),
        },
      }),
    );
  }
  async task(id: string) {
    const rows = await this.tasks.describe(this.tx, this.scope, [id]);
    if (!rows[0]) throw new NotFoundException();
    return rows[0];
  }
  async reserved() {
    const row = await this.tx.focusSession.findFirst({
      where: this.where({
        current: true,
        state: { in: ['RUNNING', 'PAUSED'] },
      }),
    });
    return row ? sessionView(row) : null;
  }
  async range(from: Date, to: Date) {
    const [entries, events] = await Promise.all([
      this.tx.timeEntry.findMany({
        where: this.where({
          current: true,
          state: 'RECORDED',
          startAt: { lt: to },
          endAt: { gt: from },
        }),
        orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
        take: 10001,
      }),
      this.tx.focusSession.findMany({
        where: this.where({
          action: { in: ['START', 'FINISH', 'STOP'] },
          recordedAt: { gte: from, lt: to },
        }),
        select: { action: true, recordedAt: true },
        take: 10001,
      }),
    ]);
    if (entries.length > 10000 || events.length > 10000) dense();
    return {
      entries: entries.map(entryView),
      events: events.map((r) => ({
        action: r.action,
        recordedAt: r.recordedAt.toISOString(),
      })),
    };
  }
  taskSummary() {
    return this.taskStats.summary(this.tx, this.scope);
  }
  async audit(action: Parameters<FocusTransaction['audit']>[0], id: string) {
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
export class FocusRepository implements FocusPort {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(PlanningTasks) private readonly tasks: PlanningTasks,
    @Inject(ProductivityTasks) private readonly stats: ProductivityTasks,
    @Inject(PlanningPreferences) private readonly account: PlanningPreferences,
  ) {}
  private async store(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    await this.tasks.lock(tx, scope);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`focus:${scope.spaceId}`},0))::text`;
    return new Store(tx, scope, this.tasks, this.stats, this.account);
  }
  run<T>(scope: AuthorizedSpace, work: (tx: FocusTransaction) => Promise<T>) {
    return this.db.client.$transaction(
      async (tx) => work(await this.store(tx, scope)),
      { timeout: 30000 },
    );
  }
  async once<T extends { id: string }>(
    scope: AuthorizedSpace,
    operation: string,
    key: string,
    request: unknown,
    work: (tx: FocusTransaction) => Promise<T>,
  ) {
    const r = await idempotent(
      this.db.client,
      scope,
      operation,
      key,
      request,
      async (tx) => {
        const result = await work(await this.store(tx, scope));
        return {
          resultId: result.id,
          statusCode: operation.startsWith('create.') ? 201 : 200,
          result: JSON.parse(JSON.stringify(result)) as NonNullable<
            MutationReceipt['result']
          >,
        };
      },
    );
    return r.result as T;
  }
}
