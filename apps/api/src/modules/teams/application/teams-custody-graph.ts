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
    table: 'TeamSetting',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TeamPresence',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TeamCheckinReply',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TeamCheckinComment',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TeamTaskState',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TeamThanks',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TeamThanksRecipient',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TeamFeedbackRequest',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TeamFeedbackNote',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TeamTaskAssignment',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TeamTaskAssignmentEvent',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TeamTaskPoints',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TeamTimeOff',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TeamTimeOffEvent',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TeamKeyResult',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TeamKeyResultCheckin',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TeamMemberProfile',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TeamNotification',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TeamFileVersion',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TeamFile',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TeamFileFolder',
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
