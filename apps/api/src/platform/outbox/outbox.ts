import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../authorization/authorized-space.js';
import type { SharedCleanupScope } from '../lifecycle/shared-cleanup.js';

// Consumers fetch timezone through the authorized account facade; no personal value is broadcast.
export const EventSchema = z.strictObject({
  type: z.enum([
    'account.timezone_changed',
    'account.deletion_requested',
    'task.created',
    'task.updated',
    'task.completed',
    'task.reopened',
    'task.deleted',
    'task.due_changed',
    'calendar_event.changed',
    'time_block.changed',
    'habit.entry_recorded',
    'habit.entry_corrected',
    'goal.progress_changed',
    'capture.triaged',
    'finance.transaction_posted',
    'finance.transaction_reversed',
    'reminder.changed',
  ]),
  version: z.literal(1),
  aggregateId: z.string().uuid(),
  payload: z.strictObject({}),
});
export type DomainEvent = z.infer<typeof EventSchema>;
/** Calendar owner uses this only while unlinking a purged source; no private body or user impersonation. */
export async function appendSharedSourceDeparture(
  tx: Prisma.TransactionClient,
  scope: SharedCleanupScope,
  personalSpaceId: string,
  blockId: string,
) {
  scope.verify(tx);
  await tx.outboxEvent.create({
    data: {
      type: 'time_block.changed',
      version: 1,
      aggregateId: blockId,
      payload: {},
      spaceId: personalSpaceId,
      correlationId: scope.jobId,
    },
  });
}

export async function appendOutbox(
  tx: Prisma.TransactionClient,
  scope: AuthorizedSpace,
  event: DomainEvent,
) {
  const value = EventSchema.parse(event);
  return tx.outboxEvent.create({
    data: {
      ...value,
      spaceId: scope.spaceId,
      correlationId: scope.actor.correlationId,
    },
  });
}

export async function appendOutboxBatch(
  tx: Prisma.TransactionClient,
  scope: AuthorizedSpace,
  events: DomainEvent[],
): Promise<void> {
  if (!events.length) return;
  await tx.outboxEvent.createMany({
    data: events.map((event) => ({
      ...EventSchema.parse(event),
      spaceId: scope.spaceId,
      correlationId: scope.actor.correlationId,
    })),
  });
}
