import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import {
  sharedDeleteBatch,
  sharedVersionedDelete,
} from '../../../platform/lifecycle/shared-cleanup.js';
import type { SharedCleanupScope } from '../../../platform/lifecycle/shared-cleanup.js';
import { SharedTasksCleanup } from '../public/shared-cleanup.js';
@Injectable()
export class SharedTasksCleanupRepository extends SharedTasksCleanup {
  async batch(tx: Prisma.TransactionClient, s: SharedCleanupScope) {
    s.verify(tx);
    if (
      !(await sharedDeleteBatch(tx, s, [
        'SharedTaskWorkLog',
        'TaskWorkflowApproval',
        'TaskWorkflowBinding',
        'TaskWorkflowApprover',
        'TaskWorkflowEdge',
        'TaskWorkflowState',
      ]))
    )
      return false;
    if (
      !(await sharedVersionedDelete(
        tx,
        s,
        'TaskWorkflow',
        'TaskWorkflowVersion',
        'workflowId',
      ))
    )
      return false;
    if (
      !(await sharedDeleteBatch(tx, s, [
        'TaskRescheduleItem',
        'TaskReschedulePreview',
        'TaskDependency',
        'TaskDependencyGraph',
        'TaskFieldValue',
        'TaskFieldSelection',
        'TaskFieldOption',
        'TaskMetadataEvent',
      ]))
    )
      return false;
    if (
      !(await sharedVersionedDelete(
        tx,
        s,
        'TaskField',
        'TaskFieldVersion',
        'fieldId',
      ))
    )
      return false;
    if (
      !(await sharedDeleteBatch(
        tx,
        s,
        ['TaskAttachment', 'TaskLabel', 'TaskChange', 'TaskChecklistItem'],
        {
          TaskAttachment: { table: 'Task', foreignKey: 'taskId' },
          TaskLabel: { table: 'Task', foreignKey: 'taskId' },
          TaskChecklistItem: { table: 'Task', foreignKey: 'taskId' },
        },
      ))
    )
      return false;
    const count =
      await tx.$executeRaw`DELETE FROM "Task" WHERE id IN (SELECT t.id FROM "Task" t WHERE t."spaceId"=${s.spaceId}::uuid AND (${s.scopeId ?? null}::uuid IS NULL OR t."scopeId"=${s.scopeId ?? null}::uuid) AND NOT EXISTS(SELECT 1 FROM "Task" c WHERE c."spaceId"=t."spaceId" AND c."parentTaskId"=t.id) ORDER BY t.id LIMIT 200)`;
    return count === 0;
  }
}
