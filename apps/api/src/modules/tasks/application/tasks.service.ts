import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  TaskSchema,
  ChecklistSchema,
  LabelSchema,
  TaskChangeSchema,
  TaskAttachmentSchema,
  TaskPageSchema,
  ChecklistPageSchema,
  LabelPageSchema,
  TaskChangePageSchema,
  TaskAttachmentPageSchema,
} from '@mehran/api-contracts';
import type {
  TaskCreate,
  TaskPatch,
  TaskListQuery,
  TaskSubtaskQuery,
  TaskCursorQuery,
  ChecklistCreate,
  ChecklistPatch,
} from '@mehran/api-contracts';
import { TASKS_REPOSITORY } from './tasks.port.js';
import type { TasksPort, TaskTransaction } from './tasks.port.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { AuditService } from '../../../platform/audit/audit.service.js';
import {
  TaskRuleError,
  TASK_RESTORE_MS,
  normalizeTitle,
  validateHierarchy,
  transition,
  requireRestorable,
  changedFields,
  history,
} from '../domain/tasks.js';
import type {
  TaskRecord,
  TaskNode,
  TaskWrite,
  ChangeKind,
  TaskField,
  ChecklistRecord,
  LabelRecord,
} from '../domain/tasks.js';

const iso = (date: Date | null) => date?.toISOString() ?? null;
function taskView(task: TaskRecord) {
  return TaskSchema.parse({
    id: task.id,
    spaceId: task.spaceId,
    createdByUserId: task.createdByUserId,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    parentTaskId: task.parentTaskId,
    plannedStartAt: iso(task.plannedStartAt),
    dueAt: iso(task.dueAt),
    scheduledDate: task.scheduledDate,
    completedAt: iso(task.completedAt),
    createdAt: iso(task.createdAt),
    updatedAt: iso(task.updatedAt),
    revision: task.revision,
    deletedAt: iso(task.deletedAt),
    restoreUntil: task.deletedAt
      ? new Date(task.deletedAt.getTime() + TASK_RESTORE_MS).toISOString()
      : null,
  });
}
const labelView = (label: LabelRecord) =>
  LabelSchema.parse({
    id: label.id,
    name: label.name,
    revision: label.revision,
    createdAt: iso(label.createdAt),
    updatedAt: iso(label.updatedAt),
  });
const checklistView = (item: ChecklistRecord) =>
  ChecklistSchema.parse({
    id: item.id,
    taskId: item.taskId,
    title: item.title,
    completed: item.completed,
    position: item.position,
    createdAt: iso(item.createdAt),
    updatedAt: iso(item.updatedAt),
  });
const revision = (value: { revision: number }, expected: number) => {
  if (value.revision !== expected) throw new ConflictException();
};

