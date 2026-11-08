import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import {
  snapshotCustodyGraph,
  moveCustodyGraph,
} from '../../../platform/database/custody-graph.js';
import type {
  CustodyGraphScope,
  CustodyGraphTable,
} from '../../../platform/database/custody-graph.js';
const tables: readonly CustodyGraphTable[] = [
  {
    table: 'Task',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TaskChecklistItem',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TaskChange',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TaskLabel',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TaskAttachment',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'Label',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TaskWorkflow',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TaskWorkflowVersion',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TaskWorkflowState',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TaskWorkflowEdge',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TaskWorkflowApprover',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TaskWorkflowBinding',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TaskWorkflowApproval',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TaskDependencyGraph',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TaskDependency',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TaskReschedulePreview',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TaskRescheduleItem',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TaskField',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TaskFieldVersion',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TaskFieldOption',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TaskFieldSelection',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TaskFieldValue',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TaskMetadataEvent',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'SharedTaskWorkLog',
    select: ['spaceId'],
    move: ['spaceId'],
  },
];
/** tasks owns every row selected here; coordination sees only keys and hashes. */
@Injectable()
export class TaskCustodyGraph {
  snapshot(tx: Prisma.TransactionClient, scope: CustodyGraphScope) {
    return snapshotCustodyGraph(tx, scope, tables);
  }
  move(tx: Prisma.TransactionClient, scope: CustodyGraphScope) {
    return moveCustodyGraph(tx, scope, tables);
  }
}
