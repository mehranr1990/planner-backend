import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
export type RewardEvent = {
  id: string;
  spaceId: string;
  aggregateId: string;
  correlationId: string;
  type: string;
  occurredAt: Date;
};
const supported = [
  'task.completed',
  'habit.entry_recorded',
  'habit.entry_corrected',
];
@Injectable()
export class RewardOutbox {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  async freshness(tx: Prisma.TransactionClient, spaceId: string) {
    const rows = await tx.$queryRaw<
      Array<{ pending: bigint; failed: bigint }>
    >`SELECT count(*) FILTER(WHERE "rewardAttempts"<5) AS pending,count(*) FILTER(WHERE "rewardAttempts">=5) AS failed FROM "OutboxEvent" WHERE "spaceId"=${spaceId}::uuid AND type=ANY(${supported}::text[]) AND "rewardHandledAt" IS NULL`;
    return {
      pending: Number(rows[0]!.pending),
      failed: Number(rows[0]!.failed),
    };
  }
  async consume(
    work: (tx: Prisma.TransactionClient, event: RewardEvent) => Promise<void>,
  ) {
    let selected: string | undefined;
    try {
      return await this.db.client.$transaction(
        async (tx) => {
          const [event] = await tx.$queryRaw<
            RewardEvent[]
          >`SELECT id,"spaceId","aggregateId","correlationId",type,"occurredAt" FROM "OutboxEvent" WHERE type=ANY(${supported}::text[]) AND "rewardHandledAt" IS NULL AND "rewardAttempts"<5 AND ("rewardRetryAt" IS NULL OR "rewardRetryAt"<=clock_timestamp()) ORDER BY "occurredAt",id LIMIT 1 FOR UPDATE SKIP LOCKED`;
          if (!event) return false;
          selected = event.id;
          await work(tx, event);
          await tx.outboxEvent.update({
            where: { id: event.id },
            data: {
              rewardHandledAt: new Date(),
              rewardAttempts: { increment: 1 },
              rewardRetryAt: null,
              rewardFailureCode: null,
            },
          });
          return true;
        },
        { timeout: 30000 },
      );
    } catch {
      if (!selected) throw new Error('REWARD_OUTBOX_UNAVAILABLE');
      await this.db.client
        .$executeRaw`UPDATE "OutboxEvent" SET "rewardRetryAt"=clock_timestamp()+interval '1 minute'*power(2,"rewardAttempts"),"rewardAttempts"="rewardAttempts"+1,"rewardFailureCode"='REWARD_RECONCILIATION_FAILED' WHERE id=${selected}::uuid AND "rewardHandledAt" IS NULL AND "rewardAttempts"<5`;
      return true;
    }
  }
}
