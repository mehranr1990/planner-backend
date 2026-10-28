import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type * as c from '@mehran/api-contracts';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { CALENDAR_REPOSITORY } from './calendar.port.js';
import type {
  CalendarPort,
  CalendarTransaction,
  Position,
} from './calendar.port.js';
import {
  CalendarRuleError,
  normalizeSchedule,
  addDates,
  localKey,
  overlaps,
} from '../domain/calendar.js';
import {
  expand,
  scheduled,
  versionAt,
  interval,
  inRange,
  blockOccurrence,
} from '../domain/expansion.js';
import { matchesDate } from '../domain/recurrence.js';
import type { Event, Block, Version, Occurrence } from '../domain/model.js';
import { policies } from '../domain/model.js';
const Pos = z.strictObject({
  id: z.string().uuid(),
  createdAt: z.iso.datetime(),
});
const Cursor = z.strictObject({
  v: z.literal(1),
  user: z.string().uuid(),
  space: z.string().uuid(),
  filter: z.string().length(64),
  phase: z.enum(['EVENT', 'BLOCK']),
  after: Pos.nullable(),
  offset: z.number().int().min(0).max(10000),
  snapshot: z.string().length(64).nullable(),
  heldId: z.string().uuid().nullable(),
  revision: z.number().int().positive().nullable(),
});
type CursorState = z.infer<typeof Cursor>;
const position = (row: { id: string; createdAt: string }): Position => ({
  id: row.id,
  createdAt: row.createdAt,
});
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fail(code: string): never {
  throw new BadRequestException({
    code: 'VALIDATION_ERROR',
    details: [{ path: 'schedule', code }],
  });
}
const output = <T extends object>(value: T) => ({ ...value, ...policies });
@Injectable()
export class CalendarService {
  constructor(
    @Inject(CALENDAR_REPOSITORY) private readonly repo: CalendarPort,
  ) {}
  private revision(
    value: { revision: number; deletedAt: string | null },
    revision: number,
  ) {
    if (value.revision !== revision || value.deletedAt)
      throw new ConflictException();
  }
  private normalize(schedule: c.CalendarScheduleInput) {
    try {
      return normalizeSchedule(schedule);
    } catch (error) {
      if (error instanceof CalendarRuleError) return fail(error.reason);
      throw error;
    }
  }
  private definition(input: c.CalendarEventCreate) {
    const d = input.recurrence,
      s = input.schedule;
    if (!d) return;
    const start = s.kind === 'TIMED' ? s.localStart.slice(0, 10) : s.startDate,
      time = s.kind === 'TIMED' ? s.localStart.slice(11) : '00:00';
    if (
      d.timezone !== s.timezone ||
      d.startDate !== start ||
      d.localTime !== time
    )
      fail('RECURRENCE_SCHEDULE_MISMATCH');
  }
  private async create(
    tx: CalendarTransaction,
    input: c.CalendarEventCreate,
    previousSeriesId?: string,
  ) {
    this.definition(input);
    const event = await tx.createEvent({
      title: input.title,
      description: input.description ?? null,
      schedule: this.normalize(input.schedule),
      status: 'ACTIVE',
      ...(previousSeriesId ? { previousSeriesId } : {}),
    });
    if (input.recurrence) {
      const d = input.recurrence;
      await tx.createVersion(
        event,
        d,
        d.startDate + 'T' + d.localTime,
        d.localTime,
      );
    }
    await tx.changed('EVENT', event.id);
    return tx.event(event.id);
  }
  createEvent(
    scope: AuthorizedSpace,
    key: string | undefined,
    input: c.CalendarEventCreate,
  ) {
    if (!key) throw new BadRequestException();
    return this.repo.once(
      scope,
      'post.calendar.events',
      key,
      input,
      async (tx) => output(await this.create(tx, input)),
    );
  }
  event(scope: AuthorizedSpace, id: string) {
    return this.repo.run(scope, async (tx) => output(await tx.event(id)));
  }
  patchEvent(
    scope: AuthorizedSpace,
    id: string,
    revision: number,
    patch: c.CalendarEventPatch,
  ) {
    return this.repo.run(scope, async (tx) => {
      const before = await tx.event(id);
      this.revision(before, revision);
      if (before.recurrence || before.seriesId) fail('USE_SERIES_EDIT');
      const updated = await tx.updateEvent(before, {
        title: patch.title ?? before.title,
        description:
          patch.description === undefined
            ? before.description
            : patch.description,
        status: patch.status ?? before.status,
        schedule: patch.schedule
          ? this.normalize(patch.schedule)
          : before.schedule,
      });
      await tx.changed('EVENT', id);
      return output(updated);
    });
  }
  deleteEvent(scope: AuthorizedSpace, id: string, revision: number) {
    return this.repo.run(scope, async (tx) => {
      const before = await tx.event(id);
      this.revision(before, revision);
      if (before.seriesId) fail('USE_OCCURRENCE_CANCELLATION');
      await tx.updateEvent(before, { deletedAt: new Date().toISOString() });
      await tx.changed('EVENT', id);
    });
  }
  private async link(
    tx: CalendarTransaction,
    id: string,
    revision: number | undefined,
  ) {
    const task = await tx.task(id);
    if (!task) throw new NotFoundException();
    if (task.revision !== revision) throw new ConflictException();
    if (
      task.deleted ||
      task.isMaster ||
      !['OPEN', 'IN_PROGRESS'].includes(task.status) ||
      (task.occurrenceState && task.occurrenceState !== 'PENDING')
    )
      fail('TASK_NOT_ACTIONABLE');
    return task;
  }
  createBlock(
    scope: AuthorizedSpace,
    key: string | undefined,
    input: c.TimeBlockCreate,
  ) {
    if (!key) throw new BadRequestException();
    return this.repo.once(
      scope,
      'post.calendar.time_blocks',
      key,
      input,
      async (tx) => {
        if (input.taskId) await this.link(tx, input.taskId, input.taskRevision);
        const block = await tx.createBlock({
          title: input.title,
          schedule: this.normalize(input.schedule),
          status: 'ACTIVE',
          taskId: input.taskId ?? null,
          selectedTaskRevision: input.taskRevision ?? null,
        });
        await tx.changed('TIME_BLOCK', block.id);
        return output(block);
      },
    );
  }
  block(scope: AuthorizedSpace, id: string) {
    return this.repo.run(scope, async (tx) => output(await tx.block(id)));
  }
  patchBlock(
    scope: AuthorizedSpace,
    id: string,
    revision: number,
    patch: c.TimeBlockPatch,
  ) {
    return this.repo.run(scope, async (tx) => {
      const before = await tx.block(id);
      this.revision(before, revision);
      if (patch.taskId) await this.link(tx, patch.taskId, patch.taskRevision);
      const updated = await tx.updateBlock(before, {
        title: patch.title ?? before.title,
        schedule: patch.schedule
          ? this.normalize(patch.schedule)
          : before.schedule,
        status: patch.status ?? before.status,
        taskId: patch.taskId === undefined ? before.taskId : patch.taskId,
        selectedTaskRevision:
          patch.taskId === undefined
            ? before.selectedTaskRevision
            : (patch.taskRevision ?? null),
      });
      await tx.changed('TIME_BLOCK', id);
      return output(updated);
    });
  }
  deleteBlock(scope: AuthorizedSpace, id: string, revision: number) {
    return this.repo.run(scope, async (tx) => {
      const before = await tx.block(id);
      this.revision(before, revision);
      await tx.updateBlock(before, {
        title: before.title,
        schedule: before.schedule,
        status: before.status,
        taskId: before.taskId,
        selectedTaskRevision: before.selectedTaskRevision,
        deletedAt: new Date().toISOString(),
      });
      await tx.changed('TIME_BLOCK', id);
    });
  }
  private decode(
    scope: AuthorizedSpace,
    context: unknown,
    cursor?: string,
  ): CursorState {
    const filter = hash(context);
    if (!cursor)
      return {
        v: 1,
        user: scope.actor.userId,
        space: scope.spaceId,
        filter,
        phase: 'EVENT',
        after: null,
        offset: 0,
        snapshot: null,
        heldId: null,
        revision: null,
      };
    try {
      const value = Cursor.parse(
        JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
      );
      if (
        value.user !== scope.actor.userId ||
        value.space !== scope.spaceId ||
        value.filter !== filter
      )
        throw new Error();
      return value;
    } catch {
      throw new BadRequestException();
    }
  }
  private encode(state: CursorState) {
    return Buffer.from(JSON.stringify(state)).toString('base64url');
  }
  list(
    scope: AuthorizedSpace,
    kind: 'EVENT' | 'BLOCK',
    query: { limit?: string; cursor?: string },
  ) {
    return this.repo.run(scope, async (tx) => {
      const cursor = this.decode(scope, ['list', kind], query.cursor),
        limit = Number(query.limit ?? 25),
        rows =
          kind === 'EVENT'
            ? await tx.events(cursor.after, limit + 1)
            : await tx.blocks(cursor.after, limit + 1),
        items = rows.slice(0, limit);
      return {
        items: items.map(output),
        nextCursor:
          rows.length > limit
            ? this.encode({ ...cursor, after: position(items.at(-1)!) })
            : null,
      };
    });
  }
  private async occurrence(
    tx: CalendarTransaction,
    event: Event,
    key: string,
    now: Date,
  ) {
    const versions = await tx.versions(event.id),
      version = versionAt(versions, key);
    if (
      !version ||
      key.slice(11) !== version.identityTime ||
      !matchesDate(version.definition, key.slice(0, 10))
    )
      throw new NotFoundException();
    const exception = (await tx.exceptions(event.id)).find(
      (e) => e.recurrenceKey === key,
    );
    if (event.splitBefore && key >= event.splitBefore && !exception)
      throw new NotFoundException();
    const candidate = scheduled(version, key.slice(0, 10));
    if (
      candidate.gap ||
      version.status === 'CANCELED' ||
      exception?.status === 'CANCELED'
    )
      throw new ConflictException();
    const actual = interval(
      exception?.schedule ?? candidate.schedule,
      version.definition.timezone,
    );
    if (!actual || actual.start < now.getTime()) throw new ConflictException();
    return { version, exception, schedule: candidate.schedule };
  }
  private boundary(version: Version, input: c.CalendarEventCreate, now: Date) {
    const newDef = input.recurrence!;
    const next = (zone: string, time: string) => {
      const local = localKey(now, zone);
      return local.slice(11, 16) >= time
        ? addDates(local.slice(0, 10), 1)
        : local.slice(0, 10);
    };
    const date = [
      next(version.definition.timezone, version.definition.localTime),
      next(newDef.timezone, newDef.localTime),
      version.fromKey.slice(0, 10),
    ]
      .sort()
      .at(-1)!;
    return date + 'T' + version.identityTime;
  }
  editSeries(
    scope: AuthorizedSpace,
    id: string,
    revision: number,
    key: string | undefined,
    input: c.CalendarSeriesEdit,
  ) {
    const work = async (tx: CalendarTransaction) => {
      const event = await tx.event(id);
      this.revision(event, revision);
      if (!event.recurrence || event.seriesId) fail('NOT_A_SERIES');
      const now = new Date();
      if (input.scope === 'THIS_OCCURRENCE') {
        const { version, exception, schedule } = await this.occurrence(
          tx,
          event,
          input.recurrenceKey,
          now,
        );
        if ((exception?.revision ?? 0) !== input.exceptionRevision)
          throw new ConflictException();
        if (!exception && (await tx.exceptions(id)).length >= 1000)
          fail('EXCEPTION_LIMIT');
        const data = {
          title: input.patch.title ?? exception?.title ?? version.title,
          description:
            input.patch.description === undefined
              ? (exception?.description ?? version.description)
              : input.patch.description,
          schedule: input.patch.schedule
            ? this.normalize(input.patch.schedule)
            : (exception?.schedule ?? schedule),
          status: input.patch.status ?? exception?.status ?? version.status,
        };
        const actual = interval(data.schedule, data.schedule.timezone);
        if (!actual || actual.start < now.getTime())
          throw new ConflictException();
        const changed = exception
          ? await tx.updateEvent(exception, data)
          : await tx.createEvent({
              ...data,
              seriesId: id,
              recurrenceKey: input.recurrenceKey,
            });
        const updated = await tx.updateEvent(event, {});
        await tx.changed('EVENT', id);
        return {
          event: output(updated),
          exception: output(changed),
          successor: null,
        };
      }
      if (event.splitBefore) throw new ConflictException();
      this.definition(input.event);
      if (!input.event.recurrence) fail('RECURRENCE_REQUIRED');
      if (input.scope === 'THIS_AND_FUTURE') {
        await this.occurrence(tx, event, input.recurrenceKey, now);
        if (
          input.event.recurrence.startDate !== input.recurrenceKey.slice(0, 10)
        )
          fail('SPLIT_BOUNDARY_MISMATCH');
        const exceptions = await tx.exceptions(id);
        const exclusions = [
          ...new Set([
            ...input.event.recurrence.exclusionDates,
            ...exceptions
              .filter((e) => e.recurrenceKey! >= input.recurrenceKey)
              .map((e) => e.recurrenceKey!.slice(0, 10)),
          ]),
        ].sort();
        if (exclusions.length > 1000) fail('EXCEPTION_LIMIT');
        const updated = await tx.updateEvent(event, {
          splitBefore: input.recurrenceKey,
        });
        const successor = await this.create(
          tx,
          {
            ...input.event,
            recurrence: {
              ...input.event.recurrence,
              exclusionDates: exclusions,
            },
          },
          id,
        );
        await tx.changed('EVENT', id);
        return {
          event: output(updated),
          exception: null,
          successor: output(successor),
        };
      }
      const versions = await tx.versions(id),
        current = versions.at(-1)!;
      if (current.status === 'CANCELED') throw new ConflictException();
      if (versions.length >= 1000) fail('VERSION_LIMIT');
      if (
        input.event.recurrence.startDate !== current.definition.startDate ||
        input.event.schedule.kind !== event.schedule.kind
      )
        fail('SERIES_IDENTITY_CHANGE');
      const boundary = this.boundary(current, input.event, now);
      await tx.closeVersion(current, boundary);
      const updated = await tx.updateEvent(event, {
        title: input.event.title,
        description: input.event.description ?? null,
        schedule: this.normalize(input.event.schedule),
        status: input.status ?? 'ACTIVE',
      });
      await tx.createVersion(
        updated,
        input.event.recurrence,
        boundary,
        current.identityTime,
      );
      await tx.changed('EVENT', id);
      return {
        event: output(await tx.event(id)),
        exception: null,
        successor: null,
      };
    };
    if (input.scope === 'THIS_AND_FUTURE') {
      if (!key) throw new BadRequestException();
      return this.repo.once(
        scope,
        'post.calendar.series.split',
        key,
        { id, revision, input },
        work,
      );
    }
    return this.repo.run(scope, work);
  }
  private async page(
    tx: CalendarTransaction,
    scope: AuthorizedSpace,
    query: c.CalendarRangeQuery,
    state?: CursorState,
  ) {
    let cursor =
      state ??
      this.decode(
        scope,
        ['view', query.from, query.to, query.timezone],
        query.cursor,
      );
    const result: Occurrence[] = [],
      limit = Number(query.limit ?? 25);
    let scanned = 0;
    while (scanned < 25 && result.length < limit) {
      const rows =
          cursor.phase === 'EVENT'
            ? await tx.events(cursor.after, 1)
            : await tx.blocks(cursor.after, 1),
        row = rows[0];
      if (!row) {
        if (cursor.heldId) throw new ConflictException();
        if (cursor.phase === 'BLOCK')
          return { items: result.map(output), nextCursor: null, state: null };
        cursor = { ...cursor, phase: 'BLOCK', after: null };
        continue;
      }
      if (
        cursor.heldId &&
        (cursor.heldId !== row.id || cursor.revision !== row.revision)
      )
        throw new ConflictException();
      const occurrences =
        cursor.phase === 'EVENT'
          ? expand(
              row as Event,
              await tx.versions(row.id),
              await tx.exceptions(row.id),
              query,
            )
          : inRange(row.schedule, query)
            ? [blockOccurrence(row as Block, query.timezone)]
            : [];
      let offset = cursor.offset;
      while (offset < occurrences.length && result.length < limit)
        result.push(occurrences[offset++]!);
      scanned++;
      if (offset < occurrences.length) {
        cursor = { ...cursor, offset, heldId: row.id, revision: row.revision };
        break;
      }
      cursor = {
        ...cursor,
        after: position(row),
        offset: 0,
        heldId: null,
        revision: null,
      };
    }
    return {
      items: result.map(output),
      nextCursor: this.encode(cursor),
      state: cursor,
    };
  }
  view(scope: AuthorizedSpace, query: c.CalendarRangeQuery) {
    return this.repo.run(scope, async (tx) => {
      const page = await this.page(tx, scope, query);
      return {
        from: query.from,
        to: query.to,
        timezone: query.timezone,
        items: page.items,
        nextCursor: page.nextCursor,
      };
    });
  }
  conflicts(scope: AuthorizedSpace, query: c.CalendarRangeQuery) {
    return this.repo.run(scope, async (tx) => {
      const context = ['conflicts', query.from, query.to, query.timezone],
        cursor = this.decode(scope, context, query.cursor),
        all: Occurrence[] = [];
      let state: CursorState | undefined,
        complete = false;
      for (let count = 0; count < 40; count++) {
        const page = await this.page(
          tx,
          scope,
          { ...query, cursor: undefined, limit: '100' },
          state,
        );
        all.push(...page.items);
        if (all.length > 1000) fail('RANGE_TOO_DENSE');
        if (!page.state) {
          complete = true;
          break;
        }
        state = page.state;
      }
      if (!complete) fail('RANGE_TOO_DENSE');
      const snapshot = hash(
        all.map((o) => [
          o.identity,
          o.revision,
          o.exceptionRevision,
          o.status,
          o.schedule,
        ]),
      );
      // Bind a conflict page to the same authoritative snapshot as its predecessor.
      if (cursor.snapshot && cursor.snapshot !== snapshot)
        throw new ConflictException();
      const pairs: Array<{
        left: string;
        right: string;
        startAt: string;
        endAt: string;
      }> = [];
      const active = all
        .filter((o) => o.status === 'ACTIVE')
        .map((o) => ({ o, i: interval(o.schedule, query.timezone)! }));
      for (let a = 0; a < active.length; a++)
        for (let b = a + 1; b < active.length; b++) {
          const left = active[a]!,
            right = active[b]!;
          if (overlaps(left.i, right.i))
            pairs.push({
              left: left.o.identity,
              right: right.o.identity,
              startAt: new Date(
                Math.max(left.i.start, right.i.start),
              ).toISOString(),
              endAt: new Date(Math.min(left.i.end, right.i.end)).toISOString(),
            });
          if (pairs.length > 10000) fail('RANGE_TOO_DENSE');
        }
      const limit = Number(query.limit ?? 25),
        offset = cursor.offset,
        items = pairs.slice(offset, offset + limit);
      return {
        advisory: true as const,
        items,
        nextCursor:
          offset + items.length < pairs.length
            ? this.encode({
                ...cursor,
                offset: offset + items.length,
                snapshot,
              })
            : null,
      };
    });
  }
}
