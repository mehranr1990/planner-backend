import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import * as c from '@mehran/api-contracts';
import { HabitsSync } from '../public/sync-access.js';
import { GoalHabits } from '../public/goal-habits.js';
import { PlanningPreferences } from '../../account/public/index.js';
import { Store } from './habits.repository.js';
import { HabitsService } from '../application/habits.service.js';
@Injectable()
export class HabitsSyncRepository extends HabitsSync {
  readonly entities = ['HABIT_ENTRY'] as const;
  constructor(
    @Inject(PlanningPreferences) private readonly prefs: PlanningPreferences,
    @Inject(GoalHabits) private readonly locks: GoalHabits,
  ) {
    super();
  }
  async command(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    op: c.SyncCommand,
  ) {
    await this.locks.lock(tx, scope);
    const store = new Store(tx, scope, this.prefs),
      service = new HabitsService({
        run: async (_s, w) => w(store),
        once: async (_s, _o, _k, _r, w) => w(store),
      });
    if (!op.parentId) throw new BadRequestException();
    let entry;
    if (op.operation === 'HABIT_LOG') {
      if (op.baseRevision !== 0) throw new ConflictException();
      entry = await service.record(
        scope,
        op.parentId,
        op.clientMutationId,
        op.body,
      );
    } else if (op.operation === 'HABIT_CORRECT' && op.resourceId)
      entry = await service.correct(
        scope,
        op.parentId,
        op.resourceId,
        op.baseRevision,
        op.body,
      );
    else throw new BadRequestException();
    return (await this.read(tx, scope, 'HABIT_ENTRY', entry.id))!;
  }
  async read(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    _entity: c.SyncEntity,
    id: string,
  ) {
    const row = await tx.habitEntry.findFirst({
      where: { spaceId: scope.spaceId, logicalId: id, current: true },
      select: { habitId: true, revision: true, state: true },
    });
    if (!row) return null;
    const data = await new Store(tx, scope, this.prefs).entry(row.habitId, id);
    return c.SyncResourceSchema.parse({
      entity: 'HABIT_ENTRY',
      id,
      revision: row.revision,
      deleted: row.state === 'VOID',
      data: row.state === 'VOID' ? null : data,
    });
  }
  async list(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    entity: c.SyncEntity,
    after: string | undefined,
    limit: number,
  ) {
    const rows = await tx.habitEntry.findMany({
      where: {
        spaceId: scope.spaceId,
        current: true,
        ...(after ? { logicalId: { gt: after } } : {}),
      },
      select: { logicalId: true },
      orderBy: { logicalId: 'asc' },
      take: limit,
    });
    return Promise.all(
      rows.map((row) =>
        this.read(tx, scope, entity, row.logicalId).then((v) => v!),
      ),
    );
  }
}
