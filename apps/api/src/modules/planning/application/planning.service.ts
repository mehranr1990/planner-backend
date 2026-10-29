import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  DailyPlanSchema,
  WeeklyPlanSchema,
  PlanningReviewSchema,
  PlanningReviewPageSchema,
  RolloverPreviewSchema,
  RolloverResultSchema,
  CapacitySchema,
  AvailabilitySchema,
} from '@mehran/api-contracts';
import type {
  SelectionPut,
  SelectionMove,
  ReviewCreate,
  ReviewQuery,
  RolloverCommit,
  CapacityQuery,
  Availability,
} from '@mehran/api-contracts';
import { PLANNING_REPOSITORY } from './planning.port.js';
import type { PlanningPort, PlanningTransaction } from './planning.port.js';
import {
  addDays,
  weekday,
  localToday,
  disposition,
  itemWrites,
  allocate,
} from '../domain/planning.js';
import type { Day, Week } from '../domain/planning.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { AuditService } from '../../../platform/audit/audit.service.js';
const expected = (value: { revision: number }, revision: number) => {
  if (value.revision !== revision) throw new ConflictException();
};
@Injectable()
export class PlanningService {
  constructor(
    @Inject(PLANNING_REPOSITORY) private readonly repository: PlanningPort,
    @Inject(AuditService) private readonly audit: Pick<AuditService, 'record'>,
  ) {}
  private async guarded<T>(scope: AuthorizedSpace, work: () => Promise<T>) {
    try {
      return await work();
    } catch (error) {
      if (error instanceof NotFoundException)
        await this.audit.record({
          action: 'ACCESS_DENIED',
          outcome: 'DENIED',
          actorUserId: scope.actor.userId,
          requestId: scope.actor.requestId,
          correlationId: scope.actor.correlationId,
        });
      throw error;
    }
  }
  private run<T>(
    scope: AuthorizedSpace,
    work: (tx: PlanningTransaction) => Promise<T>,
  ) {
    return this.guarded(scope, () => this.repository.run(scope, work));
  }
  private async day(tx: PlanningTransaction, date: string) {
    const day = await tx.day(date);
    if (!day) throw new NotFoundException();
    return day;
  }
  private async viewDay(tx: PlanningTransaction, day: Day) {
    const items = await tx.items(day.id),
      tasks = new Map(
        (await tx.tasks(items.map((item) => item.taskId))).map((task) => [
          task.id,
          task,
        ]),
      );
    const mapped = items.map((item) => ({
      ...item,
      task: tasks.get(item.taskId) ?? null,
      disposition: disposition(
        tasks.get(item.taskId),
        item.selectedTaskRevision,
      ),
    }));
    return DailyPlanSchema.parse({
      ...day,
      items: mapped.filter((item) => !item.task?.isMaster),
      blockedItems: mapped
        .filter((item) => item.task?.isMaster)
        .map((item) => ({ ...item, task: null, disposition: 'BLOCKED' })),
    });
  }
  private async viewWeek(tx: PlanningTransaction, week: Week) {
    const days = [];
    for (let index = 0; index < 7; index++) {
      const localDate = addDays(week.weekStartDate, index),
        day = await tx.day(localDate),
        items = day ? await tx.items(day.id) : [];
      const tasks = new Map(
          (await tx.tasks(items.map((item) => item.taskId))).map((task) => [
            task.id,
            task,
          ]),
        ),
        blockedCount = items.filter(
          (item) => tasks.get(item.taskId)?.isMaster,
        ).length;
      days.push({
        localDate,
        planId: day?.id ?? null,
        revision: day?.revision ?? 0,
        timezone: day?.timezone ?? null,
        selectionCount: items.length - blockedCount,
        blockedCount,
      });
    }
    return WeeklyPlanSchema.parse({ ...week, days });
  }
  private validWeek(date: string, firstDay: number) {
    if (weekday(date) !== firstDay || addDays(date, 6) > '9998-12-31')
      throw new BadRequestException();
  }
  createDay(scope: AuthorizedSpace, date: string) {
    return this.run(scope, async (tx) => {
      const prefs = await tx.preferences();
      if (await tx.day(date)) throw new ConflictException();
      const day = await tx.createDay(date, prefs.timezone);
      await tx.touchWeeks([date]);
      await tx.audit('PLANNING_DAY_CREATE', day.id);
      return this.viewDay(tx, day);
    });
  }
  getDay(scope: AuthorizedSpace, date: string) {
    return this.run(scope, async (tx) =>
      this.viewDay(tx, await this.day(tx, date)),
    );
  }
  createWeek(scope: AuthorizedSpace, date: string) {
    return this.run(scope, async (tx) => {
      const prefs = await tx.preferences();
      this.validWeek(date, prefs.firstDayOfWeek);
      if (await tx.week(date)) throw new ConflictException();
      const week = await tx.createWeek(date, prefs);
      await tx.audit('PLANNING_WEEK_CREATE', week.id);
      return this.viewWeek(tx, week);
    });
  }
  getWeek(scope: AuthorizedSpace, date: string) {
    return this.run(scope, async (tx) => {
      const week = await tx.week(date);
      if (!week) throw new NotFoundException();
      return this.viewWeek(tx, week);
    });
  }
  select(
    scope: AuthorizedSpace,
    date: string,
    taskId: string,
    revision: number,
    input: SelectionPut,
  ) {
    return this.run(scope, async (tx) => {
      const day = await this.day(tx, date);
      expected(day, revision);
      const task = (await tx.tasks([taskId]))[0];
      if (!task) throw new NotFoundException();
      expected(task, input.taskRevision);
      if (disposition(task) !== 'READY') throw new ConflictException();
      const before = await tx.items(day.id),
        old = before.find((item) => item.taskId === taskId),
        rest = itemWrites(before.filter((item) => item.taskId !== taskId));
      if (!old && rest.length >= 100) throw new ConflictException();
      const position = input.position ?? old?.position ?? rest.length;
      if (position > rest.length) throw new BadRequestException();
      rest.splice(position, 0, {
        taskId,
        plannedMinutes: input.plannedMinutes,
        selectedTaskRevision: task.revision,
      });
      if (JSON.stringify(itemWrites(before)) === JSON.stringify(rest))
        return this.viewDay(tx, day);
      const after = await tx.writeDay(day, rest);
      await tx.touchWeeks([date]);
      await tx.audit('PLANNING_SELECTION_UPDATE', day.id);
      return this.viewDay(tx, after);
    });
  }
  remove(
    scope: AuthorizedSpace,
    date: string,
    taskId: string,
    revision: number,
  ) {
    return this.run(scope, async (tx) => {
      const day = await this.day(tx, date);
      expected(day, revision);
      const before = await tx.items(day.id);
      if (!before.some((item) => item.taskId === taskId))
        throw new NotFoundException();
      const after = await tx.writeDay(
        day,
        itemWrites(before.filter((item) => item.taskId !== taskId)),
      );
      await tx.touchWeeks([date]);
      await tx.audit('PLANNING_SELECTION_REMOVE', day.id);
      return this.viewDay(tx, after);
    });
  }
  reorder(
    scope: AuthorizedSpace,
    date: string,
    revision: number,
    taskIds: string[],
  ) {
    return this.run(scope, async (tx) => {
      const day = await this.day(tx, date);
      expected(day, revision);
      const before = await tx.items(day.id),
        map = new Map(itemWrites(before).map((item) => [item.taskId, item]));
      if (taskIds.some((id) => !map.has(id))) throw new NotFoundException();
      if (taskIds.length !== before.length) throw new BadRequestException();
      if (taskIds.every((id, index) => before[index]?.taskId === id))
        return this.viewDay(tx, day);
      const after = await tx.writeDay(
        day,
        taskIds.map((id) => map.get(id)!),
      );
      await tx.touchWeeks([date]);
      await tx.audit('PLANNING_DAY_REORDER', day.id);
      return this.viewDay(tx, after);
    });
  }
  move(
    scope: AuthorizedSpace,
    date: string,
    taskId: string,
    revision: number,
    input: SelectionMove,
  ) {
    return this.run(scope, async (tx) => {
      if (date === input.targetDate) throw new BadRequestException();
      const prefs = await tx.preferences(),
        source = await this.day(tx, date);
      expected(source, revision);
      const target = await tx.day(input.targetDate);
      if ((target?.revision ?? 0) !== input.targetRevision)
        throw new ConflictException();
      const items = await tx.items(source.id),
        selection = items.find((item) => item.taskId === taskId);
      if (!selection) throw new NotFoundException();
      const task = (await tx.tasks([taskId]))[0];
      if (!task) throw new NotFoundException();
      expected(task, input.taskRevision);
      if (disposition(task, selection.selectedTaskRevision) !== 'READY')
        throw new ConflictException();
      const targetItems = target ? itemWrites(await tx.items(target.id)) : [];
      if (
        targetItems.length >= 100 ||
        targetItems.some((item) => item.taskId === taskId)
      )
        throw new ConflictException();
      const position = input.position ?? targetItems.length;
      if (position > targetItems.length) throw new BadRequestException();
      targetItems.splice(position, 0, {
        taskId,
        plannedMinutes: selection.plannedMinutes,
        selectedTaskRevision: task.revision,
      });
      const destination =
          target ?? (await tx.createDay(input.targetDate, prefs.timezone)),
        afterSource = await tx.writeDay(
          source,
          itemWrites(items.filter((item) => item.taskId !== taskId)),
        ),
        afterTarget = await tx.writeDay(
          destination,
          targetItems,
          target !== null,
        );
      await tx.touchWeeks([date, input.targetDate]);
      await tx.audit('PLANNING_SELECTION_MOVE', source.id);
      return {
        source: await this.viewDay(tx, afterSource),
        target: await this.viewDay(tx, afterTarget),
      };
    });
  }
  availability(scope: AuthorizedSpace) {
    return this.run(scope, async (tx) =>
      AvailabilitySchema.parse(await tx.preferences()),
    );
  }
  setAvailability(
    scope: AuthorizedSpace,
    revision: number,
    value: Availability | null,
  ) {
    return this.run(scope, async (tx) =>
      AvailabilitySchema.parse(await tx.setAvailability(revision, value)),
    );
  }
  createReview(scope: AuthorizedSpace, input: ReviewCreate) {
    return this.run(scope, async (tx) => {
      const prefs = await tx.preferences();
      let context = {
        timezone: prefs.timezone,
        firstDayOfWeek: prefs.firstDayOfWeek,
      };
      if (input.kind === 'WEEKLY') {
        const week = await tx.week(input.localDate);
        if (week)
          context = {
            timezone: week.timezone,
            firstDayOfWeek: week.firstDayOfWeek,
          };
        else this.validWeek(input.localDate, prefs.firstDayOfWeek);
      } else {
        const day = await tx.day(input.localDate);
        if (day) context.timezone = day.timezone;
      }
      const review = await tx.createReview(input, context);
      await tx.audit('PLANNING_REVIEW_CREATE', review.id);
      return PlanningReviewSchema.parse(review);
    });
  }
  review(scope: AuthorizedSpace, id: string) {
    return this.run(scope, async (tx) =>
      PlanningReviewSchema.parse(await tx.review(id)),
    );
  }
  reviews(scope: AuthorizedSpace, query: ReviewQuery) {
    return this.run(scope, async (tx) =>
      PlanningReviewPageSchema.parse(await tx.reviews(query)),
    );
  }
  patchReview(
    scope: AuthorizedSpace,
    id: string,
    revision: number,
    reflection: string,
  ) {
    return this.run(scope, async (tx) => {
      const before = await tx.review(id);
      expected(before, revision);
      if (before.reflection === reflection)
        return PlanningReviewSchema.parse(before);
      const result = await tx.updateReview(before, reflection);
      await tx.audit('PLANNING_REVIEW_UPDATE', id);
      return PlanningReviewSchema.parse(result);
    });
  }
  deleteReview(scope: AuthorizedSpace, id: string, revision: number) {
    return this.run(scope, async (tx) => {
      const review = await tx.review(id);
      expected(review, revision);
      await tx.deleteReview(review);
      await tx.audit('PLANNING_REVIEW_DELETE', id);
    });
  }
  preview(scope: AuthorizedSpace, fromDate: string, toDate: string) {
    return this.run(scope, async (tx) => {
      const prefs = await tx.preferences(),
        source = await this.day(tx, fromDate),
        target = await tx.day(toDate),
        sourceItems = await tx.items(source.id),
        targetIds = new Set(
          target ? (await tx.items(target.id)).map((item) => item.taskId) : [],
        ),
        tasks = new Map(
          (await tx.tasks(sourceItems.map((item) => item.taskId))).map(
            (task) => [task.id, task],
          ),
        );
      return RolloverPreviewSchema.parse({
        fromDate,
        toDate,
        sourceRevision: source.revision,
        targetRevision: target?.revision ?? 0,
        settingsRevision: prefs.revision,
        items: sourceItems.map((item) => {
          const task = tasks.get(item.taskId),
            state = disposition(task, item.selectedTaskRevision);
          return {
            taskId: item.taskId,
            taskRevision: task?.revision ?? null,
            itemRevision: item.revision,
            plannedMinutes: item.plannedMinutes,
            disposition:
              state === 'READY' && targetIds.has(item.taskId)
                ? 'ALREADY_SELECTED'
                : state,
          };
        }),
      });
    });
  }
  commit(
    scope: AuthorizedSpace,
    key: string | undefined,
    input: RolloverCommit,
  ) {
    if (!key) throw new BadRequestException();
    return this.guarded(scope, async () =>
      RolloverResultSchema.parse(
        await this.repository.once(scope, key, input, async (tx) => {
          const prefs = await tx.preferences();
          const source = await this.day(tx, input.fromDate);
          expected(source, input.sourceRevision);
          expected(prefs, input.settingsRevision);
          let target = await tx.day(input.toDate);
          const existed = target !== null;
          if ((target?.revision ?? 0) !== input.targetRevision)
            throw new ConflictException();
          const sourceItems = await tx.items(source.id),
            sourceLookup = new Map(
              sourceItems.map((item) => [item.taskId, item]),
            ),
            targetItems = target ? itemWrites(await tx.items(target.id)) : [],
            tasks = new Map(
              (await tx.tasks(sourceItems.map((item) => item.taskId))).map(
                (task) => [task.id, task],
              ),
            );
          const applied = new Set<string>(),
            results = [];
          for (const request of input.items) {
            const item = sourceLookup.get(request.taskId),
              task = tasks.get(request.taskId);
            let reason = item
              ? disposition(task, item.selectedTaskRevision)
              : ('BLOCKED' as const);
            if (
              reason === 'READY' &&
              (item!.revision !== request.itemRevision ||
                task!.revision !== request.taskRevision)
            )
              reason = 'STALE';
            if (
              reason === 'READY' &&
              targetItems.some(
                (candidate) => candidate.taskId === request.taskId,
              )
            )
              reason = 'ALREADY_SELECTED';
            if (reason === 'READY' && targetItems.length >= 100)
              reason = 'BLOCKED';
            if (reason === 'READY') {
              targetItems.push({
                taskId: request.taskId,
                plannedMinutes: item!.plannedMinutes,
                selectedTaskRevision: task!.revision,
              });
              applied.add(request.taskId);
              results.push({
                taskId: request.taskId,
                outcome: 'APPLIED',
                reason: null,
              });
            } else
              results.push({
                taskId: request.taskId,
                outcome:
                  reason === 'STALE'
                    ? 'STALE'
                    : reason === 'BLOCKED'
                      ? 'BLOCKED'
                      : 'SKIPPED',
                reason,
              });
          }
          let sourceAfter = source;
          if (applied.size) {
            target =
              target ?? (await tx.createDay(input.toDate, prefs.timezone));
            target = await tx.writeDay(target, targetItems, existed);
            if (input.mode === 'MOVE')
              sourceAfter = await tx.writeDay(
                source,
                itemWrites(
                  sourceItems.filter((item) => !applied.has(item.taskId)),
                ),
              );
            await tx.touchWeeks(
              input.mode === 'MOVE'
                ? [input.fromDate, input.toDate]
                : [input.toDate],
            );
          }
          await tx.audit('PLANNING_ROLLOVER', source.id);
          return {
            source: await this.viewDay(tx, sourceAfter),
            target: target ? await this.viewDay(tx, target) : null,
            mode: input.mode,
            succeeded: applied.size,
            skipped: input.items.length - applied.size,
            items: results,
          };
        }),
      ),
    );
  }
  capacity(scope: AuthorizedSpace, query: CapacityQuery) {
    return this.run(scope, async (tx) => {
      const prefs = await tx.preferences(),
        week = query.weekStartDate ? await tx.week(query.weekStartDate) : null;
      if (query.weekStartDate && !week)
        this.validWeek(query.weekStartDate, prefs.firstDayOfWeek);
      const start =
          query.weekStartDate ??
          query.date ??
          localToday(new Date(), prefs.timezone),
        days = [];
      for (let index = 0; index < (query.weekStartDate ? 7 : 1); index++) {
        const localDate = addDays(start, index),
          day = await tx.day(localDate),
          items = day ? await tx.items(day.id) : [];
        const tasks = new Map(
            (await tx.tasks(items.map((item) => item.taskId))).map((task) => [
              task.id,
              task,
            ]),
          ),
          included = items.filter((item) => {
            const task = tasks.get(item.taskId);
            return task && !task.isMaster;
          }),
          blockedAllocations = items.length - included.length;
        const available =
            prefs.availability?.minutesByWeekday[weekday(localDate)] ?? null,
          value = allocate(included, available);
        days.push({
          localDate,
          timezone: day?.timezone ?? week?.timezone ?? prefs.timezone,
          availableMinutes: value.availableMinutes,
          knownPlannedMinutes: value.knownPlannedMinutes,
          unknownAllocations: value.unknownAllocations,
          blockedAllocations,
        });
      }
      const availableMinutes = days.some((day) => day.availableMinutes === null)
          ? null
          : days.reduce((sum, day) => sum + day.availableMinutes!, 0),
        knownPlannedMinutes = days.reduce(
          (sum, day) => sum + day.knownPlannedMinutes,
          0,
        ),
        unknownAllocations = days.reduce(
          (sum, day) => sum + day.unknownAllocations,
          0,
        ),
        blockedAllocations = days.reduce(
          (sum, day) => sum + day.blockedAllocations,
          0,
        );
      return CapacitySchema.parse({
        kind: query.weekStartDate ? 'WEEK' : 'DAY',
        timezone: week?.timezone ?? days[0]!.timezone,
        settingsRevision: prefs.revision,
        availableMinutes,
        knownPlannedMinutes,
        unknownAllocations,
        blockedAllocations,
        remainingMinutes:
          availableMinutes === null || unknownAllocations || blockedAllocations
            ? null
            : availableMinutes - knownPlannedMinutes,
        overCapacity:
          availableMinutes === null
            ? null
            : knownPlannedMinutes > availableMinutes,
        days,
      });
    });
  }
}
