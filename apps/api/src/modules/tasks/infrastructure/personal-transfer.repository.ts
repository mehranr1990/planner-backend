import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type * as c from '@mehran/api-contracts';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import type { SharedAuthority } from '../../spaces/public/index.js';
import { appendSyncChanges } from '../../../platform/sync/change-feed.js';
import { appendOutbox } from '../../../platform/outbox/outbox.js';
import { transferCatalog } from '../../../platform/database/transfer-catalog.js';
import { PersonalTaskTransfer } from '../public/personal-transfer.js';
const known = [
  'TeamWorkItem_sourceSpaceId_taskId_fkey',
  'CaptureItem_spaceId_targetTaskId_fkey',
  'DailyPlanItem_spaceId_taskId_fkey',
  'FocusSession_spaceId_taskId_fkey',
  'GoalTaskLink_spaceId_taskId_fkey',
  'Note_spaceId_taskId_fkey',
  'ProjectTask_spaceId_scopeId_taskId_fkey',
  'Reminder_spaceId_taskId_fkey',
  'ResourceGrantOffer_spaceId_scopeId_taskId_fkey',
  'SharedTaskWorkLog_spaceId_scopeId_taskId_fkey',
  'TaskAttachment_spaceId_taskId_fkey',
  'TaskChange_scope_fk',
  'TaskChange_spaceId_taskId_fkey',
  'TaskChecklistItem_spaceId_taskId_fkey',
  'TaskDependency_spaceId_scopeId_predecessorId_fkey',
  'TaskDependency_spaceId_scopeId_successorId_fkey',
  'TaskFieldValue_spaceId_scopeId_taskId_fkey',
  'TaskGrant_spaceId_scopeId_taskId_fkey',
  'TaskLabel_spaceId_taskId_fkey',
  'TaskMetadataEvent_spaceId_scopeId_taskId_fkey',
  'TaskOccurrence_spaceId_taskId_fkey',
  'TaskRecurrence_spaceId_masterTaskId_fkey',
  'TaskRescheduleItem_spaceId_scopeId_taskId_fkey',
  'TaskWorkflowApproval_spaceId_scopeId_taskId_fkey',
  'TaskWorkflowBinding_spaceId_scopeId_taskId_fkey',
  'Task_parent_scope_fk',
  'Task_spaceId_parentTaskId_fkey',
  'TimeBlockSharedTaskLink_spaceId_scopeId_taskId_fkey',
  'TimeBlock_spaceId_taskId_fkey',
  'TimeEntry_spaceId_taskId_fkey',
];
@Injectable()
export class PersonalTaskTransferRepository extends PersonalTaskTransfer {
  async preview(
    tx: Prisma.TransactionClient,
    source: AuthorizedSpace,
    selected: z.infer<typeof c.ProjectTransferSelectionSchema>[],
    consent: z.infer<typeof c.ProjectTransferConsentSchema>,
  ) {
    await source.fence(tx);
    const catalog = await transferCatalog(tx, 'Task', known),
      result: z.infer<typeof c.ProjectTransferCandidateSchema>[] = [];
    for (const item of [...selected].sort((a, b) => a.id.localeCompare(b.id))) {
      const row = await tx.task.findFirst({
        where: {
          id: item.id,
          spaceId: source.spaceId,
          scopeId: null,
          deletedAt: null,
        },
        include: {
          _count: {
            select: {
              TeamWorkItem: true,
              reminders: true,
              noteReferences: true,
              captureTargets: true,
              focusSessions: true,
              timeEntries: true,
              goalLinks: true,
              subtasks: true,
              checklistItems: true,
              labels: true,
              attachments: true,
              changes: true,
              dailyPlanItems: true,
              timeBlocks: true,
            },
          },
          masterRecurrence: true,
          occurrence: true,
          checklistItems: { orderBy: { id: 'asc' }, take: 1001 },
          changes: { orderBy: { id: 'asc' }, take: 1001 },
        },
      });
      if (!row) throw new NotFoundException();
      if (row.revision !== item.revision)
        throw new ConflictException({ code: 'TRANSFER_SOURCE_CHANGED' });
      const blockers: string[] = [];
      if (!catalog.known) blockers.push('UNKNOWN_INCOMING_FK');
      if (row.parentTaskId || row.masterRecurrence || row.occurrence)
        blockers.push('HIERARCHY_OR_RECURRENCE');
      if (
        row.createdByUserId !== source.actor.userId ||
        row.changes.some((r) => r.actorUserId !== source.actor.userId)
      )
        blockers.push('FOREIGN_ATTRIBUTION');
      for (const [relation, count] of Object.entries(row._count))
        if (
          count > 0 &&
          ![
            'checklistItems',
            'changes',
            'TaskChange_TaskChange_spaceId_scopeId_taskIdToTask',
          ].includes(relation)
        )
          blockers.push('REFERENCE:' + relation);
      if (row._count.changes && !consent.includeTaskHistory)
        blockers.push('HISTORY_CONSENT_REQUIRED');
      if (row._count.changes > 1000 || row._count.checklistItems > 1000)
        blockers.push('GRAPH_LIMIT');
      const privateReferences = Object.entries(row._count)
        .filter(
          ([relation, count]) =>
            count > 0 && !['checklistItems', 'changes'].includes(relation),
        )
        .map(([relation, count]) => ({
          relation,
          count,
          disposition: 'REJECT' as const,
        }));
      if (row.parentTaskId)
        privateReferences.push({
          relation: 'parentTaskId',
          count: 1,
          disposition: 'REJECT',
        });
      if (row.masterRecurrence || row.occurrence)
        privateReferences.push({
          relation: 'recurrence',
          count: 1,
          disposition: 'REJECT',
        });
      const nodes: z.infer<typeof c.ProjectTransferCandidateSchema>['nodes'] = [
        { kind: 'TASK', id: row.id },
        ...row.checklistItems.map((r) => ({
          kind: 'CHECKLIST' as const,
          id: r.id,
        })),
        ...row.changes.map((r) => ({
          kind: 'TASK_HISTORY' as const,
          id: r.id,
        })),
      ];
      result.push({
        kind: 'TASK',
        id: row.id,
        revision: row.revision,
        sourceHash: createHash('sha256')
          .update(JSON.stringify({ row, catalog: catalog.rows }))
          .digest('hex'),
        children: row._count.checklistItems,
        history: row._count.changes,
        nodes: nodes.length > 2001 ? nodes.slice(0, 1) : nodes,
        privateReferences,
        blockers,
      });
    }
    return result;
  }
  async apply(
    tx: Prisma.TransactionClient,
    source: AuthorizedSpace,
    a: SharedAuthority,
    destination: string,
    selected: z.infer<typeof c.ProjectTransferSelectionSchema>[],
    now: Date,
  ) {
    await source.fence(tx);
    const actor = a.require(tx, destination, 'custody.transfer').actorId;
    a.require(tx, destination, 'task.create');
    await tx.$executeRaw`SET CONSTRAINTS "TaskChange_spaceId_taskId_fkey", "TaskChange_scope_fk" DEFERRED`;
    for (const item of [...selected].sort((x, y) => x.id.localeCompare(y.id))) {
      const before = await tx.task.findFirst({
        where: {
          id: item.id,
          spaceId: source.spaceId,
          scopeId: null,
          revision: item.revision,
          deletedAt: null,
        },
        include: { checklistItems: { select: { id: true } } },
      });
      if (!before) throw new ConflictException();
      // Existing ON UPDATE CASCADE preserves checklist/history IDs. The reviewed history
      // trigger allows only this applying manifest's intermediate branch, checked at commit.
      await tx.task.update({
        where: { id: item.id },
        data: {
          spaceId: destination,
          scopeId: destination,
          createdByUserId: null,
          createdByActorId: actor,
          revision: { increment: 1 },
          updatedAt: now,
        },
      });
      await tx.taskChange.updateMany({
        where: { taskId: item.id, spaceId: destination },
        data: { scopeId: destination, actorUserId: null, actorId: actor },
      });
      await tx.taskMetadataEvent.create({
        data: {
          id: randomUUID(),
          spaceId: destination,
          scopeId: destination,
          taskId: item.id,
          actorId: actor,
          action: 'CUSTODY_TRANSFERRED',
          sourceRevision: item.revision + 1,
          afterValue: { custody: 'SHARED_PROJECT' },
        },
      });
      await appendSyncChanges(tx, source, [
        {
          entity: 'TASK',
          resourceId: item.id,
          revision: item.revision + 1,
          deleted: true,
        },
        ...before.checklistItems.map((r) => ({
          entity: 'CHECKLIST' as const,
          resourceId: r.id,
          parentId: item.id,
          revision: item.revision + 1,
          deleted: true,
        })),
      ]);
      await appendOutbox(tx, source, {
        type: 'task.deleted',
        version: 1,
        aggregateId: item.id,
        payload: {},
      });
    }
  }
}
