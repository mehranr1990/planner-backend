import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import type {
  Prisma,
  DailyPlan as DatabaseDay,
} from '../../../generated/prisma/client.js';
import type {
  Availability,
  ReviewCreate,
  ReviewQuery,
} from '@mehran/api-contracts';
import { DatabaseService } from '../../../platform/database/database.service.js';
import { scopedWhere } from '../../../platform/database/scoped-where.js';
import { idempotent } from '../../../platform/database/idempotency.js';
import type { MutationReceipt } from '../../../platform/database/idempotency.js';
import {
  cursorPosition,
  cursorPage,
  afterCursor,
} from '../../../platform/database/cursor-pagination.js';
import { writeAudit } from '../../../platform/audit/audit.service.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { PlanningTasks } from '../../tasks/public/index.js';
import { PlanningPreferences } from '../../account/public/index.js';
import type {
  PlanningPort,
  PlanningTransaction,
  PlanningAudit,
} from '../application/planning.port.js';
import type {
  Day,
  ItemWrite,
  Review,
  Preferences,
} from '../domain/planning.js';
import { addDays } from '../domain/planning.js';
const date = (value: string) => new Date(value + 'T00:00:00Z');
function times<T extends { createdAt: Date; updatedAt: Date }>(row: T) {
  const { createdAt, updatedAt, ...data } = row;
  return {
    ...data,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
}
const dayView = (row: DatabaseDay): Day => ({
  ...times(row),
  localDate: row.localDate.toISOString().slice(0, 10),
});
class PlanningStore implements PlanningTransaction {
  constructor(
    private readonly tx: Prisma.TransactionClient,
    private readonly scope: AuthorizedSpace,
    private readonly taskReader: PlanningTasks,
    private readonly account: PlanningPreferences,
  ) {}
  private where<T extends object>(where: T) {
    return scopedWhere(this.scope, where);
  }
  private owner() {
    return {
      spaceId: this.scope.spaceId,
      createdByUserId: this.scope.actor.userId,
    };
  }
  preferences() {
    return this.account.read(this.tx, this.scope);
  }
  setAvailability(revision: number, availability: Availability | null) {
    return this.account.setAvailability(
      this.tx,
      this.scope,
      revision,
      availability,
    );
  }
  tasks(ids: string[]) {
    return this.taskReader.describe(this.tx, this.scope, ids);
  }
  async day(localDate: string) {
    const row = await this.tx.dailyPlan.findFirst({
      where: this.where({ localDate: date(localDate) }),
    });
    return row ? dayView(row) : null;
  }
  async createDay(localDate: string, timezone: string) {
    return dayView(
      await this.tx.dailyPlan.create({
        data: { ...this.owner(), localDate: date(localDate), timezone },
      }),
    );
  }
  async items(planId: string) {
    const rows = await this.tx.dailyPlanItem.findMany({
      where: this.where({ planId }),
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
    return rows.map(
      ({ spaceId: _spaceId, planId: _planId, localDate: _localDate, ...row }) =>
        times(row),
    );
  }
  async writeDay(day: Day, items: ItemWrite[], increment = true) {
    const before = await this.items(day.id),
      lookup = new Map(before.map((item) => [item.taskId, item]));
    await this.tx.dailyPlanItem.deleteMany({
      where: this.where({
        planId: day.id,
        taskId: { notIn: items.map((item) => item.taskId) },
      }),
    });
    // Reserve a disjoint range so the scoped unique order index also protects reorders.
    await this.tx.dailyPlanItem.updateMany({
      where: this.where({ planId: day.id }),
      data: { position: { increment: 100 } },
    });
    for (const [position, item] of items.entries()) {
      const old = lookup.get(item.taskId);
      if (old) {
        const changed =
          old.position !== position ||
          old.plannedMinutes !== item.plannedMinutes ||
          old.selectedTaskRevision !== item.selectedTaskRevision;
        await this.tx.dailyPlanItem.updateMany({
          where: this.where({ id: old.id, revision: old.revision }),
          data: {
            ...item,
            position,
            ...(changed
              ? { revision: { increment: 1 } }
              : { updatedAt: new Date(old.updatedAt) }),
          },
        });
      } else
        await this.tx.dailyPlanItem.create({
          data: {
            ...item,
            spaceId: this.scope.spaceId,
            planId: day.id,
            localDate: date(day.localDate),
            position,
          },
        });
    }
    if (increment) {
      const result = await this.tx.dailyPlan.updateMany({
        where: this.where({ id: day.id, revision: day.revision }),
        data: { revision: { increment: 1 } },
      });
      if (result.count !== 1) throw new ConflictException();
    }
    return (await this.day(day.localDate))!;
  }
  async touchWeeks(dates: string[]) {
    if (!dates.length) return;
    await this.tx.weeklyPlan.updateMany({
      where: this.where({
        OR: [...new Set(dates)].map((value) => ({
          weekStartDate: { lte: date(value), gte: date(addDays(value, -6)) },
        })),
      }),
      data: { revision: { increment: 1 } },
    });
  }
  async week(weekStartDate: string) {
    const row = await this.tx.weeklyPlan.findFirst({
      where: this.where({ weekStartDate: date(weekStartDate) }),
    });
    return row
      ? {
          ...times(row),
          weekStartDate: row.weekStartDate.toISOString().slice(0, 10),
        }
      : null;
  }
  async createWeek(weekStartDate: string, prefs: Preferences) {
    const row = await this.tx.weeklyPlan.create({
      data: {
        ...this.owner(),
        weekStartDate: date(weekStartDate),
        timezone: prefs.timezone,
        firstDayOfWeek: prefs.firstDayOfWeek,
      },
    });
    return {
      ...times(row),
      weekStartDate: row.weekStartDate.toISOString().slice(0, 10),
    };
  }
  async review(id: string): Promise<Review> {
    const row = await this.tx.planningReview.findFirst({
      where: this.where({ id }),
    });
    if (!row) throw new NotFoundException();
    return {
      ...times(row),
      localDate: row.localDate.toISOString().slice(0, 10),
      kind: row.kind as Review['kind'],
    };
  }
  async reviews(query: ReviewQuery) {
    const context =
        'planning-reviews:' +
        createHash('sha256')
          .update(
            JSON.stringify([
              query.from ?? null,
              query.to ?? null,
              query.kind ?? null,
            ]),
          )
          .digest('hex'),
      limit = Number(query.limit ?? 25);
    const rows = await this.tx.planningReview.findMany({
      where: this.where({
        ...afterCursor(cursorPosition(this.scope, context, query.cursor)),
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.from && query.to
          ? { localDate: { gte: date(query.from), lte: date(query.to) } }
          : {}),
      }),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });
    const page = cursorPage(this.scope, context, limit, rows);
    return {
      ...page,
      items: page.items.map((row) => ({
        ...times(row),
        localDate: row.localDate.toISOString().slice(0, 10),
        kind: row.kind as Review['kind'],
      })),
    };
  }
  async createReview(
    input: ReviewCreate,
    context: { timezone: string; firstDayOfWeek: number },
  ) {
    const row = await this.tx.planningReview.create({
      data: {
        ...input,
        ...this.owner(),
        ...context,
        localDate: date(input.localDate),
      },
    });
    return this.review(row.id);
  }
  async updateReview(before: Review, reflection: string) {
    const result = await this.tx.planningReview.updateMany({
      where: this.where({ id: before.id, revision: before.revision }),
      data: { reflection, revision: { increment: 1 } },
    });
    if (result.count !== 1) throw new ConflictException();
    return this.review(before.id);
  }
  async deleteReview(before: Review) {
    if (
      (
        await this.tx.planningReview.deleteMany({
          where: this.where({ id: before.id, revision: before.revision }),
        })
      ).count !== 1
    )
      throw new ConflictException();
  }
  async audit(action: PlanningAudit, id: string) {
    await writeAudit(this.tx, {
      action,
      outcome: 'SUCCEEDED',
      actorUserId: this.scope.actor.userId,
      requestId: this.scope.actor.requestId,
      correlationId: this.scope.actor.correlationId,
      resourceId: id,
    });
  }
}
@Injectable()
export class PlanningRepository implements PlanningPort {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PlanningTasks) private readonly tasks: PlanningTasks,
    @Inject(PlanningPreferences) private readonly account: PlanningPreferences,
  ) {}
  private async store(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    await this.tasks.lock(tx, scope);
    return new PlanningStore(tx, scope, this.tasks, this.account);
  }
  run<T>(
    scope: AuthorizedSpace,
    work: (tx: PlanningTransaction) => Promise<T>,
  ) {
    return this.database.client.$transaction(
      async (tx) => work(await this.store(tx, scope)),
      { timeout: 30000 },
    );
  }
  async once(
    scope: AuthorizedSpace,
    key: string,
    request: unknown,
    work: (tx: PlanningTransaction) => Promise<Record<string, unknown>>,
  ) {
    const receipt = await idempotent(
      this.database.client,
      scope,
      'post.planning.rollover.commit',
      key,
      request,
      async (tx) => {
        const result = await work(await this.store(tx, scope));
        return {
          resultId: randomUUID(),
          statusCode: 200,
          result: JSON.parse(JSON.stringify(result)) as NonNullable<
            MutationReceipt['result']
          >,
        };
      },
    );
    return receipt.result;
  }
}
