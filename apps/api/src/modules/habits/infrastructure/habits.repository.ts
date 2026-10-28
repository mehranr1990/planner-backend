import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import type {
  Prisma,
  Habit as HabitRow,
  HabitSchedule as ScheduleRow,
  HabitEntry as EntryRow,
  Routine as RoutineRow,
} from '../../../generated/prisma/client.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import { scopedWhere } from '../../../platform/database/scoped-where.js';
import {
  cursorPosition,
  cursorPage,
  afterCursor,
} from '../../../platform/database/cursor-pagination.js';
import { idempotent } from '../../../platform/database/idempotency.js';
import type { MutationReceipt } from '../../../platform/database/idempotency.js';
import { writeAudit } from '../../../platform/audit/audit.service.js';
import { appendOutbox } from '../../../platform/outbox/outbox.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { PlanningPreferences } from '../../account/public/index.js';
import type {
  HabitsPort,
  HabitsTransaction,
  EntryWrite,
  ScheduleWrite,
  PageQuery,
} from '../application/habits.port.js';
import type {
  Habit,
  Schedule,
  Entry,
  Routine,
  Definition,
} from '../domain/habits.js';
const date = (value: string) => new Date(value + 'T00:00:00Z');
const dense = () => {
  throw new BadRequestException({
    code: 'VALIDATION_ERROR',
    details: [{ path: 'range', code: 'RANGE_TOO_DENSE' }],
  });
};
const habitView = (r: HabitRow): Habit => ({
  ...r,
  type: r.type as Habit['type'],
  purpose: r.purpose as Habit['purpose'],
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});
const scheduleView = (r: ScheduleRow): Schedule => ({
  id: r.id,
  habitId: r.habitId,
  revision: r.revision,
  effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10),
  timezone: r.timezone,
  target: r.target.toString(),
  status: r.status as Schedule['status'],
  schedule: r.definition as Definition,
  createdAt: r.createdAt.toISOString(),
});
const entryView = (r: EntryRow): Entry => ({
  id: r.logicalId,
  revisionId: r.id,
  habitId: r.habitId,
  scheduleId: r.scheduleId,
  revision: r.revision,
  previousRevisionId: r.previousId,
  kind: r.kind as Entry['kind'],
  state: r.state as Entry['state'],
  localDate: r.localDate.toISOString().slice(0, 10),
  value: r.value?.toString() ?? null,
  timezone: r.timezone,
  recordedTimezone: r.recordedTimezone,
  recordedAt: r.createdAt.toISOString(),
  actorUserId: r.actorUserId,
  current: r.current,
});
class Store implements HabitsTransaction {
  constructor(
    private readonly tx: Prisma.TransactionClient,
    private readonly scope: AuthorizedSpace,
    private readonly account: PlanningPreferences,
  ) {}
  private where<T extends object>(q: T) {
    return scopedWhere(this.scope, q);
  }
  private owner() {
    return {
      spaceId: this.scope.spaceId,
      createdByUserId: this.scope.actor.userId,
    };
  }
  private context(prefix: string, value: unknown) {
    return (
      prefix + createHash('sha256').update(JSON.stringify(value)).digest('hex')
    );
  }
  private pagination(filter: string, q: PageQuery) {
    return {
      where: afterCursor(cursorPosition(this.scope, filter, q.cursor)),
      take: Number(q.limit ?? 25) + 1,
      limit: Number(q.limit ?? 25),
    };
  }
  preferences() {
    return this.account.read(this.tx, this.scope);
  }
  async habit(id: string) {
    const row = await this.tx.habit.findFirst({ where: this.where({ id }) });
    if (!row) throw new NotFoundException();
    return habitView(row);
  }
  async habits(query: PageQuery) {
    const context = 'habits',
      p = this.pagination(context, query),
      rows = await this.tx.habit.findMany({
        where: this.where(p.where),
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: p.take,
      }),
      page = cursorPage(this.scope, context, p.limit, rows);
    return { ...page, items: page.items.map(habitView) };
  }
  async waterHabits(id?: string) {
    if (id) {
      const h = await this.habit(id);
      if (h.purpose !== 'WATER') throw new NotFoundException();
      return [h];
    }
    const rows = await this.tx.habit.findMany({
      where: this.where({ purpose: 'WATER' }),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 1001,
    });
    if (rows.length > 1000) dense();
    return rows.map(habitView);
  }
  async createHabit(input: Pick<Habit, 'title' | 'type' | 'unit' | 'purpose'>) {
    return habitView(
      await this.tx.habit.create({ data: { ...this.owner(), ...input } }),
    );
  }
  async updateHabit(before: Habit, title?: string) {
    const result = await this.tx.habit.updateMany({
      where: this.where({ id: before.id, revision: before.revision }),
      data: {
        ...(title === undefined ? {} : { title }),
        revision: { increment: 1 },
      },
    });
    if (result.count !== 1) throw new ConflictException();
    return this.habit(before.id);
  }
  async schedules(id: string) {
    const rows = await this.tx.habitSchedule.findMany({
      where: this.where({ habitId: id }),
      orderBy: { revision: 'asc' },
      take: 1001,
    });
    if (rows.length > 1000) dense();
    return rows.map(scheduleView);
  }
  async schedulePage(id: string, q: PageQuery) {
    const ctx = this.context('habit-schedules:', id),
      p = this.pagination(ctx, q),
      position = cursorPosition(this.scope, ctx, q.cursor),
      before = position
        ? await this.tx.habitSchedule.findFirst({
            where: this.where({ habitId: id, ...position }),
          })
        : null;
    if (position && !before) throw new BadRequestException();
    const rows = await this.tx.habitSchedule.findMany({
        where: this.where({
          habitId: id,
          ...(before ? { revision: { gt: before.revision } } : {}),
        }),
        orderBy: { revision: 'asc' },
        take: p.take,
      }),
      page = cursorPage(this.scope, ctx, p.limit, rows);
    return { ...page, items: page.items.map(scheduleView) };
  }
  async createSchedule(habit: Habit, input: ScheduleWrite) {
    await this.tx.habitSchedule.create({
      data: {
        spaceId: this.scope.spaceId,
        habitId: habit.id,
        revision: habit.revision,
        effectiveFrom: date(input.effectiveFrom),
        timezone: input.timezone,
        target: input.target,
        status: input.status,
        definition: input.schedule as Prisma.InputJsonValue,
      },
    });
  }
  async entriesRange(habitIds: string[], from: string, to: string) {
    const rows = await this.tx.habitEntry.findMany({
      where: this.where({
        habitId: { in: habitIds },
        current: true,
        localDate: { gte: date(from), lt: date(to) },
      }),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 10001,
    });
    if (rows.length > 10000) dense();
    return rows.map(entryView);
  }
  async entriesPage(
    id: string,
    q: PageQuery & { from?: string | undefined; to?: string | undefined },
  ) {
    const ctx = this.context('habit-entries:', [
        id,
        q.from ?? null,
        q.to ?? null,
      ]),
      p = this.pagination(ctx, q),
      rows = await this.tx.habitEntry.findMany({
        where: this.where({
          habitId: id,
          current: true,
          ...(q.from && q.to
            ? { localDate: { gte: date(q.from), lt: date(q.to) } }
            : {}),
          ...p.where,
        }),
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: p.take,
      }),
      page = cursorPage(this.scope, ctx, p.limit, rows);
    return { ...page, items: page.items.map(entryView) };
  }
  async entry(habitId: string, logicalId: string) {
    const row = await this.tx.habitEntry.findFirst({
      where: this.where({ habitId, logicalId, current: true }),
    });
    if (!row) throw new NotFoundException();
    return entryView(row);
  }
  async history(habitId: string, logicalId: string, q: PageQuery) {
    await this.entry(habitId, logicalId);
    const ctx = this.context('habit-history:', [habitId, logicalId]),
      p = this.pagination(ctx, q),
      position = cursorPosition(this.scope, ctx, q.cursor),
      before = position
        ? await this.tx.habitEntry.findFirst({
            where: this.where({ habitId, logicalId, ...position }),
          })
        : null;
    if (position && !before) throw new BadRequestException();
    const rows = await this.tx.habitEntry.findMany({
        where: this.where({
          habitId,
          logicalId,
          ...(before ? { revision: { gt: before.revision } } : {}),
        }),
        orderBy: { revision: 'asc' },
        take: p.take,
      }),
      page = cursorPage(this.scope, ctx, p.limit, rows);
    return { ...page, items: page.items.map(entryView) };
  }
  async appendEntry(input: EntryWrite, before?: Entry) {
    const id = randomUUID();
    if (before) {
      const r = await this.tx.habitEntry.updateMany({
        where: this.where({
          id: before.revisionId,
          revision: before.revision,
          current: true,
        }),
        data: { current: false },
      });
      if (r.count !== 1) throw new ConflictException();
    }
    const row = await this.tx.habitEntry.create({
      data: {
        ...input,
        id,
        spaceId: this.scope.spaceId,
        logicalId: before?.id ?? id,
        previousId: before?.revisionId ?? null,
        actorUserId: this.scope.actor.userId,
        revision: before ? before.revision + 1 : 1,
        localDate: date(input.localDate),
      },
    });
    return entryView(row);
  }
  private async routineView(row: RoutineRow): Promise<Routine> {
    const links = await this.tx.routineHabit.findMany({
      where: this.where({ routineId: row.id }),
      orderBy: { position: 'asc' },
    });
    return {
      ...row,
      status: row.status as Routine['status'],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      habitIds: links.map((l) => l.habitId),
    };
  }
  async routine(id: string) {
    const row = await this.tx.routine.findFirst({ where: this.where({ id }) });
    if (!row) throw new NotFoundException();
    return this.routineView(row);
  }
  async routines(q: PageQuery) {
    const ctx = 'routines',
      p = this.pagination(ctx, q),
      rows = await this.tx.routine.findMany({
        where: this.where(p.where),
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: p.take,
      }),
      page = cursorPage(this.scope, ctx, p.limit, rows);
    return {
      ...page,
      items: await Promise.all(page.items.map((r) => this.routineView(r))),
    };
  }
  private async links(id: string, habitIds: string[]) {
    await this.tx.routineHabit.deleteMany({
      where: this.where({ routineId: id }),
    });
    if (habitIds.length)
      await this.tx.routineHabit.createMany({
        data: habitIds.map((habitId, position) => ({
          spaceId: this.scope.spaceId,
          routineId: id,
          habitId,
          position,
        })),
      });
  }
  async createRoutine(title: string, habitIds: string[]) {
    const row = await this.tx.routine.create({
      data: { ...this.owner(), title },
    });
    await this.links(row.id, habitIds);
    return this.routineView(row);
  }
  async updateRoutine(
    before: Routine,
    title: string,
    status: Routine['status'],
    habitIds: string[],
  ) {
    const r = await this.tx.routine.updateMany({
      where: this.where({ id: before.id, revision: before.revision }),
      data: { title, status, revision: { increment: 1 } },
    });
    if (r.count !== 1) throw new ConflictException();
    await this.links(before.id, habitIds);
    return this.routine(before.id);
  }
  async audit(action: Parameters<HabitsTransaction['audit']>[0], id: string) {
    await writeAudit(this.tx, {
      action,
      outcome: 'SUCCEEDED',
      actorUserId: this.scope.actor.userId,
      requestId: this.scope.actor.requestId,
      correlationId: this.scope.actor.correlationId,
      resourceId: id,
    });
  }
  async event(
    type: 'habit.entry_recorded' | 'habit.entry_corrected',
    habitId: string,
  ) {
    await appendOutbox(this.tx, this.scope, {
      type,
      version: 1,
      aggregateId: habitId,
      payload: {},
    });
  }
}
@Injectable()
export class HabitsRepository implements HabitsPort {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PlanningPreferences) private readonly account: PlanningPreferences,
  ) {}
  private async store(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`habits:${scope.spaceId}`},0))::text`;
    return new Store(tx, scope, this.account);
  }
  run<T>(scope: AuthorizedSpace, work: (tx: HabitsTransaction) => Promise<T>) {
    return this.database.client.$transaction(
      async (tx) => work(await this.store(tx, scope)),
      { timeout: 30000 },
    );
  }
  async once<T extends { id: string }>(
    scope: AuthorizedSpace,
    operation: string,
    key: string,
    request: unknown,
    work: (tx: HabitsTransaction) => Promise<T>,
  ): Promise<T> {
    const receipt = await idempotent(
      this.database.client,
      scope,
      operation,
      key,
      request,
      async (tx) => {
        const result = await work(await this.store(tx, scope));
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
