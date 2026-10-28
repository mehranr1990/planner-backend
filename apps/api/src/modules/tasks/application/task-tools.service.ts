import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  BulkTaskItemSchema,
  BulkTaskResponseSchema,
  normalizeSavedTaskQuery,
  TaskTemplateValuesSchema,
} from '@mehran/api-contracts';
import type {
  TaskTemplateCreate,
  TaskTemplatePatch,
  TaskTemplateApply,
  SavedTaskFilterCreate,
  SavedTaskFilterPatch,
  TaskCursorQuery,
  BulkTaskRequest,
  BulkTaskResult,
} from '@mehran/api-contracts';
import { TASKS_REPOSITORY } from './tasks.port.js';
import type { TasksPort, TaskTransaction } from './tasks.port.js';
import { TasksService, taskView } from './tasks.service.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { AuditService } from '../../../platform/audit/audit.service.js';
import { normalizeTitle, history } from '../domain/tasks.js';

@Injectable()
export class TaskToolsService {
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
  template(scope: AuthorizedSpace, id: string) {
    return this.run(scope, id, (tx) => tx.template(id));
  }
  templates(scope: AuthorizedSpace, query: TaskCursorQuery) {
    return this.run(scope, undefined, (tx) => tx.templates(query));
  }
  private values(input: TaskTemplateCreate['values']) {
    return TaskTemplateValuesSchema.parse({
      ...input,
      task: { ...input.task, title: normalizeTitle(input.task.title) },
      checklist: input.checklist.map((item) => ({
        title: normalizeTitle(item.title),
      })),
    });
  }
  createTemplate(scope: AuthorizedSpace, input: TaskTemplateCreate) {
    return this.run(scope, undefined, (tx) =>
      tx.insertTemplate({
        ...input,
        name: normalizeTitle(input.name),
        values: this.values(input.values),
      }),
    );
  }
  patchTemplate(
    scope: AuthorizedSpace,
    id: string,
    revision: number,
    input: TaskTemplatePatch,
  ) {
    return this.run(scope, id, (tx) =>
      tx.updateTemplate(id, revision, {
        ...input,
        ...(input.name ? { name: normalizeTitle(input.name) } : {}),
        ...(input.values ? { values: this.values(input.values) } : {}),
      }),
    );
  }
  deleteTemplate(scope: AuthorizedSpace, id: string, revision: number) {
    return this.run(scope, id, (tx) => tx.deleteTemplate(id, revision));
  }
  async applyTemplate(
    scope: AuthorizedSpace,
    id: string,
    input: TaskTemplateApply,
    key: string | undefined,
  ) {
    this.requireKey(key);
    // Authorization and template revision are revalidated inside the atomic receipt transaction.
    const task = await this.repository
      .templateTaskOnce(scope, key!, { id, ...input }, async (tx) => {
        const template = await tx.template(id);
        if (template.revision !== input.revision) throw new ConflictException();
        const created = await this.tasks.create(
          scope,
          {
            ...template.values.task,
            ...input.overrides,
            title: input.overrides?.title ?? template.values.task.title,
          },
          undefined,
          tx,
        );
        for (const [position, item] of template.values.checklist.entries())
          await tx.insertChecklist(created.id, { title: item.title, position });
        if (template.values.checklist.length) {
          const before = await tx.task(created.id),
            after = await tx.updateTask(before, {});
          await tx.record([
            history(before, after, 'CHECKLIST_CREATED', ['checklistItems']),
          ]);
          await tx.events('task.updated', [after.id]);
          return after;
        }
        return tx.task(created.id);
      })
      .catch(async (error: unknown) => {
        if (error instanceof NotFoundException)
          await this.audit.record({
            action: 'ACCESS_DENIED',
            outcome: 'DENIED',
            resourceId: id,
            actorUserId: scope.actor.userId,
            requestId: scope.actor.requestId,
            correlationId: scope.actor.correlationId,
          });
        throw error;
      });
    return taskView(task);
  }
  filter(scope: AuthorizedSpace, id: string) {
    return this.run(scope, id, (tx) => tx.savedFilter(id));
  }
  filters(scope: AuthorizedSpace, query: TaskCursorQuery) {
    return this.run(scope, undefined, (tx) => tx.savedFilters(query));
  }
  private async validateFilter(
    tx: TaskTransaction,
    query: SavedTaskFilterCreate['query'],
  ) {
    if (query.where.labelId) await tx.label(query.where.labelId);
    if (query.where.parentTaskId)
      await tx.task(query.where.parentTaskId, query.where.deleted === 'true');
  }
  createFilter(scope: AuthorizedSpace, input: SavedTaskFilterCreate) {
    return this.run(scope, undefined, async (tx) => {
      const query = normalizeSavedTaskQuery(input.query);
      await this.validateFilter(tx, query);
      return tx.insertSavedFilter({ name: normalizeTitle(input.name), query });
    });
  }
  patchFilter(
    scope: AuthorizedSpace,
    id: string,
    revision: number,
    input: SavedTaskFilterPatch,
  ) {
    return this.run(scope, id, async (tx) => {
      await tx.savedFilter(id);
      const query = input.query
        ? normalizeSavedTaskQuery(input.query)
        : undefined;
      if (query) await this.validateFilter(tx, query);
      return tx.updateSavedFilter(id, revision, {
        ...(input.name ? { name: normalizeTitle(input.name) } : {}),
        ...(query ? { query } : {}),
      });
    });
  }
  deleteFilter(scope: AuthorizedSpace, id: string, revision: number) {
    return this.run(scope, id, (tx) => tx.deleteSavedFilter(id, revision));
  }
  filterTasks(scope: AuthorizedSpace, id: string, pagination: TaskCursorQuery) {
    return this.run(scope, id, async (tx) => {
      const filter = await tx.savedFilter(id);
      await this.validateFilter(tx, filter.query);
      const page = await tx.tasks({ ...filter.query.where, ...pagination });
      return { ...page, items: page.items.map(taskView) };
    });
  }
  private requireKey(key: string | undefined) {
    if (!key || !/^[\x21-\x7e]{1,128}$/.test(key))
      throw new BadRequestException();
  }
  async bulk(
    scope: AuthorizedSpace,
    input: BulkTaskRequest,
    key: string | undefined,
  ) {
    this.requireKey(key);
    const items: BulkTaskResult[] = [];
    const digest = createHash('sha256').update(key!).digest('hex');
    for (const [index, value] of input.items.entries()) {
      items.push(
        await this.repository.bulkItemOnce(
          scope,
          `${digest}:${index}`,
          { index, batch: input },
          async (tx) => {
            const parsed = BulkTaskItemSchema.safeParse(value);
            if (!parsed.success) throw new BadRequestException();
            const item = parsed.data;
            let task;
            switch (item.action) {
              case 'PATCH':
                task = await this.tasks.patch(
                  scope,
                  item.id,
                  item.revision,
                  item.patch,
                  tx,
                );
                break;
              case 'COMPLETE':
              case 'REOPEN':
                task = await this.tasks.changeStatus(
                  scope,
                  item.id,
                  item.revision,
                  item.action === 'COMPLETE' ? 'complete' : 'reopen',
                  tx,
                );
                break;
              case 'DELETE':
                task = await this.tasks.delete(
                  scope,
                  item.id,
                  item.revision,
                  tx,
                );
                break;
              case 'RESTORE':
                task = await this.tasks.restore(
                  scope,
                  item.id,
                  item.revision,
                  tx,
                );
                break;
              case 'ADD_LABEL':
              case 'REMOVE_LABEL':
                task = await this.tasks.setLabel(
                  scope,
                  item.id,
                  item.labelId,
                  item.revision,
                  item.action === 'ADD_LABEL',
                  tx,
                );
                break;
            }
            return { index, status: 'APPLIED', task };
          },
        ),
      );
    }
    const succeeded = items.filter((item) => item.status === 'APPLIED').length;
    return BulkTaskResponseSchema.parse({
      items,
      succeeded,
      failed: items.length - succeeded,
    });
  }
}
