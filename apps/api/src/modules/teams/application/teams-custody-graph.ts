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
    table: 'Team',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TeamPlan',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TeamWorkItem',
    select: ['spaceId', 'sourceSpaceId'],
    move: ['spaceId', 'sourceSpaceId'],
  },
  {
    table: 'TeamCapacityDay',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TeamCase',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TeamCaseEntry',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TeamDisclosure',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TeamDisclosureRecipient',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TeamMeeting',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TeamMeetingInvitation',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TeamCompanyAssociation',
    select: ['spaceId'],
    move: ['spaceId'],
  },
];
/** teams owns every row selected here; coordination sees only keys and hashes. */
@Injectable()
export class TeamCustodyGraph {
  snapshot(tx: Prisma.TransactionClient, scope: CustodyGraphScope) {
    return snapshotCustodyGraph(tx, scope, tables);
  }
  move(tx: Prisma.TransactionClient, scope: CustodyGraphScope) {
    return moveCustodyGraph(tx, scope, tables);
  }
}
