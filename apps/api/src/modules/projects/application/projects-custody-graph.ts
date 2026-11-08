import { Injectable, Inject } from '@nestjs/common';
import { TaskCustodyGraph } from '../../tasks/public/index.js';
import { GoalCustodyGraph } from '../../goals/public/index.js';
import { CalendarCustodyGraph } from '../../calendar/public/index.js';
import { NotificationCustodyGraph } from '../../notifications/public/index.js';
import { SharedFiles } from '../../../platform/storage/public/index.js';
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
    table: 'Project',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'ProjectTask',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'ProjectGoal',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'ProjectMemberAssignment',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'ProjectPhase',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'ProjectSection',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'ProjectMilestone',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'ProjectCapacityDay',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'ProjectChangePlan',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'ProjectChangeSource',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'ProjectReportSnapshot',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'ProjectReportSource',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'ProjectRiskIssue',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'ProjectRiskIssueEvent',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'ProjectTemplate',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'ProjectTemplateVersion',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'ProjectWorkAllocation',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'ProjectActivity',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'ProjectComment',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'ProjectCommentVersion',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'ProjectDocument',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'ProjectDocumentVersion',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'ProjectFile',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'ProjectTransfer',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TaskAssignment',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'CompanyProjectFinanceLink',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'ProjectCompanyAssociation',
    select: ['spaceId'],
    move: ['spaceId'],
  },
  {
    table: 'TeamProjectReference',
    select: ['spaceId', 'teamId'],
    move: ['spaceId'],
  },
];
/** projects owns every row selected here; coordination sees only keys and hashes. */
@Injectable()
export class ProjectCustodyGraph {
  constructor(
    @Inject(TaskCustodyGraph) private readonly tasks: TaskCustodyGraph,
    @Inject(GoalCustodyGraph) private readonly goals: GoalCustodyGraph,
    @Inject(CalendarCustodyGraph)
    private readonly calendar: CalendarCustodyGraph,
    @Inject(NotificationCustodyGraph)
    private readonly notifications: NotificationCustodyGraph,
    @Inject(SharedFiles) private readonly files: SharedFiles,
  ) {}
  async snapshotEngines(
    tx: Prisma.TransactionClient,
    scope: CustodyGraphScope,
  ) {
    const parts = [];
    for (const owner of [
      this.tasks,
      this.goals,
      this.calendar,
      this.notifications,
    ])
      parts.push(...(await owner.snapshot(tx, scope)));
    const storage = await this.files.custodySnapshot(tx, scope);
    return { parts: [...parts, ...storage.parts], files: storage.files };
  }
  async moveEngines(tx: Prisma.TransactionClient, scope: CustodyGraphScope) {
    for (const owner of [
      this.tasks,
      this.goals,
      this.calendar,
      this.notifications,
    ])
      await owner.move(tx, scope);
    await this.files.custodyMove(tx, scope);
  }
  snapshot(tx: Prisma.TransactionClient, scope: CustodyGraphScope) {
    return snapshotCustodyGraph(tx, scope, tables);
  }
  move(tx: Prisma.TransactionClient, scope: CustodyGraphScope) {
    return moveCustodyGraph(tx, scope, tables);
  }
}
