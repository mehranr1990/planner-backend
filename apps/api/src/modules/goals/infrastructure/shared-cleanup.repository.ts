import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import { sharedDeleteBatch } from '../../../platform/lifecycle/shared-cleanup.js';
import type { SharedCleanupScope } from '../../../platform/lifecycle/shared-cleanup.js';
import { SharedGoalsCleanup } from '../public/shared-cleanup.js';
@Injectable()
export class SharedGoalsCleanupRepository extends SharedGoalsCleanup {
  async batch(tx: Prisma.TransactionClient, s: SharedCleanupScope) {
    s.verify(tx);
    const normalized =
      await tx.$executeRaw`UPDATE "Goal" SET "metricId"=NULL,"progressMode"='MANUAL' WHERE id IN(SELECT id FROM "Goal" WHERE "spaceId"=${s.spaceId}::uuid AND "metricId" IS NOT NULL LIMIT 200)`;
    if (normalized) return false;
    if (
      !(await sharedDeleteBatch(tx, s, [
        'GoalTaskLink',
        'GoalHabitLink',
        'GoalReview',
        'GoalMetric',
        'GoalMilestone',
      ]))
    )
      return false;
    const count =
      await tx.$executeRaw`DELETE FROM "Goal" WHERE id IN (SELECT g.id FROM "Goal" g WHERE g."spaceId"=${s.spaceId}::uuid AND NOT EXISTS(SELECT 1 FROM "Goal" c WHERE c."spaceId"=g."spaceId" AND c."parentGoalId"=g.id) ORDER BY g.id LIMIT 200)`;
    return count === 0;
  }
}
