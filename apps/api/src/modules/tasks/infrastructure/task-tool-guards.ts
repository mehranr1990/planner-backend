import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Prisma, Task } from '../../../generated/prisma/client.js';
import type { SharedAuthority } from '../../spaces/public/index.js';
import { legacyWorkflowEdge } from '../domain/workflows.js';
import type { WorkflowEdge } from '../domain/workflows.js';
import { dependencySatisfied } from '../domain/dependencies.js';
import type { Dependency } from '../domain/dependencies.js';
import { randomUUID } from 'node:crypto';
export async function legacyWorkflowGuard(
  tx: Prisma.TransactionClient,
  a: SharedAuthority,
  before: Task,
  target: Task['status'],
) {
  const binding = await tx.taskWorkflowBinding.findUnique({
    where: { taskId: before.id },
  });
  if (!binding) return;
  a.require(tx, before.spaceId, 'workflow.transition');
  const where = {
    spaceId: binding.spaceId,
    scopeId: binding.scopeId,
    workflowId: binding.workflowId,
    version: binding.version,
  };
  const states = await tx.taskWorkflowState.findMany({ where }),
    edges = await tx.taskWorkflowEdge.findMany({ where });
  let selected: WorkflowEdge | null;
  try {
    selected = legacyWorkflowEdge(
      states,
      edges.map((e) => ({ ...e, approvers: [] })),
      binding.stateId,
      before.status,
      target,
    );
  } catch (error) {
    throw new ConflictException({
      code: error instanceof Error ? error.message : 'WORKFLOW_CONFLICT',
    });
  }
  if (!selected) return;
  const actor = a.require(tx, before.spaceId, 'workflow.transition');
  await tx.taskWorkflowBinding.update({
    where: { taskId: before.id },
    data: { stateId: selected.toStateId, revision: { increment: 1 } },
  });
  await tx.taskMetadataEvent.create({
    data: {
      id: randomUUID(),
      spaceId: binding.spaceId,
      scopeId: binding.scopeId,
      taskId: before.id,
      actorId: actor.actorId,
      action: 'WORKFLOW_TRANSITION',
      sourceRevision: before.revision + 1,
      beforeValue: {
        workflowId: binding.workflowId,
        version: binding.version,
        stateId: binding.stateId,
      },
      afterValue: {
        workflowId: binding.workflowId,
        version: binding.version,
        stateId: selected.toStateId,
      },
    },
  });
}
export async function dependencyScheduleGuard(
  tx: Prisma.TransactionClient,
  before: Task,
  proposed: {
    plannedStartAt: Date | null;
    dueAt: Date | null;
    scheduledDate: string | null;
  },
) {
  if (!before.scopeId) return;
  const edges = await tx.taskDependency.findMany({
    where: {
      spaceId: before.spaceId,
      scopeId: before.scopeId,
      retiredAt: null,
      OR: [{ predecessorId: before.id }, { successorId: before.id }],
    },
  });
  if (!edges.length) return;
  const ids = [
      ...new Set(edges.flatMap((e) => [e.predecessorId, e.successorId])),
    ],
    tasks = await tx.task.findMany({
      where: {
        spaceId: before.spaceId,
        scopeId: before.scopeId,
        id: { in: ids },
        deletedAt: null,
      },
    }),
    byId = new Map(
      tasks.map((t) => [
        t.id,
        {
          ...t,
          scheduledDate: t.scheduledDate?.toISOString().slice(0, 10) ?? null,
        },
      ]),
    );
  byId.set(before.id, { ...before, ...proposed });
  for (const edge of edges) {
    const p = byId.get(edge.predecessorId),
      s = byId.get(edge.successorId);
    if (!p || !s) throw new NotFoundException();
    let satisfied: boolean | null;
    try {
      satisfied = dependencySatisfied(edge as Dependency, p, s);
    } catch {
      throw new ConflictException({ code: 'INVALID_DEPENDENCY_SCHEDULE' });
    }
    if (satisfied === false)
      throw new ConflictException({ code: 'RESCHEDULE_PREVIEW_REQUIRED' });
  }
}
