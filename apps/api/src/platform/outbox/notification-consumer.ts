import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
export type NotificationEvent = {
  id: string;
  spaceId: string;
  type: string;
  aggregateId: string;
};
const supported = [
  'account.timezone_changed',
  'reminder.changed',
  'task.created',
  'task.updated',
  'task.completed',
  'task.reopened',
  'task.deleted',
  'task.due_changed',
];
/** A dedicated consumer cursor: immutable outbox rows remain available to future consumers. */
@Injectable()
export class NotificationOutbox {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  async consume(
    work: (
      tx: Prisma.TransactionClient,
      event: NotificationEvent,
    ) => Promise<void>,
  ) {
    let selected: string | undefined;
    try {
      return await this.db.client.$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<
            NotificationEvent[]
          >`SELECT id,"spaceId",type,"aggregateId" FROM "OutboxEvent" WHERE "notificationHandledAt" IS NULL AND "notificationAttempts"<5 AND type=ANY(${supported}::text[]) AND ("notificationRetryAt" IS NULL OR "notificationRetryAt"<=clock_timestamp()) ORDER BY "occurredAt",id LIMIT 1 FOR UPDATE SKIP LOCKED`;
          const event = rows[0];
          if (!event) return false;
          selected = event.id;
          await work(tx, event);
          await tx.outboxEvent.update({
            where: { id: event.id },
            data: {
              notificationHandledAt: new Date(),
              notificationAttempts: { increment: 1 },
              notificationRetryAt: null,
              notificationFailureCode: null,
            },
          });
          return true;
        },
        { timeout: 30000 },
      );
    } catch {
      if (!selected) throw new Error('OUTBOX_QUERY_UNAVAILABLE');
      await this.db.client.outboxEvent.updateMany({
        where: {
          id: selected,
          notificationHandledAt: null,
          notificationAttempts: { lt: 5 },
        },
        data: {
          notificationAttempts: { increment: 1 },
          notificationRetryAt: new Date(Date.now() + 60000),
          notificationFailureCode: 'RECONCILIATION_FAILED',
        },
      });
      return true;
    }
  }
}
