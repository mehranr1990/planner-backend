import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  HttpException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { BulkTaskResultSchema } from '@mehran/api-contracts';
import type { BulkTaskResult } from '@mehran/api-contracts';
import { TaskToolsStore } from './task-tools.store.js';
import { persistenceStatus } from '../../../platform/database/persistence-error.js';
import { z } from 'zod';
import { Prisma } from '../../../generated/prisma/client.js';
import type { Task as DatabaseTask } from '../../../generated/prisma/client.js';
import type {
  TaskCreate,
  TaskListQuery,
  TaskSubtaskQuery,
  TaskCursorQuery,
  ChecklistCreate,
  ChecklistPatch,
} from '@mehran/api-contracts';
import { DatabaseService } from '../../../platform/database/database.service.js';
import {
  cursorPosition,
  cursorPage,
  afterCursor,
} from '../../../platform/database/cursor-pagination.js';
import { idempotent } from '../../../platform/database/idempotency.js';
import { appendOutboxBatch } from '../../../platform/outbox/outbox.js';
import { FileCatalog } from '../../../platform/storage/public/index.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import type {
  TasksPort,
  TaskReader,
  TaskTransaction,
} from '../application/tasks.port.js';
import { TASK_RESTORE_MS, TaskRuleError } from '../domain/tasks.js';
import type {
  TaskRecord,
  TaskNode,
  TaskWrite,
  ChecklistRecord,
  LabelRecord,
  TaskChangeInput,
  TaskChangeRecord,
  AttachmentRecord,
  Page,
} from '../domain/tasks.js';

const nodeSelect = {
  id: true,
  parentTaskId: true,
  status: true,
  priority: true,
  revision: true,
  deletedAt: true,
  deletionBatchId: true,
  updatedAt: true,
} as const;
function taskRecord(row: DatabaseTask): TaskRecord {
  return {
    id: row.id,
    spaceId: row.spaceId,
    createdByUserId: row.createdByUserId,
    title: row.title,
    description:
      row.descriptionContent === null
        ? null
        : { format: 'MARKDOWN', version: 1, content: row.descriptionContent },
    status: row.status,
    priority: row.priority,
    parentTaskId: row.parentTaskId,
    plannedStartAt: row.plannedStartAt,
    dueAt: row.dueAt,
    scheduledDate: row.scheduledDate?.toISOString().slice(0, 10) ?? null,
    completedAt: row.completedAt,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    deletionBatchId: row.deletionBatchId,
  };
}
function taskData(patch: TaskWrite): Prisma.TaskUncheckedUpdateManyInput {
  const data: Prisma.TaskUncheckedUpdateManyInput = {};
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.description !== undefined) {
    data.descriptionContent = patch.description?.content ?? null;
    data.descriptionFormat = 'MARKDOWN';
    data.descriptionVersion = 1;
  }
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.priority !== undefined) data.priority = patch.priority;
  if (patch.parentTaskId !== undefined) data.parentTaskId = patch.parentTaskId;
  if (patch.plannedStartAt !== undefined)
    data.plannedStartAt = patch.plannedStartAt;
  if (patch.dueAt !== undefined) data.dueAt = patch.dueAt;
  if (patch.scheduledDate !== undefined)
    data.scheduledDate = patch.scheduledDate
      ? new Date(patch.scheduledDate + 'T00:00:00.000Z')
      : null;
  if (patch.completedAt !== undefined) data.completedAt = patch.completedAt;
  if (patch.deletedAt !== undefined) data.deletedAt = patch.deletedAt;
  if (patch.deletionBatchId !== undefined)
    data.deletionBatchId = patch.deletionBatchId;
  return data;
}
const filter = (kind: string, value: unknown) =>
  kind + ':' + createHash('sha256').update(JSON.stringify(value)).digest('hex');
