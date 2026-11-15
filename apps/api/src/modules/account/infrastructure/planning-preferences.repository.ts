import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import {
  PlanningAvailabilitySchema,
  WorkingHoursSchema,
} from '@mehran/api-contracts';
import type { WorkingHours } from '@mehran/api-contracts';
import type { Availability } from '@mehran/api-contracts';
import { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { PlanningPreferences } from '../public/planning-preferences.js';
import { writeAudit } from '../../../platform/audit/audit.service.js';
@Injectable()
export class PlanningPreferencesRepository extends PlanningPreferences {
  async workingHours(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    const row = await tx.userSettings.findUniqueOrThrow({
      where: { userId: scope.actor.userId },
    });
    return row.workingHours === null
      ? null
      : WorkingHoursSchema.parse(row.workingHours);
  }
  async setWorkingHours(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    revision: number,
    value: WorkingHours | null,
  ) {
    await tx.$queryRaw`SELECT "userId" FROM "UserSettings" WHERE "userId"=${scope.actor.userId}::uuid FOR UPDATE`;
    const total = (intervals: Array<{ start: string; end: string }>) => {
      const minute = (v: string) =>
        Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
      const rows = intervals
        .map((i) => ({ start: minute(i.start), end: minute(i.end) }))
        .sort((a, b) => a.start - b.start);
      let end = 0,
        result = 0;
      for (const row of rows) {
        result += Math.max(0, row.end - Math.max(row.start, end));
        end = Math.max(end, row.end);
      }
      return result;
    };
    const result = await tx.userSettings.updateMany({
      where: { userId: scope.actor.userId, revision },
      data: {
        workingHours: value ?? Prisma.DbNull,
        planningAvailability: value
          ? {
              version: 1,
              minutesByWeekday: value.intervalsByWeekday.map(total),
            }
          : Prisma.DbNull,
        revision: { increment: 1 },
      },
    });
    if (result.count !== 1) throw new ConflictException();
    await writeAudit(tx, {
      action: 'ACCOUNT_PLANNING_AVAILABILITY_UPDATE',
      outcome: 'SUCCEEDED',
      actorUserId: scope.actor.userId,
      requestId: scope.actor.requestId,
      correlationId: scope.actor.correlationId,
      resourceId: scope.actor.userId,
    });
  }
  async read(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    const rows = await tx.$queryRaw<
      Array<{
        timezone: string;
        firstDayOfWeek: number;
        revision: number;
        planningAvailability: unknown;
      }>
    >`SELECT timezone,"firstDayOfWeek",revision,"planningAvailability" FROM "UserSettings" WHERE "userId"=${scope.actor.userId}::uuid FOR SHARE`;
    if (!rows[0]) throw new NotFoundException();
    const value = rows[0];
    return {
      timezone: value.timezone,
      firstDayOfWeek: value.firstDayOfWeek,
      revision: value.revision,
      availability:
        value.planningAvailability === null
          ? null
          : PlanningAvailabilitySchema.parse(value.planningAvailability),
    };
  }
  async setAvailability(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    revision: number,
    availability: Availability | null,
  ) {
    // Acquire the write lock before the snapshot; never upgrade a shared row lock
    // while an account preference writer may already be waiting for it.
    await tx.$queryRaw`SELECT "userId" FROM "UserSettings" WHERE "userId"=${scope.actor.userId}::uuid FOR UPDATE`;
    const before = await this.read(tx, scope);
    if (before.revision !== revision) throw new ConflictException();
    if (JSON.stringify(before.availability) === JSON.stringify(availability))
      return before;
    const result = await tx.userSettings.updateMany({
      where: { userId: scope.actor.userId, revision },
      data: {
        planningAvailability: availability ?? Prisma.DbNull,
        workingHours: Prisma.DbNull,
        revision: { increment: 1 },
      },
    });
    if (result.count !== 1) throw new ConflictException();
    await writeAudit(tx, {
      action: 'ACCOUNT_PLANNING_AVAILABILITY_UPDATE',
      outcome: 'SUCCEEDED',
      actorUserId: scope.actor.userId,
      requestId: scope.actor.requestId,
      correlationId: scope.actor.correlationId,
      resourceId: scope.actor.userId,
    });
    return this.read(tx, scope);
  }
}