@Injectable()
export class TasksService {
  constructor(
    @Inject(TASKS_REPOSITORY) private readonly repository: TasksPort,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}
  private async operation<T>(
    scope: AuthorizedSpace,
    id: string | undefined,
    work: () => Promise<T>,
  ): Promise<T> {
    try {
      return await work();
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
      if (error instanceof TaskRuleError) {
        if (error.code === 'HIERARCHY' || error.code === 'POSITION')
          throw new BadRequestException();
        throw new ConflictException();
      }
      throw error;
    }
  }
  private async existing(
    tx: TaskTransaction,
    id: string,
    expected: number,
    includeDeleted = false,
  ) {
    const task = await tx.task(id, includeDeleted);
    revision(task, expected);
    return task;
  }
  private async changed(
    tx: TaskTransaction,
    before: TaskRecord,
    patch: TaskWrite,
    kind: ChangeKind,
    fields: TaskField[],
    relatedId: string | null = null,
  ) {
    const after = await tx.updateTask(before, patch);
    await tx.record([history(before, after, kind, fields, relatedId)]);
    await tx.events(
      kind === 'COMPLETED'
        ? 'task.completed'
        : kind === 'REOPENED'
          ? 'task.reopened'
          : 'task.updated',
      [after.id],
    );
    return after;
  }
  create(scope: AuthorizedSpace, input: TaskCreate, key?: string) {
    return this.operation(scope, input.parentTaskId ?? undefined, async () => {
      const normalized: TaskCreate = {
        ...input,
        title: normalizeTitle(input.title),
        status: input.status ?? 'OPEN',
        priority: input.priority ?? 'NONE',
        parentTaskId: input.parentTaskId ?? null,
        description: input.description ?? null,
        plannedStartAt: input.plannedStartAt
          ? new Date(input.plannedStartAt).toISOString()
          : null,
        dueAt: input.dueAt ? new Date(input.dueAt).toISOString() : null,
        scheduledDate: input.scheduledDate ?? null,
      };
      const created = await this.repository.createTaskOnce(
        scope,
        normalized,
        key,
        async (tx) => {
          const id = randomUUID();
          let chain: TaskNode[] = [];
          if (normalized.parentTaskId) {
            await tx.task(normalized.parentTaskId);
            chain = await tx.ancestors(normalized.parentTaskId);
          }
          validateHierarchy(id, chain, []);
          const task = await tx.insertTask({ ...normalized, id });
          await tx.record([
            history(null, task, 'CREATED', [
              'title',
              'status',
              'priority',
              ...(task.description ? ['description' as const] : []),
              ...(task.parentTaskId ? ['parentTaskId' as const] : []),
              ...(task.plannedStartAt ? ['plannedStartAt' as const] : []),
              ...(task.dueAt ? ['dueAt' as const] : []),
              ...(task.scheduledDate ? ['scheduledDate' as const] : []),
            ]),
          ]);
          await tx.events('task.created', [task.id]);
          return task;
        },
      );
      return taskView(created);
    });
  }
  get(scope: AuthorizedSpace, id: string, includeDeleted = false) {
    return this.operation(scope, id, async () => {
      const task = await this.repository.read(scope).task(id, includeDeleted);
      if (
        task.deletedAt &&
        Date.now() - task.deletedAt.getTime() >= TASK_RESTORE_MS
      )
        throw new NotFoundException();
      return taskView(task);
    });
  }
  list(scope: AuthorizedSpace, query: TaskListQuery) {
    return this.operation(scope, query.parentTaskId, async () => {
      const page = await this.repository.read(scope).tasks(query);
      return TaskPageSchema.parse({ ...page, items: page.items.map(taskView) });
    });
  }
  subtasks(scope: AuthorizedSpace, id: string, query: TaskSubtaskQuery) {
    return this.operation(scope, id, async () => {
      const page = await this.repository.read(scope).subtasks(id, query);
      return TaskPageSchema.parse({ ...page, items: page.items.map(taskView) });
    });
  }
  patch(
    scope: AuthorizedSpace,
    id: string,
    expected: number,
    input: TaskPatch,
  ) {
    return this.operation(scope, id, () =>
      this.repository.transaction(scope, async (tx) => {
        const before = await this.existing(tx, id, expected);
        const patch: TaskWrite = {};
        if (input.title !== undefined)
          patch.title = normalizeTitle(input.title);
        if (input.description !== undefined)
          patch.description = input.description;
        if (input.status !== undefined) {
          if (before.status === 'DONE') throw new TaskRuleError('STATE');
          patch.status = input.status;
        }
        if (input.priority !== undefined) patch.priority = input.priority;
        if (
          input.parentTaskId !== undefined &&
          input.parentTaskId !== before.parentTaskId
        ) {
          const chain = input.parentTaskId
            ? (await tx.task(input.parentTaskId),
              await tx.ancestors(input.parentTaskId))
            : [];
          validateHierarchy(id, chain, await tx.subtree(id));
          patch.parentTaskId = input.parentTaskId;
        }
        if (input.plannedStartAt !== undefined)
          patch.plannedStartAt = input.plannedStartAt
            ? new Date(input.plannedStartAt)
            : null;
        if (input.dueAt !== undefined)
          patch.dueAt = input.dueAt ? new Date(input.dueAt) : null;
        if (input.scheduledDate !== undefined)
          patch.scheduledDate = input.scheduledDate;
        const fields = changedFields(before, patch);
        if (!fields.length) return taskView(before);
        const after = await this.changed(tx, before, patch, 'UPDATED', fields);
        if (fields.includes('dueAt')) await tx.events('task.due_changed', [id]);
        return taskView(after);
      }),
    );
  }
  changeStatus(
    scope: AuthorizedSpace,
    id: string,
    expected: number,
    action: 'complete' | 'reopen',
  ) {
    return this.operation(scope, id, () =>
      this.repository.transaction(scope, async (tx) => {
        const before = await this.existing(tx, id, expected),
          patch = transition(before, action, new Date());
        const fields = changedFields(before, patch);
        return taskView(
          fields.length
            ? await this.changed(
                tx,
                before,
                patch,
                action === 'complete' ? 'COMPLETED' : 'REOPENED',
                fields,
              )
            : before,
        );
      }),
    );
  }
  delete(scope: AuthorizedSpace, id: string, expected: number) {
    return this.operation(scope, id, () =>
      this.repository.transaction(scope, async (tx) => {
        const root = await this.existing(tx, id, expected, true);
        if (root.deletedAt) return taskView(root);
        const before = (await tx.subtree(id)).filter((task) => !task.deletedAt),
          patch = { deletedAt: new Date(), deletionBatchId: randomUUID() };
        const after = await tx.updateTasks(before, patch);
        const old = new Map(before.map((task) => [task.id, task]));
        await tx.record(
          after.map((task) =>
            history(old.get(task.id)!, task, 'DELETED', ['deletedAt']),
          ),
        );
        await tx.events(
          'task.deleted',
          after.map((task) => task.id),
        );
        return taskView({ ...root, ...after.find((task) => task.id === id)! });
      }),
    );
  }
  restore(scope: AuthorizedSpace, id: string, expected: number) {
    return this.operation(scope, id, () =>
      this.repository.transaction(scope, async (tx) => {
        const root = await this.existing(tx, id, expected, true);
        if (!root.deletedAt) return taskView(root);
        requireRestorable(root, new Date());
        const before = (await tx.subtree(id)).filter(
          (task) =>
            task.deletedAt && task.deletionBatchId === root.deletionBatchId,
        );
        const after = await tx.updateTasks(before, {
          deletedAt: null,
          deletionBatchId: null,
        });
        const old = new Map(before.map((task) => [task.id, task]));
        await tx.record(
          after.map((task) =>
            history(old.get(task.id)!, task, 'RESTORED', ['deletedAt']),
          ),
        );
        await tx.events(
          'task.updated',
          after.map((task) => task.id),
        );
        return taskView({ ...root, ...after.find((task) => task.id === id)! });
      }),
    );
  }
  checklist(scope: AuthorizedSpace, id: string, query: TaskCursorQuery) {
    return this.operation(scope, id, async () => {
      const page = await this.repository.read(scope).checklist(id, query);
      return ChecklistPageSchema.parse({
        ...page,
        items: page.items.map(checklistView),
      });
    });
  }
  addChecklist(
    scope: AuthorizedSpace,
    id: string,
    expected: number,
    input: ChecklistCreate,
  ) {
    return this.operation(scope, id, () =>
      this.repository.transaction(scope, async (tx) => {
        const before = await this.existing(tx, id, expected),
          item = await tx.insertChecklist(id, {
            ...input,
            title: normalizeTitle(input.title),
          });
        const task = await this.changed(
          tx,
          before,
          {},
          'CHECKLIST_CREATED',
          ['checklistItems'],
          item.id,
        );
        return { task: taskView(task), item: checklistView(item) };
      }),
    );
  }
  patchChecklist(
    scope: AuthorizedSpace,
    id: string,
    itemId: string,
    expected: number,
    input: ChecklistPatch,
  ) {
    return this.operation(scope, id, () =>
      this.repository.transaction(scope, async (tx) => {
        const before = await this.existing(tx, id, expected),
          item = await tx.checklistItem(id, itemId),
          patch = {
            ...input,
            ...(input.title !== undefined
              ? { title: normalizeTitle(input.title) }
              : {}),
          };
        if (
          Object.entries(patch).every(
            ([key, value]) => item[key as keyof ChecklistRecord] === value,
          )
        )
          return { task: taskView(before), item: checklistView(item) };
        const changed = await tx.updateChecklist(id, itemId, patch);
        const task = await this.changed(
          tx,
          before,
          {},
          'CHECKLIST_UPDATED',
          ['checklistItems'],
          itemId,
        );
        return { task: taskView(task), item: checklistView(changed) };
      }),
    );
  }
  deleteChecklist(
    scope: AuthorizedSpace,
    id: string,
    itemId: string,
    expected: number,
  ) {
    return this.operation(scope, id, () =>
      this.repository.transaction(scope, async (tx) => {
        const before = await this.existing(tx, id, expected);
        await tx.checklistItem(id, itemId);
        await tx.deleteChecklist(id, itemId);
        return taskView(
          await this.changed(
            tx,
            before,
            {},
            'CHECKLIST_DELETED',
            ['checklistItems'],
            itemId,
          ),
        );
      }),
    );
  }
  label(scope: AuthorizedSpace, id: string) {
    return this.operation(scope, id, async () =>
      labelView(await this.repository.read(scope).label(id)),
    );
  }
  labels(scope: AuthorizedSpace, query: TaskCursorQuery, taskId?: string) {
    return this.operation(scope, taskId, async () => {
      const page = await this.repository.read(scope).labels(query, taskId);
      return LabelPageSchema.parse({
        ...page,
        items: page.items.map(labelView),
      });
    });
  }
  createLabel(scope: AuthorizedSpace, name: string) {
    return this.operation(scope, undefined, () =>
      this.repository.transaction(scope, async (tx) =>
        labelView(await tx.insertLabel(normalizeTitle(name))),
      ),
    );
  }
  patchLabel(
    scope: AuthorizedSpace,
    id: string,
    expected: number,
    name: string,
  ) {
    return this.operation(scope, id, () =>
      this.repository.transaction(scope, async (tx) => {
        const before = await tx.label(id);
        revision(before, expected);
        const normalized = normalizeTitle(name);
        return labelView(
          before.name === normalized
            ? before
            : await tx.updateLabel(before, normalized),
        );
      }),
    );
  }
  deleteLabel(scope: AuthorizedSpace, id: string, expected: number) {
    return this.operation(scope, id, () =>
      this.repository.transaction(scope, async (tx) => {
        const label = await tx.label(id);
        revision(label, expected);
        const before = await tx.tasksForLabel(id);
        await tx.deleteLabel(id);
        const after = await tx.updateTasks(before, {});
        const old = new Map(before.map((task) => [task.id, task]));
        await tx.record(
          after.map((task) =>
            history(old.get(task.id)!, task, 'LABEL_REMOVED', ['labels'], id),
          ),
        );
        await tx.events(
          'task.updated',
          after.map((task) => task.id),
        );
      }),
    );
  }
  setLabel(
    scope: AuthorizedSpace,
    id: string,
    labelId: string,
    expected: number,
    present: boolean,
  ) {
    return this.operation(scope, id, () =>
      this.repository.transaction(scope, async (tx) => {
        const before = await this.existing(tx, id, expected);
        await tx.label(labelId);
        return taskView(
          (await tx.setLabel(id, labelId, present))
            ? await this.changed(
                tx,
                before,
                {},
                present ? 'LABEL_ADDED' : 'LABEL_REMOVED',
                ['labels'],
                labelId,
              )
            : before,
        );
      }),
    );
  }
  setAttachment(
    scope: AuthorizedSpace,
    id: string,
    fileId: string,
    expected: number,
    present: boolean,
  ) {
    return this.operation(scope, id, () =>
      this.repository.transaction(scope, async (tx) => {
        const before = await this.existing(tx, id, expected);
        return taskView(
          (await tx.setAttachment(id, fileId, present))
            ? await this.changed(
                tx,
                before,
                {},
                present ? 'ATTACHMENT_BOUND' : 'ATTACHMENT_UNBOUND',
                ['attachments'],
                fileId,
              )
            : before,
        );
      }),
    );
  }
  attachments(scope: AuthorizedSpace, id: string, query: TaskCursorQuery) {
    return this.operation(scope, id, async () => {
      const page = await this.repository.read(scope).attachments(id, query);
      return TaskAttachmentPageSchema.parse({
        ...page,
        items: page.items.map((item) =>
          TaskAttachmentSchema.parse({
            fileId: item.fileId,
            filename: item.filename,
            mimeType: item.mimeType,
            status: item.status,
            size: item.size,
            attachedAt: iso(item.attachedAt),
          }),
        ),
      });
    });
  }
  history(scope: AuthorizedSpace, id: string, query: TaskCursorQuery) {
    return this.operation(scope, id, async () => {
      const reader = this.repository.read(scope),
        task = await reader.task(id, true);
      if (
        task.deletedAt &&
        Date.now() - task.deletedAt.getTime() >= TASK_RESTORE_MS
      )
        throw new NotFoundException();
      const page = await reader.history(id, query);
      return TaskChangePageSchema.parse({
        ...page,
        items: page.items.map((change) =>
          TaskChangeSchema.parse({
            ...change,
            createdAt: iso(change.createdAt),
          }),
        ),
      });
    });
  }
}
