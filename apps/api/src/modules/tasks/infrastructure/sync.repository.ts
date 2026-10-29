import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { FileCatalog } from '../../../platform/storage/public/index.js';
import {
  AuditService,
  writeAudit,
} from '../../../platform/audit/audit.service.js';
import { TasksSync } from '../public/sync-access.js';
import { PlanningTasks } from '../public/planning-tasks.js';
import { TasksService, taskView } from '../application/tasks.service.js';
import type { TasksPort } from '../application/tasks.port.js';
import { ScopedTasksStore } from './tasks.repository.js';
import * as c from '@mehran/api-contracts';
@Injectable()
export class TasksSyncRepository extends TasksSync {
  readonly entities = ['TASK', 'CHECKLIST', 'LABEL'] as const;
  constructor(
    @Inject(FileCatalog) private readonly files: FileCatalog,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PlanningTasks) private readonly locks: PlanningTasks,
  ) {
    super();
  }
  async command(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    op: c.SyncCommand,
  ): Promise<c.SyncResource> {
    await this.locks.lock(tx, scope);
    const store = new ScopedTasksStore(tx, scope, this.files);
    // Reuse owner use cases in this explicit caller-owned transaction. The outer
    // durable SyncMutationReceipt supplies idempotency; no nested transactions.
    const port: TasksPort = {
      read: () => store,
      transaction: async (_s, w) => w(store),
      createTaskOnce: async (_s, _i, _k, w) => w(store),
      templateTaskOnce: async (_s, _k, _r, w) => w(store),
      bulkItemOnce: async (_s, _k, _r, w) => w(store),
    };
    const service = new TasksService(port, {
        record: (input) => writeAudit(tx, input),
      }),
      id = op.resourceId,
      parent = op.parentId;
    const requireId = (v: string | undefined) => {
      if (!v) throw new BadRequestException();
      return v;
    };
    if (
      op.operation.startsWith('TASK_') &&
      op.operation !== 'TASK_CREATE' &&
      (await store.task(requireId(id), true)).isRecurrenceMaster
    )
      throw new ConflictException({ code: 'ONLINE_ONLY' });
    let resource = id,
      entity: c.SyncEntity = 'TASK';
    switch (op.operation) {
      case 'TASK_CREATE':
        if (op.baseRevision !== 0) throw new ConflictException();
        resource = (await service.create(scope, op.body)).id;
        break;
      case 'TASK_PATCH':
        await service.patch(scope, requireId(id), op.baseRevision, op.body);
        break;
      case 'TASK_COMPLETE':
        await service.changeStatus(
          scope,
          requireId(id),
          op.baseRevision,
          'complete',
        );
        break;
      case 'TASK_REOPEN':
        await service.changeStatus(
          scope,
          requireId(id),
          op.baseRevision,
          'reopen',
        );
        break;
      case 'TASK_DELETE':
        await service.delete(scope, requireId(id), op.baseRevision);
        break;
      case 'TASK_RESTORE':
        await service.restore(scope, requireId(id), op.baseRevision);
        break;
      case 'TASK_LABEL_SET':
        await service.setLabel(
          scope,
          requireId(id),
          op.body.labelId,
          op.baseRevision,
          op.body.present,
        );
        break;
      case 'CHECKLIST_CREATE':
        entity = 'CHECKLIST';
        resource = (
          await service.addChecklist(
            scope,
            requireId(parent),
            op.baseRevision,
            op.body,
          )
        ).item.id;
        break;
      case 'CHECKLIST_PATCH':
        entity = 'CHECKLIST';
        await service.patchChecklist(
          scope,
          requireId(parent),
          requireId(id),
          op.baseRevision,
          op.body,
        );
        break;
      case 'CHECKLIST_DELETE':
        entity = 'CHECKLIST';
        await service.deleteChecklist(
          scope,
          requireId(parent),
          requireId(id),
          op.baseRevision,
        );
        break;
      case 'LABEL_CREATE':
        entity = 'LABEL';
        if (op.baseRevision !== 0) throw new ConflictException();
        resource = (await service.createLabel(scope, op.body.name)).id;
        break;
      case 'LABEL_PATCH':
        entity = 'LABEL';
        await service.patchLabel(
          scope,
          requireId(id),
          op.baseRevision,
          op.body.name,
        );
        break;
      case 'LABEL_DELETE':
        entity = 'LABEL';
        await service.deleteLabel(scope, requireId(id), op.baseRevision);
        break;
      default:
        throw new BadRequestException({ code: 'ONLINE_ONLY' });
    }
    return (
      (await this.read(tx, scope, entity, requireId(resource))) ??
      c.SyncResourceSchema.parse({
        entity,
        id: resource,
        revision: op.baseRevision + 1,
        deleted: true,
        data: null,
      })
    );
  }
  async read(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    entity: c.SyncEntity,
    id: string,
  ): Promise<c.SyncResource | null> {
    const store = new ScopedTasksStore(tx, scope, this.files);
    if (entity === 'TASK') {
      const row = await tx.task.findFirst({
        where: { spaceId: scope.spaceId, id },
        select: {
          id: true,
          revision: true,
          deletedAt: true,
          masterRecurrence: { select: { id: true } },
          occurrence: { select: { state: true } },
        },
      });
      if (!row) return null;
      const deleted =
        !!row.deletedAt ||
        !!row.masterRecurrence ||
        ['SKIPPED', 'CANCELED'].includes(row.occurrence?.state ?? '');
      const labels = deleted
        ? []
        : await tx.taskLabel.findMany({
            where: { spaceId: scope.spaceId, taskId: id },
            select: { labelId: true },
            take: 10001,
          });
      if (labels.length > 10000) throw new BadRequestException();
      return c.SyncResourceSchema.parse({
        entity,
        id,
        revision: row.revision,
        deleted,
        data: deleted
          ? null
          : {
              ...taskView(await store.task(id, true)),
              labelIds: labels.map((l) => l.labelId),
            },
      });
    }
    if (entity === 'LABEL') {
      const row = await tx.label.findFirst({
        where: { spaceId: scope.spaceId, id },
      });
      return row
        ? c.SyncResourceSchema.parse({
            entity,
            id,
            revision: row.revision,
            deleted: false,
            data: {
              id,
              name: row.name,
              revision: row.revision,
              createdAt: row.createdAt.toISOString(),
              updatedAt: row.updatedAt.toISOString(),
            },
          })
        : null;
    }
    if (entity === 'CHECKLIST') {
      const row = await tx.taskChecklistItem.findFirst({
        where: { spaceId: scope.spaceId, id },
        include: { task: { select: { revision: true } } },
      });
      return row
        ? c.SyncResourceSchema.parse({
            entity,
            id,
            revision: row.task.revision,
            deleted: false,
            data: {
              id,
              taskId: row.taskId,
              title: row.title,
              completed: row.completed,
              position: row.position,
              createdAt: row.createdAt.toISOString(),
              updatedAt: row.updatedAt.toISOString(),
            },
          })
        : null;
    }
    throw new BadRequestException();
  }
  async list(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    entity: c.SyncEntity,
    after: string | undefined,
    limit: number,
  ) {
    const args = {
      where: {
        spaceId: scope.spaceId,
        ...(after ? { id: { gt: after } } : {}),
      },
      select: { id: true },
      orderBy: { id: 'asc' as const },
      take: limit,
    };
    const rows =
      entity === 'TASK'
        ? await tx.task.findMany(args)
        : entity === 'LABEL'
          ? await tx.label.findMany(args)
          : entity === 'CHECKLIST'
            ? await tx.taskChecklistItem.findMany(args)
            : [];
    const values: c.SyncResource[] = [];
    for (const row of rows) {
      const value = await this.read(tx, scope, entity, row.id);
      if (value) values.push(value);
    }
    return values;
  }
}
