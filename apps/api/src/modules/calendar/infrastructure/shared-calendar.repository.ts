import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { SharedKernel, SharedAuthority } from '../../spaces/public/index.js';
import { PlanningTasks } from '../../tasks/public/index.js';
import { SharedCalendar } from '../public/shared-calendar.js';
import type { SharedCalendarCommand } from '../public/shared-calendar.js';
import { CalendarService } from '../application/calendar.service.js';
import type {
  SharedCalendarContext,
  CalendarPort,
} from '../application/calendar.port.js';
import { Store } from './calendar.repository.js';
import * as c from '@mehran/api-contracts';
import { policies } from '../domain/model.js';
function sharedView(value: unknown, scopeId: string): unknown {
  if (Array.isArray(value)) return value.map((v) => sharedView(v, scopeId));
  if (!value || typeof value !== 'object') return value;
  const row = value as Record<string, unknown>;
  if ('createdByUserId' in row)
    return c.TeamCalendarEventSchema.strip().parse({
      ...row,
      ...policies,
      scopeId: scopeId,
    });
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, sharedView(v, scopeId)]),
  );
}
@Injectable()
export class SharedCalendarRepository extends SharedCalendar {
  async cleanup(tx: Prisma.TransactionClient, scope: SharedCleanupScope) {
    scope.verify(tx);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'calendar:' + scope.spaceId},0))::text`;
    if (!(await sharedDeleteBatch(tx, scope, ['EventRecurrence'])))
      return false;
    const removed =
      await tx.$executeRaw`DELETE FROM "CalendarEvent" WHERE id IN (SELECT e.id FROM "CalendarEvent" e WHERE e."spaceId"=${scope.spaceId}::uuid AND (${scope.scopeId ?? null}::uuid IS NULL OR e."scopeId"=${scope.scopeId ?? null}::uuid) AND NOT EXISTS(SELECT 1 FROM "CalendarEvent" child WHERE child."spaceId"=e."spaceId" AND (child."seriesId"=e.id OR child."previousSeriesId"=e.id)) ORDER BY e.id LIMIT 200)`;
    return removed === 0;
  }
  constructor(
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
    @Inject(PlanningTasks) private readonly tasks: PlanningTasks,
  ) {
    super();
  }
  async run(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    actor: RequestActor,
    spaceId: string,
    command: SharedCalendarCommand,
  ) {
    const scopeId = a.scope(tx, spaceId);
    const actualSpaceId = a.space(tx, spaceId);
    const write = !['READ', 'LIST', 'VIEW'].includes(command.kind),
      access = a.require(tx, spaceId, write ? 'work.manage' : 'task.read');
    a.require(tx, spaceId, 'task.read');
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'calendar:' + actualSpaceId},0))::text`;
    const effect = (id: string, feature?: string) =>
      this.kernel.offerEffect(
        tx,
        actor,
        scopeId,
        access.actorId,
        feature ? 'calendar.event.create' : 'calendar.event.change',
        id,
        randomUUID(),
        feature ? { actorId: access.actorId, feature, delta: 1 } : undefined,
      );
    const scope: SharedCalendarContext = {
      shared: true,
      spaceId: actualSpaceId,
      scopeId,
      actor,
      actorId: access.actorId,
      ...('excludeEventIds' in command
        ? { excludeEventIds: command.excludeEventIds }
        : {}),
      changed: async (id) => {
        await effect(id);
      },
      creating: () =>
        this.kernel.featureGrowth(tx, actualSpaceId, 'calendar.shared-event'),
      created: async (id) => {
        await effect(id, 'calendar.shared-event');
      },
    };
    const store = new Store(tx, scope, this.tasks),
      port: CalendarPort<SharedCalendarContext> = {
        run: async (_scope, work) => work(store),
        once: async (_scope, _op, _key, _request, work) => work(store),
      };
    // The caller's kernel receipt coordinates this existing engine in the already-fenced transaction.
    const engine = new CalendarService<SharedCalendarContext>(port);
    switch (command.kind) {
      case 'CREATE':
        return sharedView(
          await engine.createEvent(scope, command.key, command.input),
          scopeId,
        );
      case 'READ':
        return sharedView(await engine.event(scope, command.id), scopeId);
      case 'PATCH':
        return sharedView(
          await engine.patchEvent(
            scope,
            command.id,
            command.revision,
            command.input,
          ),
          scopeId,
        );
      case 'DELETE':
        await engine.deleteEvent(scope, command.id, command.revision);
        return { id: command.id, removed: true };
      case 'SERIES':
        return sharedView(
          await engine.editSeries(
            scope,
            command.id,
            command.revision,
            command.key,
            command.input,
          ),
          scopeId,
        );
      case 'SERIES_RESULT': {
        const event = await engine.event(scope, command.id);
        const exception =
          command.input.scope === 'THIS_OCCURRENCE'
            ? (await store.exceptions(command.id)).find(
                (e) =>
                  e.recurrenceKey ===
                  (command.input.scope === 'THIS_OCCURRENCE'
                    ? command.input.recurrenceKey
                    : ''),
              )
            : null;
        const successor =
          command.input.scope === 'THIS_AND_FUTURE'
            ? await tx.calendarEvent.findFirst({
                where: {
                  spaceId: actualSpaceId,
                  scopeId,
                  previousSeriesId: command.id,
                },
              })
            : null;
        return sharedView(
          {
            event,
            exception: exception ?? null,
            successor: successor
              ? await engine.event(scope, successor.id)
              : null,
          },
          scopeId,
        );
      }
      case 'LIST':
        return sharedView(
          await engine.list(scope, 'EVENT', command.query),
          scopeId,
        );
      case 'VIEW':
        return engine.view(scope, command.query);
    }
  }
}
import { sharedDeleteBatch } from '../../../platform/lifecycle/shared-cleanup.js';
import type { SharedCleanupScope } from '../../../platform/lifecycle/shared-cleanup.js';