const orderedSchema = z.strictObject({
  version: z.literal(1),
  actor: z.string().uuid(),
  space: z.string().uuid(),
  context: z.string().max(100),
  value: z.number().int().nonnegative(),
  id: z.string().uuid(),
});
function orderedPosition(
  scope: AuthorizedSpace,
  context: string,
  cursor?: string,
) {
  if (cursor === undefined) return undefined;
  try {
    if (cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(cursor))
      throw new Error();
    const result = orderedSchema.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
    if (
      result.actor !== scope.actor.userId ||
      result.space !== scope.spaceId ||
      result.context !== context
    )
      throw new Error();
    return result;
  } catch {
    throw new BadRequestException();
  }
}
function orderedPage<T extends { id: string }>(
  scope: AuthorizedSpace,
  context: string,
  limit: number,
  rows: T[],
  order: (row: T) => number,
): Page<T> {
  const items = rows.slice(0, limit),
    last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > limit && last
        ? Buffer.from(
            JSON.stringify({
              version: 1,
              actor: scope.actor.userId,
              space: scope.spaceId,
              context,
              value: order(last),
              id: last.id,
            }),
          ).toString('base64url')
        : null,
  };
}

class ScopedTasksStore extends TaskToolsStore implements TaskTransaction {
  constructor(
    db: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    private readonly files: FileCatalog,
  ) {
    super(db, scope);
  }
  async task(id: string, includeDeleted = false): Promise<TaskRecord> {
    const row = await this.db.task.findFirst({
      where: this.where({ id, ...(includeDeleted ? {} : { deletedAt: null }) }),
      include: { masterRecurrence: { select: { id: true } } },
    });
    if (!row) throw new NotFoundException();
    return {
      ...taskRecord(row),
      isRecurrenceMaster: row.masterRecurrence !== null,
    };
  }
  private async walk(id: string, upward: boolean): Promise<TaskNode[]> {
    const edge = upward
      ? Prisma.sql`next."id"=nodes."parentTaskId"`
      : Prisma.sql`next."parentTaskId"=nodes."id"`;
    return this.db.$queryRaw<TaskNode[]>(Prisma.sql`WITH RECURSIVE nodes AS (
      SELECT "id","parentTaskId","status","priority","revision","deletedAt","deletionBatchId","updatedAt",ARRAY["id"] AS path
      FROM "Task" WHERE "id"=${id}::uuid AND "spaceId"=${this.scope.spaceId}::uuid
      UNION ALL SELECT next."id",next."parentTaskId",next."status",next."priority",next."revision",next."deletedAt",next."deletionBatchId",next."updatedAt",nodes.path||next."id"
      FROM "Task" next JOIN nodes ON ${edge} WHERE next."spaceId"=${this.scope.spaceId}::uuid AND NOT next."id"=ANY(nodes.path)
    ) SELECT "id","parentTaskId","status","priority","revision","deletedAt","deletionBatchId","updatedAt" FROM nodes`);
  }
  ancestors(id: string) {
    return this.walk(id, true);
  }
  subtree(id: string) {
    return this.walk(id, false);
  }
  async tasks(query: TaskListQuery): Promise<Page<TaskRecord>> {
    if (query.parentTaskId)
      await this.task(query.parentTaskId, query.deleted === 'true');
    if (query.labelId) await this.label(query.labelId);
    const key = filter('tasks', {
      status: query.status,
      priority: query.priority,
      parentTaskId: query.parentTaskId,
      rootOnly: query.rootOnly === 'true',
      labelId: query.labelId,
      scheduledDate: query.scheduledDate,
      dueFrom: query.dueFrom,
      dueTo: query.dueTo,
      deleted: query.deleted === 'true',
    });
    const position = cursorPosition(this.scope, key, query.cursor),
      limit = Number(query.limit ?? 25);
    const conditions: Prisma.TaskWhereInput = {
      masterRecurrence: { is: null },
      deletedAt:
        query.deleted === 'true'
          ? { gt: new Date(Date.now() - TASK_RESTORE_MS) }
          : null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.parentTaskId
        ? { parentTaskId: query.parentTaskId }
        : query.rootOnly === 'true'
          ? { parentTaskId: null }
          : {}),
      ...(query.labelId
        ? {
            labels: {
              some: { spaceId: this.scope.spaceId, labelId: query.labelId },
            },
          }
        : {}),
      ...(query.scheduledDate
        ? { scheduledDate: new Date(query.scheduledDate + 'T00:00:00.000Z') }
        : {}),
      ...(query.dueFrom || query.dueTo
        ? {
            dueAt: {
              ...(query.dueFrom ? { gte: new Date(query.dueFrom) } : {}),
              ...(query.dueTo ? { lte: new Date(query.dueTo) } : {}),
            },
          }
        : {}),
      ...afterCursor(position),
    };
    const rows = await this.db.task.findMany({
      where: this.where(conditions),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });
    return cursorPage(this.scope, key, limit, rows.map(taskRecord));
  }
  async subtasks(
    id: string,
    query: TaskSubtaskQuery,
  ): Promise<Page<TaskRecord>> {
    await this.task(id);
    if (query.recursive !== 'true')
      return this.tasks({
        parentTaskId: id,
        ...(query.limit ? { limit: query.limit } : {}),
        ...(query.cursor ? { cursor: query.cursor } : {}),
      });
    const key = filter('subtree', { id }),
      position = cursorPosition(this.scope, key, query.cursor),
      limit = Number(query.limit ?? 25);
    const after = position
      ? Prisma.sql`AND (task."createdAt">${position.createdAt} OR (task."createdAt"=${position.createdAt} AND task."id">${position.id}::uuid))`
      : Prisma.empty;
    const rows = await this.db.$queryRaw<
      DatabaseTask[]
    >(Prisma.sql`WITH RECURSIVE nodes AS (
      SELECT "id",ARRAY["id"] AS path FROM "Task" WHERE "id"=${id}::uuid AND "spaceId"=${this.scope.spaceId}::uuid
      UNION ALL SELECT child."id",nodes.path||child."id" FROM "Task" child JOIN nodes ON child."parentTaskId"=nodes."id"
      WHERE child."spaceId"=${this.scope.spaceId}::uuid AND NOT child."id"=ANY(nodes.path)
    ) SELECT task.* FROM "Task" task JOIN nodes ON task."id"=nodes."id"
    WHERE task."spaceId"=${this.scope.spaceId}::uuid AND task."id"<>${id}::uuid AND task."deletedAt" IS NULL ${after}
    ORDER BY task."createdAt" ASC,task."id" ASC LIMIT ${limit + 1}`);
    return cursorPage(this.scope, key, limit, rows.map(taskRecord));
  }
  async checklist(
    taskId: string,
    query: TaskCursorQuery,
  ): Promise<Page<ChecklistRecord>> {
    await this.task(taskId);
    const context = filter('checklist', taskId),
      position = orderedPosition(this.scope, context, query.cursor),
      limit = Number(query.limit ?? 25);
    const rows = await this.db.taskChecklistItem.findMany({
      where: this.where({
        taskId,
        ...(position
          ? {
              OR: [
                { position: { gt: position.value } },
                { position: position.value, id: { gt: position.id } },
              ],
            }
          : {}),
      }),
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });
    return orderedPage(this.scope, context, limit, rows, (row) => row.position);
  }
  async checklistItem(taskId: string, id: string) {
    const item = await this.db.taskChecklistItem.findFirst({
      where: this.where({ taskId, id }),
    });
    if (!item) throw new NotFoundException();
    return item;
  }
  async label(id: string) {
    const label = await this.db.label.findFirst({ where: this.where({ id }) });
    if (!label) throw new NotFoundException();
    return label;
  }
  async labels(
    query: TaskCursorQuery,
    taskId?: string,
  ): Promise<Page<LabelRecord>> {
    if (taskId) await this.task(taskId);
    const key = filter('labels', taskId ?? null),
      position = cursorPosition(this.scope, key, query.cursor),
      limit = Number(query.limit ?? 25);
    const rows = await this.db.label.findMany({
      where: this.where({
        ...afterCursor(position),
        ...(taskId
          ? { tasks: { some: { taskId, spaceId: this.scope.spaceId } } }
          : {}),
      }),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });
    return cursorPage(this.scope, key, limit, rows);
  }
  async attachments(
    taskId: string,
    query: TaskCursorQuery,
  ): Promise<Page<AttachmentRecord>> {
    await this.task(taskId);
    const key = filter('attachments', taskId),
      position = cursorPosition(this.scope, key, query.cursor),
      limit = Number(query.limit ?? 25);
    const rows = await this.db.taskAttachment.findMany({
      where: this.where({
        taskId,
        ...(position
          ? {
              OR: [
                { createdAt: { gt: position.createdAt } },
                { createdAt: position.createdAt, fileId: { gt: position.id } },
              ],
            }
          : {}),
      }),
      orderBy: [{ createdAt: 'asc' }, { fileId: 'asc' }],
      take: limit + 1,
    });
    const page = cursorPage(
      this.scope,
      key,
      limit,
      rows.map((row) => ({ ...row, id: row.fileId })),
    );
    const files = await this.files.describe(
        this.db,
        this.scope,
        page.items.map((row) => row.fileId),
      ),
      lookup = new Map(files.map((file) => [file.id, file]));
    return {
      nextCursor: page.nextCursor,
      items: page.items.map((row) => {
        const file = lookup.get(row.fileId)!;
        return {
          fileId: row.fileId,
          filename: file.filename,
          mimeType: file.mimeType,
          status: file.status,
          size: file.size,
          attachedAt: row.createdAt,
        };
      }),
    };
  }
  async history(
    taskId: string,
    query: TaskCursorQuery,
  ): Promise<Page<TaskChangeRecord>> {
    await this.task(taskId, true);
    const context = filter('history', taskId),
      position = orderedPosition(this.scope, context, query.cursor),
      limit = Number(query.limit ?? 25);
    const rows = await this.db.taskChange.findMany({
      where: this.where({
        taskId,
        ...(position
          ? {
              OR: [
                { revision: { gt: position.value } },
                { revision: position.value, id: { gt: position.id } },
              ],
            }
          : {}),
      }),
      orderBy: [{ revision: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });
    const page = orderedPage(
      this.scope,
      context,
      limit,
      rows,
      (row) => row.revision,
    );
    return {
      nextCursor: page.nextCursor,
      items: page.items.map((row) => ({
        id: row.id,
        taskId: row.taskId,
        actorUserId: row.actorUserId,
        kind: row.kind as TaskChangeRecord['kind'],
        fields: row.fields as TaskChangeRecord['fields'],
        previousRevision: row.previousRevision,
        revision: row.revision,
        beforeStatus: row.beforeStatus,
        afterStatus: row.afterStatus,
        beforePriority: row.beforePriority,
        afterPriority: row.afterPriority,
        relatedId: row.relatedId,
        createdAt: row.createdAt,
      })),
    };
  }
  async insertTask(input: TaskCreate & { id: string }): Promise<TaskRecord> {
    const row = await this.db.task.create({
      data: {
        id: input.id,
        spaceId: this.scope.spaceId,
        createdByUserId: this.scope.actor.userId,
        title: input.title,
        descriptionContent: input.description?.content ?? null,
        status: input.status ?? 'OPEN',
        priority: input.priority ?? 'NONE',
        parentTaskId: input.parentTaskId ?? null,
        plannedStartAt: input.plannedStartAt
          ? new Date(input.plannedStartAt)
          : null,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        scheduledDate: input.scheduledDate
          ? new Date(input.scheduledDate + 'T00:00:00.000Z')
          : null,
      },
    });
    return taskRecord(row);
  }
  async updateTask(task: TaskRecord, patch: TaskWrite): Promise<TaskRecord> {
    await this.syncOccurrence(task.id, patch);
    const result = await this.db.task.updateMany({
      where: this.where({ id: task.id, revision: task.revision }),
      data: { ...taskData(patch), revision: { increment: 1 } },
    });
    if (result.count !== 1) throw new ConflictException();
    return this.task(task.id, true);
  }
  async updateTasks(tasks: TaskNode[], patch: TaskWrite): Promise<TaskNode[]> {
    if (!tasks.length) return [];
    for (const task of tasks) await this.syncOccurrence(task.id, patch);
    const result = await this.db.task.updateMany({
      where: this.where({
        OR: tasks.map((task) => ({ id: task.id, revision: task.revision })),
      }),
      data: { ...taskData(patch), revision: { increment: 1 } },
    });
    if (result.count !== tasks.length) throw new ConflictException();
    return this.db.task.findMany({
      where: this.where({ id: { in: tasks.map((task) => task.id) } }),
      select: nodeSelect,
    });
  }
  async record(changes: TaskChangeInput[]): Promise<void> {
    if (changes.length)
      await this.db.taskChange.createMany({
        data: changes.map((change) => ({
          ...change,
          spaceId: this.scope.spaceId,
          actorUserId: this.scope.actor.userId,
        })),
      });
  }
  events(type: Parameters<TaskTransaction['events']>[0], ids: string[]) {
    return appendOutboxBatch(
      this.db,
      this.scope,
      ids.map((id) => ({ type, version: 1, aggregateId: id, payload: {} })),
    );
  }
  async insertChecklist(taskId: string, input: ChecklistCreate) {
    const last =
      input.position === undefined
        ? await this.db.taskChecklistItem.findFirst({
            where: this.where({ taskId }),
            orderBy: { position: 'desc' },
            select: { position: true },
          })
        : null;
    const position = input.position ?? (last ? last.position + 1 : 0);
    if (position > 2147483000) throw new TaskRuleError('POSITION');
    return this.db.taskChecklistItem.create({
      data: {
        spaceId: this.scope.spaceId,
        taskId,
        title: input.title,
        position,
      },
    });
  }
  async updateChecklist(taskId: string, id: string, input: ChecklistPatch) {
    const result = await this.db.taskChecklistItem.updateMany({
      where: this.where({ taskId, id }),
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.completed !== undefined
          ? { completed: input.completed }
          : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
      },
    });
    if (result.count !== 1) throw new NotFoundException();
    return this.checklistItem(taskId, id);
  }
  async deleteChecklist(taskId: string, id: string) {
    const result = await this.db.taskChecklistItem.deleteMany({
      where: this.where({ taskId, id }),
    });
    if (result.count !== 1) throw new NotFoundException();
  }
  insertLabel(name: string) {
    return this.db.label.create({
      data: { spaceId: this.scope.spaceId, name },
    });
  }
  async updateLabel(label: LabelRecord, name: string) {
    const result = await this.db.label.updateMany({
      where: this.where({ id: label.id, revision: label.revision }),
      data: { name, revision: { increment: 1 } },
    });
    if (result.count !== 1) throw new ConflictException();
    return this.label(label.id);
  }
  async deleteLabel(id: string) {
    await this.db.label.deleteMany({ where: this.where({ id }) });
  }
  tasksForLabel(id: string) {
    return this.db.task.findMany({
      where: this.where({
        labels: { some: { spaceId: this.scope.spaceId, labelId: id } },
      }),
      select: nodeSelect,
    });
  }
  async setLabel(taskId: string, labelId: string, present: boolean) {
    if (present)
      return (
        (
          await this.db.taskLabel.createMany({
            data: [{ spaceId: this.scope.spaceId, taskId, labelId }],
            skipDuplicates: true,
          })
        ).count === 1
      );
    return (
      (
        await this.db.taskLabel.deleteMany({
          where: this.where({ taskId, labelId }),
        })
      ).count === 1
    );
  }
  async setAttachment(taskId: string, fileId: string, present: boolean) {
    if (present) {
      await this.files.requireReady(this.db, this.scope, fileId);
      return (
        (
          await this.db.taskAttachment.createMany({
            data: [{ spaceId: this.scope.spaceId, taskId, fileId }],
            skipDuplicates: true,
          })
        ).count === 1
      );
    }
    await this.files.describe(this.db, this.scope, [fileId]);
    return (
      (
        await this.db.taskAttachment.deleteMany({
          where: this.where({ taskId, fileId }),
        })
      ).count === 1
    );
  }
}

