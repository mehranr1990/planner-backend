import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../authorization/authorized-space.js';

// Consumers fetch timezone through the authorized account facade; no personal value is broadcast.
export const EventSchema = z.strictObject({
  type: z.enum([
    'account.timezone_changed',
    'task.created',
    'task.updated',
    'task.completed',
    'task.reopened',
    'task.deleted',
    'task.due_changed',
  ]),
  version: z.literal(1),
  aggregateId: z.string().uuid(),
  payload: z.strictObject({}),
});
export type DomainEvent = z.infer<typeof EventSchema>;

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
