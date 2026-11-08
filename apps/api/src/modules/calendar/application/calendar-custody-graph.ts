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
    table: 'CalendarEvent',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'EventRecurrence',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TimeBlockSharedTaskLink',
    select: ['spaceId'],
    move: ['spaceId'],
  },
];
/** calendar owns every row selected here; coordination sees only keys and hashes. */
@Injectable()
export class CalendarCustodyGraph {
  snapshot(tx: Prisma.TransactionClient, scope: CustodyGraphScope) {
    return snapshotCustodyGraph(tx, scope, tables);
  }
  move(tx: Prisma.TransactionClient, scope: CustodyGraphScope) {
    return moveCustodyGraph(tx, scope, tables);
  }
}
