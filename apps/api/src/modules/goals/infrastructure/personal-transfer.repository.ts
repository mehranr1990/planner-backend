import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { z } from 'zod';
import type * as c from '@mehran/api-contracts';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import type { SharedAuthority } from '../../spaces/public/index.js';
import { appendOutbox } from '../../../platform/outbox/outbox.js';
import { transferCatalog } from '../../../platform/database/transfer-catalog.js';
import { PersonalGoalTransfer } from '../public/personal-transfer.js';
const known = [
  'GoalGrant_spaceId_scopeId_goalId_fkey',
  'GoalHabitLink_spaceId_goalId_fkey',
  'GoalMetric_spaceId_goalId_fkey',
  'GoalMilestone_spaceId_goalId_fkey',
  'GoalReview_spaceId_goalId_fkey',
  'GoalTaskLink_spaceId_goalId_fkey',
  'Goal_parent_scope_fk',
  'Goal_spaceId_parentGoalId_fkey',
  'Note_spaceId_goalId_fkey',
  'ProjectGoal_spaceId_scopeId_goalId_fkey',
  'ResourceGrantOffer_spaceId_scopeId_goalId_fkey',
];
@Injectable()
export class PersonalGoalTransferRepository extends PersonalGoalTransfer {
  async preview(
    tx: Prisma.TransactionClient,
    source: AuthorizedSpace,
    selected: z.infer<typeof c.ProjectTransferSelectionSchema>[],
    consent: z.infer<typeof c.ProjectTransferConsentSchema>,
  ) {
    await source.fence(tx);
    const catalog = await transferCatalog(tx, 'Goal', known),
      result: z.infer<typeof c.ProjectTransferCandidateSchema>[] = [];
    for (const item of [...selected].sort((a, b) => a.id.localeCompare(b.id))) {
      const row = await tx.goal.findFirst({
        where: { id: item.id, spaceId: source.spaceId, scopeId: null },
        include: {
          _count: {
            select: {
              noteReferences: true,
              children: true,
              milestones: true,
              metrics: true,
              taskLinks: true,
              habitLinks: true,
              reviews: true,
            },
          },
          metrics: { orderBy: { id: 'asc' }, take: 1001 },
          milestones: { orderBy: { id: 'asc' }, take: 1001 },
          reviews: { orderBy: { id: 'asc' }, take: 1001 },
        },
      });
      if (!row) throw new NotFoundException();
      if (row.revision !== item.revision)
        throw new ConflictException({ code: 'TRANSFER_SOURCE_CHANGED' });
      const blockers: string[] = [];
      if (!catalog.known) blockers.push('UNKNOWN_INCOMING_FK');
      if (row.parentGoalId || row.lifeAreaId)
        blockers.push('HIERARCHY_OR_PRIVATE_LIFE_AREA');
      for (const [relation, count] of Object.entries(row._count))
        if (
          count > 0 &&
          !['metrics', 'milestones', 'reviews'].includes(relation)
        )
          blockers.push('REFERENCE:' + relation);
      if (row._count.reviews && !consent.includeGoalReviews)
        blockers.push('REVIEW_CONSENT_REQUIRED');
      if (
        row._count.metrics + row._count.milestones > 1000 ||
        row._count.reviews > 1000
      )
        blockers.push('GRAPH_LIMIT');
      const privateReferences = Object.entries(row._count)
        .filter(
          ([relation, count]) =>
            count > 0 &&
            !['metrics', 'milestones', 'reviews'].includes(relation),
        )
        .map(([relation, count]) => ({
          relation,
          count,
          disposition: 'REJECT' as const,
        }));
      if (row.parentGoalId)
        privateReferences.push({
          relation: 'parentGoalId',
          count: 1,
          disposition: 'REJECT',
        });
      if (row.lifeAreaId)
        privateReferences.push({
          relation: 'lifeAreaId',
          count: 1,
          disposition: 'REJECT',
        });
      const nodes: z.infer<typeof c.ProjectTransferCandidateSchema>['nodes'] = [
        { kind: 'GOAL', id: row.id },
        ...row.metrics.map((r) => ({ kind: 'GOAL_METRIC' as const, id: r.id })),
        ...row.milestones.map((r) => ({
          kind: 'GOAL_MILESTONE' as const,
          id: r.id,
        })),
        ...row.reviews.map((r) => ({ kind: 'GOAL_REVIEW' as const, id: r.id })),
      ];
      result.push({
        kind: 'GOAL',
        id: row.id,
        revision: row.revision,
        sourceHash: createHash('sha256')
          .update(JSON.stringify({ row, catalog: catalog.rows }))
          .digest('hex'),
        children: row._count.metrics + row._count.milestones,
        history: row._count.reviews,
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
    a.require(tx, destination, 'goal.manage');
    await tx.$executeRaw`SET CONSTRAINTS "Goal_spaceId_id_metricId_fkey" DEFERRED`;
    for (const item of [...selected].sort((x, y) => x.id.localeCompare(y.id))) {
      const changed = await tx.goal.updateMany({
        where: {
          id: item.id,
          spaceId: source.spaceId,
          scopeId: null,
          revision: item.revision,
        },
        data: {
          spaceId: destination,
          scopeId: destination,
          createdByUserId: null,
          createdByActorId: actor,
          revision: { increment: 1 },
          updatedAt: now,
        },
      });
      if (changed.count !== 1) throw new ConflictException();
      await appendOutbox(tx, source, {
        type: 'goal.progress_changed',
        version: 1,
        aggregateId: item.id,
        payload: {},
      });
    }
  }
}