@Injectable()
export class TasksRepository implements TasksPort {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(FileCatalog) private readonly files: FileCatalog,
  ) {}
  read(scope: AuthorizedSpace): TaskReader {
    return new ScopedTasksStore(this.database.client, scope, this.files);
  }
  private async locked(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    // One personal-space hierarchy writer at a time; never a cross-tenant lock.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`tasks:${scope.spaceId}`},0))::text`;
    return new ScopedTasksStore(tx, scope, this.files);
  }
  transaction<T>(
    scope: AuthorizedSpace,
    work: (tx: TaskTransaction) => Promise<T>,
  ): Promise<T> {
    return this.database.client.$transaction(
      async (tx) => work(await this.locked(tx, scope)),
      { timeout: 30000 },
    );
  }
  async templateTaskOnce(
    scope: AuthorizedSpace,
    key: string,
    request: unknown,
    work: (tx: TaskTransaction) => Promise<TaskRecord>,
  ) {
    const receipt = await idempotent(
      this.database.client,
      scope,
      'post.task-templates.apply',
      key,
      request,
      async (tx) => ({
        resultId: (await work(await this.locked(tx, scope))).id,
        statusCode: 201,
      }),
    );
    return this.read(scope).task(receipt.resultId, true);
  }
  async bulkItemOnce(
    scope: AuthorizedSpace,
    key: string,
    request: { index: number; batch: unknown },
    work: (tx: TaskTransaction) => Promise<BulkTaskResult>,
  ) {
    const receipt = await idempotent(
      this.database.client,
      scope,
      'post.tasks.bulk-item',
      key,
      request,
      async (tx) => {
        const store = await this.locked(tx, scope);
        await tx.$executeRawUnsafe('SAVEPOINT bulk_item');
        let result: BulkTaskResult;
        try {
          result = await work(store);
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT bulk_item');
        } catch (error) {
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT bulk_item');
          const status =
            error instanceof HttpException
              ? error.getStatus()
              : error instanceof TaskRuleError
                ? ['HIERARCHY', 'POSITION'].includes(error.code)
                  ? 400
                  : 409
                : persistenceStatus(error);
          if (!status || ![400, 404, 409].includes(status)) throw error;
          const code =
            status === 404
              ? 'NOT_FOUND'
              : status === 409
                ? 'CONFLICT'
                : 'BAD_REQUEST';
          result = {
            index: request.index,
            status: 'REJECTED',
            error: {
              code,
              message:
                status === 404
                  ? 'Resource not found'
                  : status === 409
                    ? 'Resource conflict'
                    : 'Invalid request',
            },
          };
        }
        return { resultId: randomUUID(), statusCode: 200, result };
      },
    );
    return BulkTaskResultSchema.parse(receipt.result);
  }
  async createTaskOnce(
    scope: AuthorizedSpace,
    input: TaskCreate,
    key: string | undefined,
    work: (tx: TaskTransaction) => Promise<TaskRecord>,
  ): Promise<TaskRecord> {
    if (key === undefined) return this.transaction(scope, work);
    const receipt = await idempotent(
      this.database.client,
      scope,
      'post.tasks.create',
      key,
      input,
      async (tx) => ({
        resultId: (await work(await this.locked(tx, scope))).id,
        statusCode: 201,
      }),
    );
    return this.read(scope).task(receipt.resultId);
  }
}
