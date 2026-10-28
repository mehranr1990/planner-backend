import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  RecurrenceCreate,
  RecurrenceEdit,
  CatchUp,
  Series,
  Occurrence,
  TaskCursorQuery,
  TaskCreate,
} from '@mehran/api-contracts';
import { TASKS_REPOSITORY } from './tasks.port.js';
import type { TasksPort, TaskTransaction } from './tasks.port.js';
import { TasksService } from './tasks.service.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { AuditService } from '../../../platform/audit/audit.service.js';
import { history, changedFields, normalizeTitle } from '../domain/tasks.js';
import type { TaskWrite, TaskField } from '../domain/tasks.js';
import {
  matchesDate,
  nextDate,
  recurrenceBatch,
  resolveRecurrenceInstant,
} from '../domain/recurrence.js';
import type { RecurrenceDefinition } from '../domain/recurrence.js';

const cursorSchema = z.strictObject({
  actor: z.string().uuid(),
  space: z.string().uuid(),
  series: z.string().uuid(),
  revision: z.number().int().positive(),
  through: z.iso.date(),
  next: z.iso.date(),
});
const normalized = (
  definition: RecurrenceDefinition,
): RecurrenceDefinition => ({
  ...definition,
  exclusionDates: [...definition.exclusionDates].sort(),
  rule:
    definition.rule.kind === 'WEEKDAYS'
      ? {
          ...definition.rule,
          weekdays: [...definition.rule.weekdays].sort((a, b) => a - b),
        }
      : definition.rule,
});
const expected = (value: { revision: number }, revision: number) => {
  if (value.revision !== revision) throw new ConflictException();
};
@Injectable()
export class RecurrenceService {
  constructor(
    @Inject(TASKS_REPOSITORY) private readonly repository: TasksPort,
    @Inject(TasksService) private readonly tasks: TasksService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}
  private async run<T>(
    scope: AuthorizedSpace,
    id: string | undefined,
    work: (tx: TaskTransaction) => Promise<T>,
  ) {
    try {
      return await this.repository.transaction(scope, work);
    } catch (error) {
      if (error instanceof NotFoundException)
        await this.audit.record({
          action: 'ACCESS_DENIED',
          outcome: 'DENIED',
          resourceId: id ?? null,
          actorUserId: scope.actor.userId,
          requestId: scope.actor.requestId,
          correlationId: scope.actor.correlationId,
        });
      throw error;
    }
  }
  list(scope: AuthorizedSpace, query: TaskCursorQuery) {
    return this.run(scope, undefined, (tx) => tx.allSeries(query));
  }
  get(scope: AuthorizedSpace, id: string) {
    return this.run(scope, id, (tx) => tx.series(id));
  }
  occurrence(scope: AuthorizedSpace, id: string) {
    return this.run(scope, id, (tx) => tx.occurrence(id));
  }
  occurrences(scope: AuthorizedSpace, id: string, query: TaskCursorQuery) {
    return this.run(scope, id, (tx) => tx.occurrences(id, query));
  }
  private async touchMaster(tx: TaskTransaction, series: Series) {
    // Series definition/history belongs to its own revision and metadata audit.
    // A relation change must not invent a change to a Task scalar field.
    await tx.events('task.updated', [series.masterTaskId]);
  }
  create(scope: AuthorizedSpace, input: RecurrenceCreate) {
    return this.run(scope, input.taskId, async (tx) => {
      const master = await tx.task(input.taskId);
      expected(master, input.taskRevision);
      await tx.requireMasterCandidate(master.id);
      const series = await tx.insertSeries({
        id: randomUUID(),
        masterTaskId: master.id,
        previousSeriesId: null,
        definition: normalized(input.definition),
      });
      await this.touchMaster(tx, series);
      await tx.audit('TASK_RECURRENCE_CREATE', series.id);
      return series;
    });
  }
  private async copyMaster(
    scope: AuthorizedSpace,
    tx: TaskTransaction,
    masterId: string,
    schedule?: { localDate: string; instant: Date },
  ) {
    const master = await tx.task(masterId);
    const input: TaskCreate = {
      title: master.title,
      description: master.description,
      priority: master.priority,
      ...(schedule
        ? {
            scheduledDate: schedule.localDate,
            dueAt: schedule.instant.toISOString(),
          }
        : {}),
    };
    const task = await this.tasks.create(scope, input, undefined, tx);
    const fields: TaskField[] = [];
    let cursor: string | undefined;
    do {
      const page = await tx.checklist(masterId, {
        limit: '100',
        ...(cursor ? { cursor } : {}),
      });
      for (const item of page.items)
        await tx.insertChecklist(task.id, {
          title: item.title,
          position: item.position,
        });
      if (page.items.length && !fields.includes('checklistItems'))
        fields.push('checklistItems');
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    do {
      const page = await tx.labels(
        { limit: '100', ...(cursor ? { cursor } : {}) },
        masterId,
      );
      for (const label of page.items)
        await tx.setLabel(task.id, label.id, true);
      if (page.items.length && !fields.includes('labels'))
        fields.push('labels');
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    if (fields.length) {
      const before = await tx.task(task.id),
        after = await tx.updateTask(before, {});
      await tx.record([history(before, after, 'UPDATED', fields)]);
      await tx.events('task.updated', [after.id]);
    }
    return tx.task(task.id);
  }
  private async patchSeriesTask(
    tx: TaskTransaction,
    taskId: string,
    patch: Partial<{ [K in keyof TaskWrite]: TaskWrite[K] | undefined }>,
    relatedId: string,
  ) {
    const normalizedPatch = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    ) as TaskWrite;
    if (normalizedPatch.title !== undefined)
      normalizedPatch.title = normalizeTitle(normalizedPatch.title);
    const before = await tx.task(taskId),
      fields = changedFields(before, normalizedPatch);
    if (!fields.length) return;
    const after = await tx.updateTask(before, normalizedPatch);
    await tx.record([history(before, after, 'UPDATED', fields, relatedId)]);
    await tx.events('task.updated', [taskId]);
    if (fields.includes('dueAt')) await tx.events('task.due_changed', [taskId]);
  }
  catchUp(scope: AuthorizedSpace, id: string, input: CatchUp) {
    return this.run(scope, id, async (tx) => {
      const series = await tx.series(id);
      if (series.retiredAt && !series.splitBefore)
        throw new ConflictException();
      let from = series.scannedThrough
        ? nextDate(series.scannedThrough)
        : series.definition.startDate;
      if (input.cursor) {
        try {
          if (!/^[A-Za-z0-9_-]+$/.test(input.cursor)) throw new Error();
          const cursor = cursorSchema.parse(
            JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')),
          );
          if (
            cursor.actor !== scope.actor.userId ||
            cursor.space !== scope.spaceId ||
            cursor.series !== id ||
            cursor.through !== input.through
          )
            throw new BadRequestException();
          if (cursor.revision !== series.revision)
            throw new ConflictException();
          if (cursor.next > from) throw new BadRequestException();
          from = cursor.next;
        } catch (error) {
          if (error instanceof ConflictException) throw error;
          throw new BadRequestException();
        }
      }
      const through =
        series.splitBefore && series.splitBefore <= input.through
          ? nextDate(series.splitBefore, -1)
          : input.through;
      const batch = recurrenceBatch(
          series.definition,
          from,
          through,
          input.limit,
        ),
        items: Occurrence[] = [];
      for (const candidate of batch.candidates) {
        // Keep the original series identity time even when its display schedule is edited.
        const key = candidate.localDate + 'T' + series.identityTime + ':00';
        const existing = await tx.occurrenceByKey(id, key);
        if (existing) {
          items.push(existing);
          continue;
        }
        if (await tx.retainedInLineage(series, candidate.localDate)) continue;
        const task = candidate.instant
          ? await this.copyMaster(scope, tx, series.masterTaskId, {
              localDate: candidate.localDate,
              instant: candidate.instant,
            })
          : null;
        items.push(
          await tx.insertOccurrence({
            seriesId: id,
            taskId: task?.id ?? null,
            recurrenceKey: key,
            localDate: candidate.localDate,
            localTime: series.definition.localTime,
            timezone: series.definition.timezone,
            scheduledAt: candidate.instant?.toISOString() ?? null,
            state: candidate.instant ? 'PENDING' : 'SKIPPED',
            reason: candidate.instant ? null : 'DST_GAP',
          }),
        );
      }
      if (
        batch.scannedThrough &&
        (!series.scannedThrough || batch.scannedThrough > series.scannedThrough)
      )
        await tx.updateSeries(
          series,
          { scannedThrough: batch.scannedThrough },
          false,
        );
      const nextCursor = batch.nextDate
        ? Buffer.from(
            JSON.stringify({
              actor: scope.actor.userId,
              space: scope.spaceId,
              series: id,
              revision: series.revision,
              through: input.through,
              next: batch.nextDate,
            }),
          ).toString('base64url')
        : null;
      return {
        items,
        nextCursor,
        scannedThrough: batch.scannedThrough ?? series.scannedThrough,
      };
    });
  }
  private async cancelPending(
    tx: TaskTransaction,
    occurrence: Occurrence,
    state: 'SKIPPED' | 'CANCELED',
    reason: Occurrence['reason'],
  ) {
    if (occurrence.state !== 'PENDING') throw new ConflictException();
    if (occurrence.taskId) {
      const before = await tx.task(occurrence.taskId),
        after = await tx.updateTask(before, {
          status: 'CANCELED',
          completedAt: null,
        });
      await tx.record([
        history(before, after, 'UPDATED', ['status'], occurrence.id),
      ]);
      await tx.events('task.updated', [after.id]);
    }
    return tx.updateOccurrence(await tx.occurrence(occurrence.id), {
      state,
      reason,
    });
  }
  action(
    scope: AuthorizedSpace,
    id: string,
    revision: number,
    action: 'complete' | 'skip' | 'cancel',
    taskRevision?: number,
  ) {
    return this.run(scope, id, async (tx) => {
      const occurrence = await tx.occurrence(id);
      expected(occurrence, revision);
      if (occurrence.state !== 'PENDING' || !occurrence.taskId)
        throw new ConflictException();
      if (taskRevision === undefined) throw new BadRequestException();
      expected(await tx.task(occurrence.taskId), taskRevision);
      if (action === 'complete')
        await this.tasks.changeStatus(
          scope,
          occurrence.taskId,
          taskRevision,
          'complete',
          tx,
        );
      else {
        await this.cancelPending(
          tx,
          occurrence,
          action === 'skip' ? 'SKIPPED' : 'CANCELED',
          action === 'skip' ? 'USER_SKIP' : 'USER_CANCEL',
        );
        await tx.audit(
          action === 'skip' ? 'TASK_OCCURRENCE_SKIP' : 'TASK_OCCURRENCE_CANCEL',
          id,
        );
      }
      return tx.occurrence(id);
    });
  }
  edit(
    scope: AuthorizedSpace,
    id: string,
    revision: number,
    input: RecurrenceEdit,
  ) {
    return this.run(scope, id, async (tx) => {
      const series = await tx.series(id);
      expected(series, revision);
      if (series.retiredAt) throw new ConflictException();
      let successor: Series | null = null,
        occurrence: Occurrence | null = null;
      if (input.scope === 'THIS_OCCURRENCE') {
        occurrence = await tx.occurrence(input.occurrenceId);
        if (occurrence.seriesId !== id) throw new NotFoundException();
        expected(occurrence, input.occurrenceRevision);
        if (occurrence.state !== 'PENDING' || !occurrence.taskId)
          throw new ConflictException();
        await this.tasks.patch(
          scope,
          occurrence.taskId,
          input.taskRevision,
          input.patch,
          tx,
        );
        occurrence = await tx.updateOccurrence(
          await tx.occurrence(occurrence.id),
          {
            exception: true,
            ...(input.patch.dueAt ? { scheduledAt: input.patch.dueAt } : {}),
            ...(input.patch.scheduledDate
              ? { localDate: input.patch.scheduledDate }
              : {}),
          },
        );
        await tx.updateSeries(series, {});
      } else if (input.scope === 'THIS_AND_FUTURE') {
        occurrence = await tx.occurrence(input.occurrenceId);
        if (occurrence.seriesId !== id) throw new NotFoundException();
        expected(occurrence, input.occurrenceRevision);
        if (occurrence.state !== 'PENDING') throw new ConflictException();
        const boundary = occurrence.recurrenceKey.slice(0, 10);
        if (input.definition.startDate !== boundary)
          throw new BadRequestException();
        const master = await this.copyMaster(scope, tx, series.masterTaskId);
        successor = await tx.insertSeries({
          id: randomUUID(),
          masterTaskId: master.id,
          previousSeriesId: id,
          definition: normalized(input.definition),
        });
        if (input.taskPatch)
          await this.patchSeriesTask(
            tx,
            master.id,
            input.taskPatch,
            successor.id,
          );
        await this.touchMaster(tx, successor);
        for (const pending of await tx.pendingOccurrences(
          id,
          boundary + 'T00:00:00',
        ))
          await this.cancelPending(tx, pending, 'CANCELED', 'SERIES_SPLIT');
        await tx.updateSeries(series, {
          retiredAt: new Date().toISOString(),
          splitBefore: boundary,
        });
      } else {
        const definition = normalized(input.definition);
        if (input.taskPatch)
          await this.patchSeriesTask(
            tx,
            series.masterTaskId,
            input.taskPatch,
            series.id,
          );
        for (const pending of await tx.pendingOccurrences(id)) {
          if (pending.exception) continue;
          const localDate = pending.recurrenceKey.slice(0, 10);
          if (!matchesDate(definition, localDate)) {
            await this.cancelPending(tx, pending, 'CANCELED', 'SERIES_EDIT');
            continue;
          }
          const instant = resolveRecurrenceInstant(
            localDate + 'T' + definition.localTime + ':00',
            definition.timezone,
          );
          if (!instant) {
            const skipped = await this.cancelPending(
              tx,
              pending,
              'SKIPPED',
              'DST_GAP',
            );
            await tx.updateOccurrence(skipped, {
              scheduledAt: null,
              localDate,
              localTime: definition.localTime,
              timezone: definition.timezone,
            });
            continue;
          }
          if (pending.taskId) {
            await this.patchSeriesTask(
              tx,
              pending.taskId,
              { ...input.taskPatch, dueAt: instant, scheduledDate: localDate },
              pending.id,
            );
          }
          await tx.updateOccurrence(await tx.occurrence(pending.id), {
            scheduledAt: instant.toISOString(),
            localDate,
            localTime: definition.localTime,
            timezone: definition.timezone,
            exception: false,
          });
        }
        await tx.updateSeries(series, { definition, scannedThrough: null });
      }
      await this.touchMaster(tx, series);
      await tx.audit('TASK_RECURRENCE_EDIT', id);
      return {
        series: await tx.series(id),
        successor,
        occurrence: occurrence ? await tx.occurrence(occurrence.id) : null,
      };
    });
  }
  cancel(scope: AuthorizedSpace, id: string, revision: number) {
    return this.run(scope, id, async (tx) => {
      const series = await tx.series(id);
      expected(series, revision);
      if (series.retiredAt) throw new ConflictException();
      for (const pending of await tx.pendingOccurrences(id))
        await this.cancelPending(tx, pending, 'CANCELED', 'SERIES_CANCELED');
      const result = await tx.updateSeries(series, {
        retiredAt: new Date().toISOString(),
      });
      await this.touchMaster(tx, series);
      await tx.audit('TASK_RECURRENCE_CANCEL', id);
      return result;
    });
  }
}
