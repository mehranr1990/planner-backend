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
    table: 'Goal',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'GoalTaskLink',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'GoalHabitLink',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'GoalReview',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'GoalMetric',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'GoalMilestone',
    select: ['spaceId'],
    move: ['spaceId'],
  },
];
/** goals owns every row selected here; coordination sees only keys and hashes. */
@Injectable()
export class GoalCustodyGraph {
  snapshot(tx: Prisma.TransactionClient, scope: CustodyGraphScope) {
    return snapshotCustodyGraph(tx, scope, tables);
  }
  move(tx: Prisma.TransactionClient, scope: CustodyGraphScope) {
    return moveCustodyGraph(tx, scope, tables);
  }
}
