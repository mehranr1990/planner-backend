import { appendSyncChanges } from '../../../platform/sync/change-feed.js';
import * as c from '@mehran/api-contracts';
import { RoutineReminders } from '../../notifications/public/routine-reminders.js';
import { syncHabitReminder } from '../../notifications/public/habit-reminders.js';
import { CaptureHabits } from '../public/capture-habits.js';
import { HabitsService } from '../application/habits.service.js';
import type { HabitEntryCreate } from '@mehran/api-contracts';
import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import { Prisma } from '../../../generated/prisma/client.js';
import type {
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
import { GoalHabits } from '../public/goal-habits.js';
import { currentSchedule, localDate, stats } from '../domain/habits.js';
import type {
  HabitsPort,
  HabitsTransaction,
  EntryWrite,
  ScheduleWrite,
  HabitMetadata,
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
  timeOfDay: r.timeOfDay as NonNullable<Habit['timeOfDay']>,
  icon: r.icon as NonNullable<Habit['icon']>,
  reminder: c.HabitMetadataFields.reminder.parse(r.reminder) ?? null,
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
export class Store implements HabitsTransaction {
  constructor(
    private readonly tx: Prisma.TransactionClient,
    private readonly scope: AuthorizedSpace,
    private readonly account: PlanningPreferences,
    private readonly reminders?: RoutineReminders,
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
  async createHabit(
    input: Pick<Habit, 'title' | 'type' | 'unit' | 'purpose'> & HabitMetadata,
  ) {
    const { reminder, ...rest } = input;
    return habitView(
      await this.tx.habit.create({
        data: {
          ...this.owner(),
          ...rest,
          ...(reminder === undefined
            ? {}
            : { reminder: reminder === null ? Prisma.DbNull : reminder }),
        },
      }),
    );
  }
  async updateHabit(
    before: Habit,
    title?: string,
    metadata: HabitMetadata = {},
  ) {
    const { reminder, ...rest } = metadata;
    const result = await this.tx.habit.updateMany({
      where: this.where({ id: before.id, revision: before.revision }),
      data: {
        ...rest,
        ...(reminder === undefined
          ? {}
          : { reminder: reminder === null ? Prisma.DbNull : reminder }),
        ...(title === undefined ? {} : { title }),
        revision: { increment: 1 },
      },
    });
    if (result.count !== 1) throw new ConflictException();
    await this.syncHabitReminder(before.id);
    return this.habit(before.id);
  }
  private async syncHabitReminder(id: string) {
    const habit = await this.habit(id),
      versions = await this.schedules(id);
    const schedule = currentSchedule(versions, new Date()) ?? versions.at(-1);
    if (!schedule) return;
    await syncHabitReminder(this.tx, this.scope, {
      id,
      title: habit.title,
      timezone: schedule.timezone,
      startDate: schedule.schedule.startDate,
      // Effective schedules can resume on a future date without another write.
      // The notification owner checks each date's status before scheduling/sending.
      reminder: habit.reminder ?? null,
    });
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
    await this.syncHabitReminder(habit.id);
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
    await appendSyncChanges(this.tx, this.scope, [
      {
        entity: 'HABIT_ENTRY',
        resourceId: row.logicalId,
        parentId: row.habitId,
        revision: row.revision,
        deleted: row.state === 'VOID',
      },
    ]);
    return entryView(row);
  }
  private async routineView(row: RoutineRow): Promise<Routine> {
    const { schedule: _schedule, ...legacy } = row;
    const links = await this.tx.routineHabit.findMany({
      where: this.where({ routineId: row.id }),
      orderBy: { position: 'asc' },
    });
    return {
      ...legacy,
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
  async routineSchedule(id: string) {
    const r = await this.tx.routine.findFirstOrThrow({
      where: this.where({ id }),
    });
    return r.schedule === null
      ? null
      : c.RoutineScheduleSchema.parse(r.schedule);
  }
  async setRoutineSchedule(
    id: string,
    revision: number,
    schedule: c.RoutineSchedule | null,
  ) {
    const before = await this.routine(id);
    const result = await this.tx.routine.updateMany({
      where: this.where({ id, revision }),
      data: { schedule: schedule ?? Prisma.DbNull, revision: { increment: 1 } },
    });
    if (result.count !== 1) throw new ConflictException();
    await this.reminders!.sync(
      this.tx,
      this.scope,
      id,
      before.title,
      before.status === 'ACTIVE' ? schedule : null,
    );
  }
  async executions(id: string, from: string, to: string) {
    const rows = await this.tx.routineExecution.findMany({
      where: this.where({
        routineId: id,
        localDate: { gte: date(from), lt: date(to) },
      }),
      orderBy: { localDate: 'asc' },
      take: 367,
    });
    return rows.map((r) =>
      c.RoutineExecutionSchema.parse({
        id: id + ':' + r.localDate.toISOString().slice(0, 10),
        routineId: id,
        localDate: r.localDate.toISOString().slice(0, 10),
        scheduledAt: r.scheduledAt.toISOString(),
        timezone: r.timezone,
        state: r.state,
        revision: r.revision,
        startedAt: r.startedAt?.toISOString() ?? null,
        completedAt: r.completedAt?.toISOString() ?? null,
        linkedHabitCount: 0,
        completedHabitCount: 0,
        completionPercentage: null,
      }),
    );
  }
  async execute(
    id: string,
    localDate: string,
    scheduledAt: string,
    timezone: string,
    action: 'START' | 'COMPLETE' | 'SKIP',
    revision: number,
  ) {
    const where = this.where({ routineId: id, localDate: date(localDate) });
    const before = await this.tx.routineExecution.findFirst({ where });
    if (
      (before?.revision ?? (await this.routine(id)).revision) !== revision ||
      (before && before.state !== 'RUNNING') ||
      (action === 'START' && before)
    )
      throw new ConflictException();
    const now = (
      await this.tx.$queryRaw<
        Array<{ now: Date }>
      >`SELECT clock_timestamp() AS now`
    )[0]!.now;
    if (new Date(scheduledAt) > now) throw new BadRequestException();
    const state =
      action === 'START'
        ? 'RUNNING'
        : action === 'COMPLETE'
          ? 'COMPLETED'
          : 'SKIPPED';
    const data = { state, completedAt: state === 'COMPLETED' ? now : null };
    if (before)
      await this.tx.routineExecution.update({
        where: { id: before.id },
        data: { ...data, revision: { increment: 1 } },
      });
    else
      await this.tx.routineExecution.create({
        data: {
          spaceId: this.scope.spaceId,
          routineId: id,
          localDate: date(localDate),
          revision: revision + 1,
          scheduledAt: new Date(scheduledAt),
          timezone,
          ...data,
          startedAt: action === 'START' ? now : null,
        },
      });
    await this.audit('ROUTINE_UPDATE', id);
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
    await this.reminders!.sync(
      this.tx,
      this.scope,
      before.id,
      title,
      status === 'ACTIVE' ? await this.routineSchedule(before.id) : null,
    );
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
    entryRevisionId: string,
  ) {
    const event = await appendOutbox(this.tx, this.scope, {
      type,
      version: 1,
      aggregateId: habitId,
      payload: {},
    });
    await this.tx.habitEntry.update({
      where: { id: entryRevisionId, spaceId: this.scope.spaceId, habitId },
      data: { sourceEventId: event.id },
    });
  }
}
@Injectable()
export class HabitsRepository implements HabitsPort {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PlanningPreferences) private readonly account: PlanningPreferences,
    @Inject(RoutineReminders) private readonly reminders: RoutineReminders,
  ) {}
  private async store(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    await scope.fence(tx);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`habits:${scope.spaceId}`},0))::text`;
    return new Store(tx, scope, this.account, this.reminders);
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
          resultId:
            'routineId' in result && typeof result.routineId === 'string'
              ? result.routineId
              : result.id,
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
export class GoalHabitsRepository extends GoalHabits {
  constructor(
    @Inject(PlanningPreferences) private readonly account: PlanningPreferences,
  ) {
    super();
  }
  async lock(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    await scope.fence(tx);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`habits:${scope.spaceId}`},0))::text`;
  }
  async describe(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    habitId: string,
    range: { from: string; to: string },
    now: Date,
  ) {
    const store = new Store(tx, scope, this.account);
    const habit = await store.habit(habitId);
    const versions = await store.schedules(habitId);
    const active = currentSchedule(versions, now) ?? versions.at(-1)!;
    const asOfDate = localDate(now, active.timezone);
    const entries = await store.entriesRange([habitId], range.from, range.to);
    const result = stats(
      habitId,
      versions,
      entries,
      range.from,
      range.to,
      asOfDate,
    );
    return {
      id: habit.id,
      revision: habit.revision,
      timezone: active.timezone,
      asOfDate,
      scheduleIds: versions.map((v) => v.id),
      entries: entries.map((e) => ({ id: e.revisionId, revision: e.revision })),
      ...result.completionRate,
    };
  }
}

@Injectable()
export class CaptureHabitsRepository extends CaptureHabits {
  constructor(
    @Inject(HabitsService) private readonly service: HabitsService,
    @Inject(PlanningPreferences) private readonly account: PlanningPreferences,
  ) {
    super();
  }
  async record(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    id: string,
    input: HabitEntryCreate,
  ) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`habits:${scope.spaceId}`},0))::text`;
    const result = await this.service.recordInside(
      new Store(tx, scope, this.account),
      id,
      input,
    );
    return {
      id: result.id,
      habitId: result.habitId,
      revision: result.revision,
    };
  }
}
