import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import type {
  Prisma,
  CalendarEvent as Row,
  TimeBlock as BlockRow,
  EventRecurrence as VersionRow,
} from '../../../generated/prisma/client.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import { scopedWhere } from '../../../platform/database/scoped-where.js';
import { idempotent } from '../../../platform/database/idempotency.js';
import type { MutationReceipt } from '../../../platform/database/idempotency.js';
import { writeAudit } from '../../../platform/audit/audit.service.js';
import { appendOutbox } from '../../../platform/outbox/outbox.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { PlanningTasks } from '../../tasks/public/index.js';
import type {
  CalendarPort,
  CalendarTransaction,
  EventWrite,
  BlockWrite,
  Position,
} from '../application/calendar.port.js';
import type {
  Event,
  Block,
  Version,
  TaskDisposition,
} from '../domain/model.js';
import type { Schedule } from '../domain/calendar.js';
import type { RecurrenceDefinition } from '../domain/recurrence.js';
const date = (value: string) => new Date(value + 'T00:00:00Z');
function schedule(row: Row | BlockRow | VersionRow): Schedule {
  return row.kind === 'ALL_DAY'
    ? {
        kind: 'ALL_DAY',
        timezone: row.timezone,
        startDate: row.startDate!.toISOString().slice(0, 10),
        endDate: row.endDate!.toISOString().slice(0, 10),
        startAt: null,
        endAt: null,
      }
    : {
        kind: 'TIMED',
        timezone: row.timezone,
        localStart: row.localStart!,
        localEnd: row.localEnd!,
        startAt: row.startAt!.toISOString(),
        endAt: row.endAt!.toISOString(),
      };
}
function columns(s: Schedule) {
  return {
    kind: s.kind,
    timezone: s.timezone,
    startDate: s.kind === 'ALL_DAY' ? date(s.startDate) : null,
    endDate: s.kind === 'ALL_DAY' ? date(s.endDate) : null,
    localStart: s.kind === 'TIMED' ? s.localStart : null,
    localEnd: s.kind === 'TIMED' ? s.localEnd : null,
    startAt: s.startAt ? new Date(s.startAt) : null,
    endAt: s.endAt ? new Date(s.endAt) : null,
  };
}
function base(row: Row | BlockRow) {
  return {
    id: row.id,
    spaceId: row.spaceId,
    createdByUserId: row.createdByUserId,
    title: row.title,
    status: row.status as 'ACTIVE' | 'CANCELED',
    schedule: schedule(row),
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}
class Store implements CalendarTransaction {
  constructor(
    private readonly tx: Prisma.TransactionClient,
    private readonly scope: AuthorizedSpace,
    private readonly tasks: PlanningTasks,
  ) {}
  private where<T extends object>(input: T) {
    return scopedWhere(this.scope, input);
  }
  private owner() {
    return {
      spaceId: this.scope.spaceId,
      createdByUserId: this.scope.actor.userId,
    };
  }
  private async eventView(row: Row): Promise<Event> {
    const latest = await this.tx.eventRecurrence.findFirst({
      where: this.where({ eventId: row.id, untilKey: null }),
      orderBy: { revision: 'desc' },
    });
    return {
      ...base(row),
      description: row.description,
      seriesId: row.seriesId,
      recurrenceKey: row.recurrenceKey,
      previousSeriesId: row.previousSeriesId,
      splitBefore: row.splitBefore,
      recurrence: (latest?.definition as RecurrenceDefinition) ?? null,
    };
  }
  async event(id: string) {
    const row = await this.tx.calendarEvent.findFirst({
      where: this.where({ id }),
    });
    if (!row) throw new NotFoundException();
    return this.eventView(row);
  }
  async events(position: Position | null, limit: number) {
    const rows = await this.tx.calendarEvent.findMany({
      where: this.where({
        seriesId: null,
        deletedAt: null,
        ...after(position),
      }),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    return Promise.all(rows.map((row) => this.eventView(row)));
  }
  async createEvent(data: EventWrite) {
    const { schedule: s, deletedAt, ...rest } = data;
    const row = await this.tx.calendarEvent.create({
      data: {
        ...this.owner(),
        ...rest,
        ...columns(s),
        ...(deletedAt ? { deletedAt: new Date(deletedAt) } : {}),
      },
    });
    return this.eventView(row);
  }
  async updateEvent(before: Event, data: Partial<EventWrite>) {
    const { schedule: s, deletedAt, ...rest } = data;
    const result = await this.tx.calendarEvent.updateMany({
      where: this.where({ id: before.id, revision: before.revision }),
      data: {
        ...rest,
        ...(s ? columns(s) : {}),
        ...(deletedAt ? { deletedAt: new Date(deletedAt) } : {}),
        revision: { increment: 1 },
      },
    });
    if (result.count !== 1) throw new ConflictException();
    return this.event(before.id);
  }
  async versions(id: string): Promise<Version[]> {
    const rows = await this.tx.eventRecurrence.findMany({
      where: this.where({ eventId: id }),
      orderBy: { revision: 'asc' },
      take: 1001,
    });
    if (rows.length > 1000) throw new BadRequestException();
    return rows.map((row) => ({
      id: row.id,
      eventId: row.eventId,
      revision: row.revision,
      fromKey: row.fromKey,
      untilKey: row.untilKey,
      identityTime: row.identityTime,
      definition: row.definition as RecurrenceDefinition,
      title: row.title,
      description: row.description,
      status: row.status as Version['status'],
      schedule: schedule(row),
    }));
  }
  async exceptions(id: string) {
    const rows = await this.tx.calendarEvent.findMany({
      where: this.where({ seriesId: id }),
      orderBy: { recurrenceKey: 'asc' },
      take: 1001,
    });
    if (rows.length > 1000) throw new BadRequestException();
    return Promise.all(rows.map((row) => this.eventView(row)));
  }
  async createVersion(
    event: Event,
    definition: RecurrenceDefinition,
    fromKey: string,
    identityTime: string,
  ) {
    await this.tx.eventRecurrence.create({
      data: {
        ...this.owner(),
        eventId: event.id,
        revision: event.revision,
        title: event.title,
        description: event.description,
        status: event.status,
        ...columns(event.schedule),
        definition: definition as Prisma.InputJsonValue,
        fromKey,
        identityTime,
      },
    });
  }
  async closeVersion(version: Version, untilKey: string) {
    const result = await this.tx.eventRecurrence.updateMany({
      where: this.where({ id: version.id, untilKey: null }),
      data: { untilKey },
    });
    if (result.count !== 1) throw new ConflictException();
  }
  async task(id: string) {
    return (await this.tasks.describe(this.tx, this.scope, [id]))[0] ?? null;
  }
  private async blockView(row: BlockRow): Promise<Block> {
    const t = row.taskId ? await this.task(row.taskId) : null;
    let disposition: TaskDisposition | null = null;
    if (row.taskId)
      disposition =
        !t || t.isMaster
          ? 'BLOCKED'
          : t.deleted
            ? 'DELETED'
            : t.occurrenceState === 'SKIPPED'
              ? 'SKIPPED'
              : t.status === 'DONE'
                ? 'COMPLETED'
                : t.status === 'CANCELED' || t.occurrenceState === 'CANCELED'
                  ? 'CANCELED'
                  : t.revision !== row.selectedTaskRevision
                    ? 'STALE'
                    : 'READY';
    return {
      ...base(row),
      taskId: row.taskId,
      selectedTaskRevision: row.selectedTaskRevision,
      taskDisposition: disposition,
    };
  }
  async block(id: string) {
    const row = await this.tx.timeBlock.findFirst({
      where: this.where({ id }),
    });
    if (!row) throw new NotFoundException();
    return this.blockView(row);
  }
  async blocks(position: Position | null, limit: number) {
    const rows = await this.tx.timeBlock.findMany({
      where: this.where({ deletedAt: null, ...after(position) }),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    return Promise.all(rows.map((row) => this.blockView(row)));
  }
  async createBlock(data: BlockWrite) {
    const { schedule: s, deletedAt, ...rest } = data;
    const row = await this.tx.timeBlock.create({
      data: {
        ...this.owner(),
        ...rest,
        ...columns(s),
        ...(deletedAt ? { deletedAt: new Date(deletedAt) } : {}),
      },
    });
    return this.blockView(row);
  }
  async updateBlock(before: Block, data: BlockWrite) {
    const { schedule: s, deletedAt, ...rest } = data;
    const result = await this.tx.timeBlock.updateMany({
      where: this.where({ id: before.id, revision: before.revision }),
      data: {
        ...rest,
        ...columns(s),
        ...(deletedAt ? { deletedAt: new Date(deletedAt) } : {}),
        revision: { increment: 1 },
      },
    });
    if (result.count !== 1) throw new ConflictException();
    return this.block(before.id);
  }
  async changed(kind: 'EVENT' | 'TIME_BLOCK', id: string) {
    await writeAudit(this.tx, {
      action: kind === 'EVENT' ? 'CALENDAR_EVENT_CHANGE' : 'TIME_BLOCK_CHANGE',
      outcome: 'SUCCEEDED',
      actorUserId: this.scope.actor.userId,
      requestId: this.scope.actor.requestId,
      correlationId: this.scope.actor.correlationId,
      resourceId: id,
    });
    await appendOutbox(this.tx, this.scope, {
      type: kind === 'EVENT' ? 'calendar_event.changed' : 'time_block.changed',
      version: 1,
      aggregateId: id,
      payload: {},
    });
  }
}
function after(position: Position | null) {
  return position
    ? {
        OR: [
          { createdAt: { gt: new Date(position.createdAt) } },
          { createdAt: new Date(position.createdAt), id: { gt: position.id } },
        ],
      }
    : {};
}
@Injectable()
export class CalendarRepository implements CalendarPort {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PlanningTasks) private readonly tasks: PlanningTasks,
  ) {}
  private async store(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    // Match Task writer lock ordering; no Task/Planning aggregate is mutated here.
    await this.tasks.lock(tx, scope);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`calendar:${scope.spaceId}`},0))::text`;
    return new Store(tx, scope, this.tasks);
  }
  run<T>(
    scope: AuthorizedSpace,
    work: (tx: CalendarTransaction) => Promise<T>,
  ) {
    return this.database.client.$transaction(
      async (tx) => work(await this.store(tx, scope)),
      { timeout: 30000 },
    );
  }
  async once<T extends Record<string, unknown>>(
    scope: AuthorizedSpace,
    operation: string,
    key: string,
    request: unknown,
    work: (tx: CalendarTransaction) => Promise<T>,
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
          resultId: scope.spaceId,
          statusCode: 200,
          result: JSON.parse(JSON.stringify(result)) as NonNullable<
            MutationReceipt['result']
          >,
        };
      },
    );
    return receipt.result as T;
  }
}
