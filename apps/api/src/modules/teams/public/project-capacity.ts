import type { Prisma } from '../../../generated/prisma/client.js';
import * as c from '@mehran/api-contracts';
import { capacityMinutes } from '../domain/capacity-template.js';
/** Narrow owning-Team capacity projection, for an already-authorized Project member. */
export async function projectMemberCapacity(
  tx: Prisma.TransactionClient,
  teamId: string,
  userId: string,
  fromDate: string,
  toDate: string,
  timezone: string,
) {
  const member = await tx.contextAccess.findFirst({
    where: {
      scopeId: teamId,
      state: 'ACTIVE',
      SharedActor: { userId, state: 'ACTIVE' },
    },
    select: { id: true, generation: true, spaceId: true },
  });
  if (!member) return null;
  const where = {
    spaceId: member.spaceId,
    scopeId: teamId,
    accessId: member.id,
    generation: member.generation,
  };
  const profile = await tx.teamMemberProfile.findFirst({ where });
  const parsed = c.TeamWeeklyCapacityStoredSchema.safeParse(
    profile?.capacityTemplate,
  );
  const days = await tx.teamCapacityDay.findMany({
    where: {
      ...where,
      timezone,
      date: { gte: new Date(fromDate), lt: new Date(toDate) },
    },
  });
  const leave = await tx.teamTimeOff.findMany({
    where: {
      ...where,
      state: 'APPROVED',
      startDate: { lt: new Date(toDate) },
      endDate: { gte: new Date(fromDate) },
    },
  });
  return {
    day(date: string) {
      const dated = days.find(
        (d) => d.date.toISOString().slice(0, 10) === date,
      );
      const minutes = capacityMinutes(
        date,
        timezone,
        undefined,
        parsed.success ? parsed.data : null,
      );
      const absences = leave.filter(
        (l) =>
          l.startDate.toISOString().slice(0, 10) <= date &&
          l.endDate.toISOString().slice(0, 10) >= date,
      );
      return {
        dated: dated ? { minutes: dated.availableMinutes } : null,
        minutes,
        fullDayOff: absences.some((l) => l.minutesPerDay === null),
        leaveMinutes: absences.reduce(
          (sum, l) => sum + (l.minutesPerDay ?? 0),
          0,
        ),
      };
    },
  };
}
