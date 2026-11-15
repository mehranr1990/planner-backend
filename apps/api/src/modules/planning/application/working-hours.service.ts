import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { WorkingHoursPort } from './working-hours.port.js';
import {
  PersonalCapacityCalendar,
  dayBoundary,
  wallInstant,
} from '../../calendar/public/index.js';
import { measureCapacity, minutes } from '../domain/working-hours.js';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
const add = (date: string, n: number) =>
  new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000)
    .toISOString()
    .slice(0, 10);
@Injectable()
export class WorkingHoursService {
  constructor(
    @Inject(WorkingHoursPort) private readonly port: WorkingHoursPort,
    @Inject(PersonalCapacityCalendar)
    private readonly calendar: PersonalCapacityCalendar,
  ) {}
  read(scope: AuthorizedSpace) {
    return this.port.read(scope);
  }
  write(
    scope: AuthorizedSpace,
    revision: number,
    value: c.WorkingHours | null,
  ) {
    return this.port.write(scope, revision, value);
  }
  async capacity(
    scope: AuthorizedSpace,
    query: { date?: string; weekStartDate?: string },
  ) {
    const config = await this.port.read(scope),
      start = (query.date ?? query.weekStartDate)!;
    if (
      query.weekStartDate &&
      new Date(start + 'T00:00:00Z').getUTCDay() !== config.firstDayOfWeek
    )
      throw new BadRequestException();
    const busy = await this.calendar.busy(
      scope,
      start,
      add(start, query.weekStartDate ? 7 : 1),
      config.timezone,
    );
    const days: Array<z.infer<typeof c.WorkingCapacitySchema>['days'][number]> =
      [];
    for (let n = 0; n < (query.weekStartDate ? 7 : 1); n++) {
      const date = add(start, n),
        dayStart = dayBoundary(date, config.timezone),
        dayEnd = dayBoundary(add(date, 1), config.timezone);
      const clipped = busy
        .map((r) => ({
          start: Math.max(r.start, dayStart),
          end: Math.min(r.end, dayEnd),
        }))
        .filter((r) => r.end > r.start);
      const exception = config.workingHours?.exceptions.find(
        (e) => e.date === date,
      );
      const intervals =
        exception?.intervals ??
        config.workingHours?.intervalsByWeekday[
          new Date(date + 'T00:00:00Z').getUTCDay()
        ];
      const available = [];
      let gap = false;
      for (const item of intervals ?? []) {
        const startAt = wallInstant(date + 'T' + item.start, config.timezone),
          endAt = wallInstant(date + 'T' + item.end, config.timezone);
        if (!startAt || !endAt) {
          gap = true;
          break;
        }
        available.push({ start: startAt.getTime(), end: endAt.getTime() });
      }
      days.push(
        intervals && !gap
          ? {
              date,
              state: 'CONFIGURED' as const,
              ...measureCapacity(available, clipped),
            }
          : {
              date,
              state: gap ? ('DST_GAP' as const) : ('UNKNOWN' as const),
              availableMinutes: null,
              reservedMinutes: null,
              remainingMinutes: null,
              overbookedMinutes: null,
              busyMinutes: minutes(clipped),
            },
      );
    }
    const state = days.some((d) => d.state === 'DST_GAP')
      ? 'DST_GAP'
      : days.some((d) => d.state === 'UNKNOWN')
        ? 'UNKNOWN'
        : 'CONFIGURED';
    const sum = (
      key:
        | 'availableMinutes'
        | 'reservedMinutes'
        | 'remainingMinutes'
        | 'overbookedMinutes',
    ) =>
      state === 'CONFIGURED' ? days.reduce((n, d) => n + d[key]!, 0) : null;
    return c.WorkingCapacitySchema.parse({
      timezone: config.timezone,
      revision: config.revision,
      state,
      days,
      availableMinutes: sum('availableMinutes'),
      reservedMinutes: sum('reservedMinutes'),
      remainingMinutes: sum('remainingMinutes'),
      overbookedMinutes: sum('overbookedMinutes'),
    });
  }
}
