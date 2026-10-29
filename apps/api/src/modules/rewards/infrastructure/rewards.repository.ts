import {
  Inject,
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as c from '@mehran/api-contracts';
import { DatabaseService } from '../../../platform/database/database.service.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { idempotent } from '../../../platform/database/idempotency.js';
import type { MutationReceipt } from '../../../platform/database/idempotency.js';
import {
  cursorPosition,
  cursorPage,
} from '../../../platform/database/cursor-pagination.js';
import { writeAudit } from '../../../platform/audit/audit.service.js';
import { RewardOutbox } from '../../../platform/outbox/reward-consumer.js';
import { RewardPreferencesAccess } from '../../account/public/index.js';
import { SpacesService } from '../../spaces/public/index.js';
import { ReminderTasks } from '../../tasks/public/index.js';
import { RewardHabits } from '../../habits/public/index.js';
import { RewardsPort } from '../application/rewards.port.js';
@Injectable()
export class RewardsRepository extends RewardsPort {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(RewardPreferencesAccess)
    private readonly prefs: RewardPreferencesAccess,
    @Inject(SpacesService) private readonly spaces: SpacesService,
    @Inject(ReminderTasks) private readonly tasks: ReminderTasks,
    @Inject(RewardHabits) private readonly habits: RewardHabits,
    @Inject(RewardOutbox) private readonly outbox: RewardOutbox,
  ) {
    super();
  }
  private async lock(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    await scope.fence(tx);
    return tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'rewards:' + scope.spaceId},0))::text`;
  }
  preferences(scope: AuthorizedSpace) {
    return this.db.client.$transaction((tx) => this.prefs.read(tx, scope));
  }
  private async once<T extends object>(
    scope: AuthorizedSpace,
    op: string,
    key: string,
    input: unknown,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const receipt = await idempotent(
      this.db.client,
      scope,
      'rewards.' + op,
      key,
      input,
      async (tx) => {
        await this.lock(tx, scope);
        const result = await work(tx);
        return {
          resultId: scope.spaceId,
          statusCode: 200,
          result: JSON.parse(JSON.stringify(result)) as NonNullable<
            MutationReceipt['result']
          >,
        };
      },
    );
    return receipt.result as T;
  }
  setPreferences(
    scope: AuthorizedSpace,
    revision: number,
    key: string,
    value: { enabled: boolean; displayAchievements: boolean },
  ) {
    return this.once(
      scope,
      'preferences',
      key,
      { revision, ...value },
      async (tx) => {
        const result = await this.prefs.update(tx, scope, revision, value);
        await writeAudit(tx, {
          action: 'REWARD_PREFERENCES_CHANGE',
          outcome: 'SUCCEEDED',
          actorUserId: scope.actor.userId,
          requestId: scope.actor.requestId,
          correlationId: scope.actor.correlationId,
          resourceId: scope.spaceId,
        });
        return result;
      },
    );
  }
  progress(
    scope: AuthorizedSpace,
    q: { cursor?: string | undefined; limit?: string | undefined },
  ) {
    return this.db.client.$transaction(
      async (tx) => {
        const p = await this.prefs.read(tx, scope),
          position = cursorPosition(scope, 'rewards.ledger', q.cursor),
          limit = Number(q.limit ?? 25);
        const freshness = await this.outbox.freshness(tx, scope.spaceId);
        if (!p.enabled)
          return c.RewardProgressSchema.parse({
            enabled: false,
            totalXp: '0',
            policy: 'EARNED_HISTORY_NO_NEGATIVE_XP',
            items: [],
            nextCursor: null,
            freshness,
          });
        const rows = await tx.xpLedger.findMany({
          where: {
            spaceId: scope.spaceId,
            ...(position
              ? {
                  OR: [
                    { earnedAt: { gt: position.createdAt } },
                    { earnedAt: position.createdAt, id: { gt: position.id } },
                  ],
                }
              : {}),
          },
          orderBy: [{ earnedAt: 'asc' }, { id: 'asc' }],
          take: limit + 1,
        });
        const totals = await tx.$queryRaw<
          Array<{ total: string }>
        >`SELECT COALESCE(sum(points),0)::text AS total FROM "XpLedger" WHERE "spaceId"=${scope.spaceId}::uuid`;
        const page = cursorPage(
          scope,
          'rewards.ledger',
          limit,
          rows.map((r) => ({ ...r, createdAt: r.earnedAt })),
        );
        return c.RewardProgressSchema.parse({
          enabled: true,
          totalXp: totals[0]!.total,
          policy: 'EARNED_HISTORY_NO_NEGATIVE_XP',
          items: page.items.map((r) => ({
            id: r.id,
            sourceEventId: r.sourceEventId,
            kind: r.kind,
            points: r.points,
            earnedAt: r.earnedAt.toISOString(),
          })),
          nextCursor: page.nextCursor,
          freshness,
        });
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  achievements(scope: AuthorizedSpace) {
    return this.db.client.$transaction(async (tx) => {
      const p = await this.prefs.read(tx, scope);
      const rows =
        p.enabled && p.displayAchievements
          ? await tx.achievementDefinition.findMany({
              orderBy: { code: 'asc' },
              include: { unlocks: { where: { spaceId: scope.spaceId } } },
              take: 3,
            })
          : [];
      return c.AchievementsSchema.parse({
        enabled: p.enabled,
        displayAchievements: p.displayAchievements,
        items: rows.map((r) => ({
          id: r.id,
          code: r.code,
          ruleVersion: r.ruleVersion,
          required: r.required,
          unlockedAt: r.unlocks[0]?.unlockedAt.toISOString() ?? null,
        })),
      });
    });
  }
  private async unlock(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    after?: string,
    limit = 3,
  ) {
    const defs = await tx.achievementDefinition.findMany({
        where: after ? { code: { gt: after } } : {},
        orderBy: { code: 'asc' },
        take: limit + 1,
      }),
      items = defs.slice(0, limit);
    for (const def of items) {
      const count = await tx.$queryRaw<
        Array<{ count: bigint }>
      >`SELECT count(*) AS count FROM (SELECT id FROM "XpLedger" WHERE "spaceId"=${scope.spaceId}::uuid AND kind=${def.kind} LIMIT ${def.required}) matches`;
      if (Number(count[0]!.count) >= def.required)
        await tx.achievementUnlock.upsert({
          where: {
            spaceId_definitionId: {
              spaceId: scope.spaceId,
              definitionId: def.id,
            },
          },
          create: {
            spaceId: scope.spaceId,
            definitionId: def.id,
            ruleVersion: 1,
          },
          update: {},
        });
    }
    return {
      processed: items.length,
      nextCursor: defs.length > limit ? items.at(-1)!.code : null,
    };
  }
  recalculate(
    scope: AuthorizedSpace,
    revision: number,
    key: string,
    q: { after?: string | undefined; limit: number },
  ) {
    return this.once(
      scope,
      'recalculate',
      key,
      { revision, ...q },
      async (tx) => {
        const p = await this.prefs.read(tx, scope);
        if (p.revision !== revision) throw new ConflictException();
        if (!p.enabled) throw new NotFoundException();
        const result = await this.unlock(tx, scope, q.after, q.limit);
        await writeAudit(tx, {
          action: 'REWARD_RECALCULATE',
          outcome: 'SUCCEEDED',
          actorUserId: scope.actor.userId,
          requestId: scope.actor.requestId,
          correlationId: scope.actor.correlationId,
          resourceId: scope.spaceId,
        });
        return c.RewardRecalculatedSchema.parse(result);
      },
    );
  }
  consume() {
    return this.outbox.consume(async (tx, event) => {
      const scope = await this.spaces.background(
        tx,
        event.spaceId,
        event.id,
        event.correlationId,
      );
      if (!scope) return;
      await this.lock(tx, scope);
      let p: c.RewardPreferences;
      try {
        p = await this.prefs.read(tx, scope);
      } catch (e) {
        if (e instanceof NotFoundException) return;
        throw e;
      }
      if (
        !p.enabled ||
        !p.enabledSince ||
        event.occurredAt < new Date(p.enabledSince)
      )
        return;
      const now = new Date();
      let rewardKey: string | undefined,
        kind = 'TASK',
        points = 10;
      if (event.type === 'task.completed') {
        const t = await this.tasks.read(tx, scope, event.aggregateId);
        if (
          !t ||
          t.master ||
          t.deletedAt ||
          ['SKIPPED', 'CANCELED'].includes(t.occurrenceState ?? '')
        )
          return;
        rewardKey = 'task:' + t.id;
      } else {
        const dates = await this.habits.achieved(
          tx,
          scope,
          event.aggregateId,
          event.id,
          now,
        );
        if (dates.length !== 1) return;
        rewardKey = 'habit:' + event.aggregateId + ':' + dates[0];
        kind = 'HABIT_DAY';
        points = 5;
      }
      await tx.xpLedger.createMany({
        data: [
          {
            id: randomUUID(),
            spaceId: scope.spaceId,
            sourceEventId: event.id,
            rewardKey,
            kind,
            points,
            ruleVersion: 1,
          },
        ],
        skipDuplicates: true,
      });
      await this.unlock(tx, scope);
    });
  }
}
