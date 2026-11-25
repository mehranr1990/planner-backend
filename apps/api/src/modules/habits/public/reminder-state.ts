import { HabitMetadataFields } from '@mehran/api-contracts';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { due, units } from '../domain/habits.js';
import type { Definition } from '../domain/habits.js';

/** Read only under the caller's current Personal owner fence. No habit content escapes. */
export async function habitReminderState(
  tx: Prisma.TransactionClient,
  scope: AuthorizedSpace,
  id: string,
  date: string,
) {
  const habit = await tx.habit.findFirst({
    where: { spaceId: scope.spaceId, id },
  });
  if (!habit) return null;
  const reminder = HabitMetadataFields.reminder.parse(habit.reminder);
  if (!reminder) return null;
  const schedule = await tx.habitSchedule.findFirst({
    where: {
      spaceId: scope.spaceId,
      habitId: id,
      effectiveFrom: { lte: new Date(date + 'T00:00:00Z') },
    },
    orderBy: { revision: 'desc' },
  });
  if (
    !schedule ||
    schedule.status !== 'ACTIVE' ||
    !due(schedule.definition as Definition, date)
  )
    return null;
  const entries = await tx.habitEntry.findMany({
    where: {
      spaceId: scope.spaceId,
      habitId: id,
      localDate: new Date(date + 'T00:00:00Z'),
      current: true,
      state: 'RECORDED',
    },
    select: { kind: true, value: true },
  });
  return {
    timezone: schedule.timezone,
    time: reminder.time,
    skip:
      entries.some((e) => e.kind === 'SKIP') ||
      (reminder.ifNotDone &&
        entries.reduce(
          (total, e) => total + (e.value ? units(e.value.toString()) : 0n),
          0n,
        ) >= units(schedule.target.toString())),
  };
}
