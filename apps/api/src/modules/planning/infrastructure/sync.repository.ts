import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import * as c from '@mehran/api-contracts';
import { PlanningSync } from '../public/sync-access.js';
import { PlanningTasks } from '../../tasks/public/index.js';
import { PlanningPreferences } from '../../account/public/index.js';
import {
  AuditService,
  writeAudit,
} from '../../../platform/audit/audit.service.js';
import { PlanningStore } from './planning.repository.js';
import { PlanningService } from '../application/planning.service.js';
@Injectable()
export class PlanningSyncRepository extends PlanningSync {
  readonly entities = ['DAILY_PLAN'] as const;
  constructor(
    @Inject(PlanningTasks) private readonly tasks: PlanningTasks,
    @Inject(PlanningPreferences) private readonly prefs: PlanningPreferences,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {
    super();
  }
  private service(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    const store = new PlanningStore(tx, scope, this.tasks, this.prefs);
    return new PlanningService(
      {
        run: async (_s, w) => w(store),
        once: async (_s, _k, _r, w) => w(store),
      },
      { record: (input) => writeAudit(tx, input) },
    );
  }
  async command(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    op: c.SyncCommand,
  ) {
    await this.tasks.lock(tx, scope);
    const service = this.service(tx, scope),
      date = op.localDate;
    if (!date) throw new BadRequestException();
    let plan;
    switch (op.operation) {
      case 'DAY_CREATE':
        if (op.baseRevision !== 0) throw new ConflictException();
        plan = await service.createDay(scope, date);
        break;
      case 'DAY_SELECT':
        if (!op.resourceId) throw new BadRequestException();
        plan = await service.select(
          scope,
          date,
          op.resourceId,
          op.baseRevision,
          op.body,
        );
        break;
      case 'DAY_REMOVE':
        if (!op.resourceId) throw new BadRequestException();
        plan = await service.remove(
          scope,
          date,
          op.resourceId,
          op.baseRevision,
        );
        break;
      case 'DAY_REORDER':
        plan = await service.reorder(
          scope,
          date,
          op.baseRevision,
          op.body.taskIds,
        );
        break;
      default:
        throw new BadRequestException();
    }
    return c.SyncResourceSchema.parse({
      entity: 'DAILY_PLAN',
      id: plan.id,
      revision: plan.revision,
      deleted: false,
      data: plan,
    });
  }
  async read(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    _entity: c.SyncEntity,
    id: string,
  ) {
    const row = await tx.dailyPlan.findFirst({
      where: { spaceId: scope.spaceId, id },
      select: { localDate: true },
    });
    if (!row) return null;
    const data = await this.service(tx, scope).getDay(
      scope,
      row.localDate.toISOString().slice(0, 10),
    );
    return c.SyncResourceSchema.parse({
      entity: 'DAILY_PLAN',
      id,
      revision: data.revision,
      deleted: false,
      data,
    });
  }
  async list(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    entity: c.SyncEntity,
    after: string | undefined,
    limit: number,
  ) {
    const rows = await tx.dailyPlan.findMany({
      where: {
        spaceId: scope.spaceId,
        ...(after ? { id: { gt: after } } : {}),
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: limit,
    });
    return Promise.all(
      rows.map((row) => this.read(tx, scope, entity, row.id).then((v) => v!)),
    );
  }
}
