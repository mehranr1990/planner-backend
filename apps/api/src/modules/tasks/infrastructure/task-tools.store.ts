import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  TaskTemplateSchema,
  SavedTaskFilterSchema,
  TaskRecurrenceSchema,
  TaskOccurrenceSchema,
} from '@mehran/api-contracts';
import type {
  TaskTemplateCreate,
  TaskTemplatePatch,
  SavedTaskFilterCreate,
  SavedTaskFilterPatch,
  TaskCursorQuery,
  Series,
  Occurrence,
} from '@mehran/api-contracts';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { scopedWhere } from '../../../platform/database/scoped-where.js';
import {
  afterCursor,
  cursorPage,
  cursorPosition,
} from '../../../platform/database/cursor-pagination.js';
import { writeAudit } from '../../../platform/audit/audit.service.js';
import type { TaskTransaction } from '../application/tasks.port.js';
import type { RecurrenceDefinition } from '../domain/recurrence.js';
import type { TaskWrite } from '../domain/tasks.js';

const dateValue = (value: string) => new Date(value + 'T00:00:00Z');
function view<T extends { createdAt: Date; updatedAt: Date }>(row: T) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
function seriesView(
  row: Parameters<typeof view>[0] & {
    scannedThrough: Date | null;
    retiredAt: Date | null;
    splitBefore: Date | null;
  },
) {
  return TaskRecurrenceSchema.parse({
    ...view(row),
    scannedThrough: row.scannedThrough?.toISOString().slice(0, 10) ?? null,
    splitBefore: row.splitBefore?.toISOString().slice(0, 10) ?? null,
    retiredAt: row.retiredAt?.toISOString() ?? null,
  });
}
function occurrenceView(
  row: Parameters<typeof view>[0] & {
    localDate: Date;
    scheduledAt: Date | null;
  },
) {
  const { spaceId: _spaceId, ...value } = row as typeof row & {
    spaceId: string;
  };
  return TaskOccurrenceSchema.parse({
    ...view(value),
    localDate: row.localDate.toISOString().slice(0, 10),
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
  });
}
export class TaskToolsStore {
  constructor(
    protected readonly db: Prisma.TransactionClient,
    protected readonly scope: AuthorizedSpace,
  ) {}
  protected where<T extends object>(where: T) {
    return scopedWhere(this.scope, where);
  }
  private pageOptions(context: string, query: TaskCursorQuery) {
    return {
      where: this.where(
        afterCursor(cursorPosition(this.scope, context, query.cursor)),
      ),
      orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
      take: Number(query.limit ?? 25) + 1,
    };
  }
  private owner() {
    return {
      spaceId: this.scope.spaceId,
      createdByUserId: this.scope.actor.userId,
    };
  }
  async template(id: string) {
    const row = await this.db.taskTemplate.findFirst({
      where: this.where({ id }),
    });
    if (!row) throw new NotFoundException();
    return TaskTemplateSchema.parse(view(row));
  }
  async templates(query: TaskCursorQuery) {
    const context = 'task-templates',
      rows = await this.db.taskTemplate.findMany(
        this.pageOptions(context, query),
      );
    const page = cursorPage(
      this.scope,
      context,
      Number(query.limit ?? 25),
      rows,
    );
    return {
      ...page,
      items: page.items.map((row) => TaskTemplateSchema.parse(view(row))),
    };
  }
  async insertTemplate(input: TaskTemplateCreate) {
    return TaskTemplateSchema.parse(
      view(
        await this.db.taskTemplate.create({
          data: { ...input, ...this.owner() },
        }),
      ),
    );
  }
  async updateTemplate(id: string, revision: number, input: TaskTemplatePatch) {
    await this.template(id);
    const result = await this.db.taskTemplate.updateMany({
      where: this.where({ id, revision }),
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.values !== undefined ? { values: input.values } : {}),
        revision: { increment: 1 },
      },
    });
    if (result.count !== 1) throw new ConflictException();
    return this.template(id);
  }
  async deleteTemplate(id: string, revision: number) {
    await this.template(id);
    if (
      (
        await this.db.taskTemplate.deleteMany({
          where: this.where({ id, revision }),
        })
      ).count !== 1
    )
      throw new ConflictException();
  }
  async savedFilter(id: string) {
    const row = await this.db.savedTaskFilter.findFirst({
      where: this.where({ id }),
    });
    if (!row) throw new NotFoundException();
    return SavedTaskFilterSchema.parse(view(row));
  }
  async savedFilters(query: TaskCursorQuery) {
    const context = 'saved-task-filters',
      rows = await this.db.savedTaskFilter.findMany(
        this.pageOptions(context, query),
      );
    const page = cursorPage(
      this.scope,
      context,
      Number(query.limit ?? 25),
      rows,
    );
    return {
      ...page,
      items: page.items.map((row) => SavedTaskFilterSchema.parse(view(row))),
    };
  }
  async insertSavedFilter(input: SavedTaskFilterCreate) {
    return SavedTaskFilterSchema.parse(
      view(
        await this.db.savedTaskFilter.create({
          data: { ...input, ...this.owner() },
        }),
      ),
    );
  }
  async updateSavedFilter(
    id: string,
    revision: number,
    input: SavedTaskFilterPatch,
  ) {
    await this.savedFilter(id);
    if (
      (
        await this.db.savedTaskFilter.updateMany({
          where: this.where({ id, revision }),
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.query !== undefined ? { query: input.query } : {}),
            revision: { increment: 1 },
          },
        })
      ).count !== 1
    )
      throw new ConflictException();
    return this.savedFilter(id);
  }
  async deleteSavedFilter(id: string, revision: number) {
    await this.savedFilter(id);
    if (
      (
        await this.db.savedTaskFilter.deleteMany({
          where: this.where({ id, revision }),
        })
      ).count !== 1
    )
      throw new ConflictException();
  }
  async series(id: string): Promise<Series> {
    const row = await this.db.taskRecurrence.findFirst({
      where: this.where({ id }),
    });
    if (!row) throw new NotFoundException();
    return seriesView(row);
  }
  async allSeries(query: TaskCursorQuery) {
    const context = 'task-recurrences',
      rows = await this.db.taskRecurrence.findMany(
        this.pageOptions(context, query),
      );
    const page = cursorPage(
      this.scope,
      context,
      Number(query.limit ?? 25),
      rows,
    );
    return { ...page, items: page.items.map(seriesView) };
  }
  async insertSeries(input: {
    id: string;
    masterTaskId: string;
    previousSeriesId: string | null;
    definition: RecurrenceDefinition;
  }) {
    return seriesView(
      await this.db.taskRecurrence.create({
        data: {
          ...input,
          ...this.owner(),
          identityTime: input.definition.localTime,
        },
      }),
    );
  }
  async updateSeries(
    before: Series,
    patch: {
      definition?: RecurrenceDefinition;
      scannedThrough?: string | null;
      retiredAt?: string | null;
      splitBefore?: string;
    },
    incrementRevision = true,
  ) {
    const result = await this.db.taskRecurrence.updateMany({
      where: this.where({ id: before.id, revision: before.revision }),
      data: {
        ...(patch.definition ? { definition: patch.definition } : {}),
        ...(patch.scannedThrough !== undefined
          ? {
              scannedThrough: patch.scannedThrough
                ? dateValue(patch.scannedThrough)
                : null,
            }
          : {}),
        ...(patch.retiredAt !== undefined
          ? { retiredAt: patch.retiredAt ? new Date(patch.retiredAt) : null }
          : {}),
        ...(patch.splitBefore
          ? { splitBefore: dateValue(patch.splitBefore) }
          : {}),
        ...(incrementRevision ? { revision: { increment: 1 } } : {}),
      },
    });
    if (result.count !== 1) throw new ConflictException();
    return this.series(before.id);
  }
  async occurrence(id: string): Promise<Occurrence> {
    const row = await this.db.taskOccurrence.findFirst({
      where: this.where({ id }),
    });
    if (!row) throw new NotFoundException();
    return occurrenceView(row);
  }
  async occurrenceByKey(seriesId: string, recurrenceKey: string) {
    const row = await this.db.taskOccurrence.findFirst({
      where: this.where({ seriesId, recurrenceKey }),
    });
    return row ? occurrenceView(row) : null;
  }
  async occurrences(seriesId: string, query: TaskCursorQuery) {
    await this.series(seriesId);
    const context = 'task-occurrences:' + seriesId,
      options = this.pageOptions(context, query),
      rows = await this.db.taskOccurrence.findMany({
        ...options,
        where: { ...options.where, seriesId },
      });
    const page = cursorPage(
      this.scope,
      context,
      Number(query.limit ?? 25),
      rows,
    );
    return { ...page, items: page.items.map(occurrenceView) };
  }
  async pendingOccurrences(seriesId: string, after?: string) {
    const rows = await this.db.taskOccurrence.findMany({
      where: this.where({
        seriesId,
        state: 'PENDING',
        ...(after ? { recurrenceKey: { gte: after } } : {}),
      }),
      orderBy: [{ recurrenceKey: 'asc' }, { id: 'asc' }],
    });
    return rows.map(occurrenceView);
  }
  async insertOccurrence(
    input: Parameters<TaskTransaction['insertOccurrence']>[0],
  ) {
    return occurrenceView(
      await this.db.taskOccurrence.create({
        data: {
          ...input,
          spaceId: this.scope.spaceId,
          localDate: dateValue(input.localDate),
          scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
        },
      }),
    );
  }
  async updateOccurrence(
    before: Occurrence,
    patch: Parameters<TaskTransaction['updateOccurrence']>[1],
  ) {
    const result = await this.db.taskOccurrence.updateMany({
      where: this.where({ id: before.id, revision: before.revision }),
      data: {
        ...patch,
        ...(patch.localDate ? { localDate: dateValue(patch.localDate) } : {}),
        ...(patch.scheduledAt !== undefined
          ? {
              scheduledAt: patch.scheduledAt
                ? new Date(patch.scheduledAt)
                : null,
            }
          : {}),
        revision: { increment: 1 },
      },
    });
    if (result.count !== 1) throw new ConflictException();
    return this.occurrence(before.id);
  }
  async audit(action: Parameters<TaskTransaction['audit']>[0], id: string) {
    await writeAudit(this.db, {
      action,
      outcome: 'SUCCEEDED',
      resourceId: id,
      actorUserId: this.scope.actor.userId,
      requestId: this.scope.actor.requestId,
      correlationId: this.scope.actor.correlationId,
    });
  }
  protected async syncOccurrence(taskId: string, patch: TaskWrite) {
    const row = await this.db.taskOccurrence.findFirst({
      where: this.where({ taskId }),
    });
    if (!row) return;
    if (
      patch.status &&
      patch.status !== 'CANCELED' &&
      ['SKIPPED', 'CANCELED'].includes(row.state)
    )
      throw new ConflictException();
    const scheduleChange = [
      'title',
      'description',
      'priority',
      'plannedStartAt',
      'dueAt',
      'scheduledDate',
      'parentTaskId',
    ].some((key) => Object.hasOwn(patch, key));
    const data: Prisma.TaskOccurrenceUpdateManyMutationInput = {};
    if (patch.deletedAt === null && row.reason === 'TASK_DELETED') {
      data.state = 'PENDING';
      data.reason = null;
    } else if (patch.deletedAt && row.state === 'PENDING') {
      data.state = 'CANCELED';
      data.reason = 'TASK_DELETED';
    } else if (patch.status !== undefined && row.state !== 'SKIPPED') {
      data.state =
        patch.status === 'DONE'
          ? 'DONE'
          : patch.status === 'CANCELED'
            ? 'CANCELED'
            : 'PENDING';
      data.reason = patch.status === 'CANCELED' ? 'USER_CANCEL' : null;
    }
    if (scheduleChange && row.state === 'PENDING') data.exception = true;
    if (Object.keys(data).length) {
      data.revision = { increment: 1 };
      await this.db.taskOccurrence.updateMany({
        where: this.where({ id: row.id, revision: row.revision }),
        data,
      });
    }
  }
  async requireMasterCandidate(id: string) {
    const row = await this.db.task.findFirst({
      where: this.where({ id, deletedAt: null }),
      include: {
        occurrence: true,
        masterRecurrence: true,
        _count: { select: { subtasks: true } },
      },
    });
    if (!row) throw new NotFoundException();
    if (
      row.status !== 'OPEN' ||
      row.parentTaskId ||
      row._count.subtasks ||
      row.occurrence ||
      row.masterRecurrence
    )
      throw new ConflictException();
  }
  async retainedInLineage(series: Series, localDate: string) {
    let previous = series.previousSeriesId;
    while (previous) {
      const ancestor = await this.series(previous);
      if (
        await this.db.taskOccurrence.count({
          where: this.where({
            seriesId: previous,
            recurrenceKey: { startsWith: localDate + 'T' },
            state: { in: ['DONE', 'SKIPPED', 'CANCELED'] },
            OR: [
              { reason: null },
              { reason: { notIn: ['SERIES_SPLIT', 'SERIES_EDIT'] } },
            ],
          }),
        })
      )
        return true;
      previous = ancestor.previousSeriesId;
    }
    return false;
  }
}
