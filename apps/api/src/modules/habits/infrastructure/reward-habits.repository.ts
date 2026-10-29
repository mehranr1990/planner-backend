import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { RewardHabits } from '../public/reward-habits.js';
import { PlanningPreferences } from '../../account/public/index.js';
import { Store } from './habits.repository.js';
import {
  currentSchedule,
  localDate,
  stats,
  addDays,
} from '../domain/habits.js';
@Injectable()
export class RewardHabitsRepository extends RewardHabits {
  constructor(
    @Inject(PlanningPreferences) private readonly account: PlanningPreferences,
  ) {
    super();
  }
  async achieved(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    habitId: string,
    eventId: string,
    now: Date,
  ) {
    const changed = await tx.habitEntry.findMany({
      where: { spaceId: scope.spaceId, habitId, sourceEventId: eventId },
      select: { localDate: true },
      take: 101,
    });
    if (changed.length > 100) throw new BadRequestException();
    const store = new Store(tx, scope, this.account),
      versions = await store.schedules(habitId),
      active = currentSchedule(versions, now) ?? versions.at(-1);
    if (!active) return [];
    const dates = [
        ...new Set(changed.map((e) => e.localDate.toISOString().slice(0, 10))),
      ],
      achieved = [];
    for (const date of dates) {
      const to = addDays(date),
        entries = await store.entriesRange([habitId], date, to);
      if (
        stats(
          habitId,
          versions,
          entries,
          date,
          to,
          localDate(now, active.timezone),
        ).completed === 1
      )
        achieved.push(date);
    }
    return achieved;
  }
}
