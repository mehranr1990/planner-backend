import { Injectable, ConflictException } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { ReminderRuleSchema } from '@mehran/api-contracts';
import type { RoutineSchedule } from '@mehran/api-contracts';
import { RoutineReminders } from '../public/routine-reminders.js';
import { appendOutbox } from '../../../platform/outbox/outbox.js';
import { writeAudit } from '../../../platform/audit/audit.service.js';
@Injectable()
export class RoutineRemindersRepository extends RoutineReminders {
  async sync(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    routineId: string,
    title: string,
    schedule: RoutineSchedule | null,
  ) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`notifications:${scope.spaceId}`},0))::text`;
    const old = await tx.reminder.findMany({
      where: { spaceId: scope.spaceId, routineId },
      orderBy: { createdAt: 'asc' },
      take: 1001,
    });
    if (old.length > 1000) throw new ConflictException();
    for (const row of old) {
      await tx.reminder.update({
        where: { id: row.id },
        data: { state: 'CANCELED', revision: { increment: 1 } },
      });
      await tx.notificationDelivery.updateMany({
        where: {
          spaceId: scope.spaceId,
          reminderId: row.id,
          state: { in: ['PENDING', 'RETRY', 'PROCESSING'] },
        },
        data: { cancelRequestedAt: new Date(), revision: { increment: 1 } },
      });
      await appendOutbox(tx, scope, {
        type: 'reminder.changed',
        version: 1,
        aggregateId: row.id,
        payload: {},
      });
    }
    if (!schedule?.reminder) return;
    if (
      (await tx.reminder.count({
        where: { spaceId: scope.spaceId, state: 'ACTIVE' },
      })) >= 1000
    )
      throw new ConflictException();
    const rule = ReminderRuleSchema.parse({
      version: 1,
      kind: 'LOCAL',
      startDate: schedule.startDate,
      time: schedule.startTime,
      recurrence: {
        version: 1,
        frequency:
          schedule.kind === 'WEEKDAYS' ? 'SELECTED_WEEKDAYS' : schedule.kind,
        weekdays: schedule.weekdays ?? [],
        until: schedule.endDate ?? null,
      },
    });
    const row = old[0]
      ? await tx.reminder.update({
          where: { id: old[0].id },
          data: {
            title,
            rule: rule as Prisma.InputJsonValue,
            timezone: schedule.timezone,
            state: 'ACTIVE',
            nextAt: null,
            sourceStamp: null,
            cursorDate: null,
            exhausted: false,
            canceledAt: null,
            revision: { increment: 1 },
            ruleVersion: { increment: 1 },
          },
        })
      : await tx.reminder.create({
          data: {
            spaceId: scope.spaceId,
            ownerUserId: scope.actor.userId,
            createdByUserId: scope.actor.userId,
            routineId,
            title,
            rule: rule as Prisma.InputJsonValue,
            timezoneMode: 'FIXED',
            timezone: schedule.timezone,
            channels: ['IN_APP'],
          },
        });
    await appendOutbox(tx, scope, {
      type: 'reminder.changed',
      version: 1,
      aggregateId: row.id,
      payload: {},
    });
    await writeAudit(tx, {
      action: 'REMINDER_CHANGE',
      outcome: 'SUCCEEDED',
      actorUserId: scope.actor.userId,
      resourceId: row.id,
      requestId: scope.actor.requestId,
      correlationId: scope.actor.correlationId,
    });
  }
}
