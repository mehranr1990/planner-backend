import { Injectable, Inject, ConflictException } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import { SharedLifecycleService } from '../../spaces/public/index.js';
import {
  sharedDeleteBatch,
  sharedChildDeleteBatch,
} from '../../../platform/lifecycle/shared-cleanup.js';
@Injectable()
export class SocialLifecycle {
  constructor(
    @Inject(SharedLifecycleService) readonly lifecycle: SharedLifecycleService,
  ) {}
  async consume() {
    const hint = await this.lifecycle.next('SOCIAL_GROUP');
    if (!hint?.spaceId) return false;
    const result = await this.lifecycle.advance(
      hint,
      [],
      async (tx, s, stage) => {
        if (stage === 'FILES') return { nextStage: 'REQUESTS' };
        if (stage === 'REQUESTS')
          return (await sharedChildDeleteBatch(tx, s, 'SocialJoinRequest', [
            { table: 'SocialGroup', foreignKey: 'groupId' },
          ]))
            ? { nextStage: 'ADMISSIONS' }
            : {};
        if (stage === 'ADMISSIONS')
          return (await this.lifecycle.admissions(tx, s))
            ? { nextStage: 'ROOT' }
            : {};
        if (stage === 'ROOT')
          return (await sharedDeleteBatch(tx, s, ['SocialGroup']))
            ? { nextStage: 'CORE' }
            : {};
        if (stage === 'CORE')
          return (await this.lifecycle.core(tx, s)) ? { finalize: true } : {};
        throw new ConflictException({ code: 'UNKNOWN_CLEANUP_STAGE' });
      },
      'SOCIAL_GROUP',
      (tx, spaceId) => this.protectedRecords(tx, spaceId),
    );
    return Boolean(result);
  }
  /**
   * P6-06 (ADR 0066): the 30-day window only makes eligible Social content
   * disposable. Expenses, settlements, Social audit, goal history and
   * Lost & Found evidence (including Group Activities') have no approved
   * disposal policy, so the purge fails closed: the job stays BLOCKED_POLICY,
   * nobody holds a seat, and the worker re-checks hourly. Nothing is deleted.
   */
  async protectedRecords(tx: Prisma.TransactionClient, spaceId: string) {
    const [row] = await tx.$queryRaw<{ held: boolean }[]>`
      WITH g AS (SELECT id FROM "SocialGroup" WHERE "spaceId"=${spaceId}::uuid),
      a AS (SELECT s.id FROM "SocialActivity" s JOIN g ON s."groupId"=g.id)
      SELECT EXISTS(SELECT 1 FROM "SocialExpense" WHERE "groupId" IN (SELECT id FROM g) OR "activityId" IN (SELECT id FROM a))
        OR EXISTS(SELECT 1 FROM "SocialSettlement" WHERE "groupId" IN (SELECT id FROM g) OR "activityId" IN (SELECT id FROM a))
        OR EXISTS(SELECT 1 FROM "SocialAuditEvent" WHERE "groupId" IN (SELECT id FROM g) OR "activityId" IN (SELECT id FROM a))
        OR EXISTS(SELECT 1 FROM "SocialGoal" WHERE "groupId" IN (SELECT id FROM g) OR "activityId" IN (SELECT id FROM a))
        OR EXISTS(SELECT 1 FROM "SocialLostFoundReport" WHERE "groupId" IN (SELECT id FROM g)) AS held`;
    return row?.held ? 'SOCIAL_PROTECTED_RECORDS_RETAINED' : null;
  }
}
