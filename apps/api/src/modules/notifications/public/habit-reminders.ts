import { ConflictException } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { appendOutbox } from '../../../platform/outbox/outbox.js';

/** Notifications owns reminder writes; the Habit owner supplies its current metadata. */
export async function syncHabitReminder(
  tx: Prisma.TransactionClient,
  scope: AuthorizedSpace,
  input: {
    id: string;
    title: string;
    timezone: string;
    startDate: string;
    reminder: { time: string; ifNotDone: boolean } | null;
  },
) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`notifications:${scope.spaceId}`},0))::text`;
  const old = await tx.reminder.findFirst({
    where: { spaceId: scope.spaceId, habitId: input.id },
  });
  if (!old && !input.reminder) return;
  if (
    !old &&
    (await tx.reminder.count({
      where: { spaceId: scope.spaceId, state: 'ACTIVE' },
    })) >= 1000
  )
    throw new ConflictException();
  if (old)
    await tx.notificationDelivery.updateMany({
      where: {
        reminderId: old.id,
        state: { in: ['PENDING', 'RETRY', 'PROCESSING'] },
        networkStartedAt: null,
      },
      data: {
        state: 'CANCELED',
        reason: 'RESCHEDULED',
        canceledAt: new Date(),
        cancelRequestedAt: null,
        leaseToken: null,
        leaseUntil: null,
        revision: { increment: 1 },
      },
    });
  if (old)
    await tx.notificationDelivery.updateMany({
      where: {
        reminderId: old.id,
        state: 'PROCESSING',
        networkStartedAt: { not: null },
      },
      data: { cancelRequestedAt: new Date(), revision: { increment: 1 } },
    });
  const data = {
    title: input.title,
    timezone: input.timezone,
    state: input.reminder ? 'ACTIVE' : 'CANCELED',
    rule: {
      version: 1,
      kind: 'LOCAL',
      startDate: input.startDate,
      time: input.reminder?.time ?? '00:00',
      recurrence: {
        version: 1,
        frequency: 'DAILY',
        interval: 1,
        weekdays: [],
        until: null,
        count: null,
        exclusions: [],
      },
    },
    nextAt: null,
    sourceStamp: null,
    cursorDate: null,
    exhausted: false,
  };
  const row = old
    ? await tx.reminder.update({
        where: { id: old.id },
        data: {
          ...data,
          revision: { increment: 1 },
          ruleVersion: { increment: 1 },
        },
      })
    : await tx.reminder.create({
        data: {
          ...data,
          spaceId: scope.spaceId,
          ownerUserId: scope.actor.userId,
          createdByUserId: scope.actor.userId,
          habitId: input.id,
          timezoneMode: 'FIXED',
          channels: ['IN_APP', 'EMAIL', 'WEB_PUSH'],
        },
      });
  await appendOutbox(tx, scope, {
    type: 'reminder.changed',
    version: 1,
    aggregateId: row.id,
    payload: {},
  });
}
