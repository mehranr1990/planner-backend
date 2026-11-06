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
function sharedView(value: unknown, spaceId: string): unknown {
  if (Array.isArray(value)) return value.map((v) => sharedView(v, spaceId));
  if (!value || typeof value !== 'object') return value;
  const row = value as Record<string, unknown>;
  if ('createdByUserId' in row)
    return c.TeamCalendarEventSchema.strip().parse({
      ...row,
      ...policies,
      scopeId: spaceId,
    });
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, sharedView(v, spaceId)]),
  );
}
@Injectable()
export class SharedCalendarRepository extends SharedCalendar {
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
    const write = !['READ', 'LIST', 'VIEW'].includes(command.kind),
      access = a.require(tx, spaceId, write ? 'work.manage' : 'task.read');
    a.require(tx, spaceId, 'task.read');
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'calendar:' + spaceId},0))::text`;
    const effect = (id: string, feature?: string) =>
      this.kernel.offerEffect(
        tx,
        actor,
        spaceId,
        access.actorId,
        feature ? 'calendar.event.create' : 'calendar.event.change',
        id,
        randomUUID(),
        feature ? { actorId: access.actorId, feature, delta: 1 } : undefined,
      );
    const scope: SharedCalendarContext = {
      shared: true,
      spaceId,
      actor,
      actorId: access.actorId,
      changed: async (id) => {
        await effect(id);
      },
      creating: () =>
        this.kernel.featureGrowth(tx, spaceId, 'calendar.shared-event'),
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
          spaceId,
        );
      case 'READ':
        return sharedView(await engine.event(scope, command.id), spaceId);
      case 'PATCH':
        return sharedView(
          await engine.patchEvent(
            scope,
            command.id,
            command.revision,
            command.input,
          ),
          spaceId,
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
          spaceId,
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
                  spaceId,
                  scopeId: spaceId,
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
          spaceId,
        );
      }
      case 'LIST':
        return sharedView(
          await engine.list(scope, 'EVENT', command.query),
          spaceId,
        );
      case 'VIEW':
        return engine.view(scope, command.query);
    }
  }
}
