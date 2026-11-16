import { observedMinutes } from '../domain/capacity-template.js';
import { addDays } from '../domain/collaboration.js';
import { dayBoundary } from '../../calendar/public/index.js';
import {
  Inject,
  Injectable,
  ConflictException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { SharedKernel } from '../../spaces/public/index.js';
import { TeamProjects } from '../../projects/public/index.js';
import { SharedCalendar } from '../../calendar/public/index.js';
import { SharedTasks, SharedTaskWork } from '../../tasks/public/index.js';
import { MeetingKernel } from '../../meetings/public/index.js';
import { TeamsService } from './teams.service.js';
import { TeamInsightsService } from './team-insights.service.js';
const hash = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');

@Injectable()
export class TeamSourceViewsService {
  constructor(
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
    @Inject(TeamProjects) private readonly projects: TeamProjects,
    @Inject(SharedCalendar) private readonly calendar: SharedCalendar,
    @Inject(SharedTasks) private readonly tasks: SharedTasks,
    @Inject(SharedTaskWork) private readonly work: SharedTaskWork,
    @Inject(MeetingKernel) private readonly meetings: MeetingKernel,
    @Inject(TeamsService) private readonly teams: TeamsService,
    @Inject(TeamInsightsService) private readonly insights: TeamInsightsService,
  ) {}
  async sources(
    actor: RequestActor,
    id: string,
    q:
      | z.infer<typeof c.TeamSourceQuerySchema>
      | z.infer<typeof c.TeamSourceCalendarQuerySchema>,
    kind: 'TASK' | 'CALENDAR' | 'OCCUPANCY',
  ) {
    await this.teams.hint(id);
    const hints = await this.kernel.readableContextHints(actor, 'PROJECT'),
      refs = await this.projects.candidates(id, hints.ids);
    if (refs.length > 100) throw new PayloadTooLargeException();
    return this.kernel.run(
      actor,
      { userIds: [], spaceIds: [id, ...refs.map((r) => r.spaceId)] },
      [
        {
          spaceId: id,
          scopeId: id,
          capability: 'task.read',
          allowArchived: true,
        },
        ...refs.map((r) => ({
          spaceId: r.spaceId,
          scopeId: r.projectId,
          capability: 'task.read' as const,
          allowArchived: true,
        })),
      ],
      async (tx, a) => {
        if (
          JSON.stringify(await this.projects.candidates(id, hints.ids, tx)) !==
          JSON.stringify(refs)
        )
          throw new ConflictException();
        const scope = this.kernel.scopeCursor(
          tx,
          a,
          { spaceId: id, scopeId: id, capability: 'task.read' },
          'team-sources:' +
            kind +
            ':' +
            hash({
              ...q,
              after: undefined,
              cursor: undefined,
              hints: hints.stamp,
              refs,
            }).slice(0, 24),
        );
        const after = (
          kind === 'TASK'
            ? this.kernel.cursorPosition.bind(this.kernel)
            : this.kernel.opaquePosition.bind(this.kernel)
        )(
          scope.context,
          scope.stamp,
          actor.userId,
          'after' in q ? q.after : 'cursor' in q ? q.cursor : undefined,
        );
        const sources = [
          { kind: 'TEAM' as const, scopeId: id, spaceId: a.space(tx, id) },
          ...refs.map((r) => ({
            kind: 'PROJECT' as const,
            scopeId: r.projectId,
            spaceId: r.spaceId,
          })),
        ].filter((s) => q.source === 'ALL' || s.kind === q.source);
        if (kind === 'TASK') {
          const query = c.TeamSourceQuerySchema.parse(q),
            rows = [];
          for (const source of sources) {
            let position: string | undefined;
            for (let i = 0; i < 101; i++) {
              const page = await this.tasks.list(tx, a, source.scopeId, {
                limit: 100,
                ...(position ? { after: position } : {}),
              });
              for (const task of page.items)
                if (!query.status || task.status === query.status)
                  rows.push({ ...source, visibility: 'FULL' as const, task });
              if (rows.length > 10000) throw new PayloadTooLargeException();
              if (!page.nextCursor) break;
              if (i === 100) throw new PayloadTooLargeException();
              position = page.nextCursor;
            }
          }
          const unique = [
            ...new Map(
              rows.map((r) => [r.spaceId + ':' + r.task.id, r]),
            ).values(),
          ].sort((a, b) => a.task.id.localeCompare(b.task.id));
          const selected = unique
            .filter((r) => !after || r.task.id > after)
            .slice(0, query.limit + 1);
          const page = this.kernel.cursorPage(
            scope.context,
            scope.stamp,
            actor.userId,
            {
              items: selected.slice(0, query.limit),
              nextCursor:
                selected.length > query.limit
                  ? selected[query.limit - 1]!.task.id
                  : null,
            },
          );
          return c.TeamVisibleTasksSchema.parse({
            ...page,
            hiddenWork: 'UNKNOWN',
          });
        }
        const query = c.TeamSourceCalendarQuerySchema.parse(q),
          rows: z.infer<typeof c.TeamSourceCalendarSchema>['items'] = [];
        for (const source of sources) {
          const excludeEventIds = await this.meetings.calendarPrivacy(
            tx,
            a,
            source.scopeId,
          );
          let cursor: string | undefined;
          for (let i = 0; i < 101; i++) {
            const page = c.CalendarViewSchema.parse(
              await this.calendar.run(tx, a, actor, source.scopeId, {
                kind: 'VIEW',
                query: {
                  from: query.from,
                  to: query.to,
                  timezone: query.timezone,
                  limit: '100',
                  ...(cursor ? { cursor } : {}),
                },
                excludeEventIds,
              }),
            );
            rows.push(
              ...page.items.map((occurrence) => ({ ...source, occurrence })),
            );
            if (rows.length > 10000) throw new PayloadTooLargeException();
            if (!page.nextCursor) break;
            if (i === 100) throw new PayloadTooLargeException();
            cursor = page.nextCursor;
          }
        }
        const key = (r: (typeof rows)[number]) =>
          r.occurrence.displayStart +
          ':' +
          r.scopeId +
          ':' +
          r.occurrence.identity;
        const unique = [
          ...new Map(
            rows.map((r) => [r.scopeId + ':' + r.occurrence.identity, r]),
          ).values(),
        ].sort((a, b) => key(a).localeCompare(key(b)));
        if (kind === 'OCCUPANCY') {
          const active = unique.filter(
            (r) =>
              r.occurrence.kind === 'EVENT' && r.occurrence.status === 'ACTIVE',
          );
          const intervals = active.flatMap((r) => {
            const schedule = r.occurrence.schedule;
            if (schedule.kind === 'TIMED')
              return schedule.startAt && schedule.endAt
                ? [
                    {
                      startedAt: new Date(schedule.startAt),
                      endedAt: new Date(schedule.endAt),
                    },
                  ]
                : [];
            return [
              {
                startedAt: new Date(
                  dayBoundary(schedule.startDate, schedule.timezone),
                ),
                endedAt: new Date(
                  dayBoundary(schedule.endDate, schedule.timezone),
                ),
              },
            ];
          });
          const now = (
            await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() now`
          )[0]!.now;
          return c.TeamCalendarOccupancySchema.parse({
            from: query.from,
            to: query.to,
            timezone: query.timezone,
            asOf: now.toISOString(),
            basis: 'UNION_OF_AUTHORIZED_ACTIVE_CALENDAR_OCCURRENCES',
            visibleEvents: active.length,
            unknownIntervals: active.length - intervals.length,
            occupiedMinutes: observedMinutes(
              intervals,
              dayBoundary(query.from, query.timezone),
              dayBoundary(query.to, query.timezone),
            ),
          });
        }
        const limit = Number(query.limit ?? 25),
          selected = unique
            .filter((r) => !after || key(r) > after)
            .slice(0, limit + 1);
        return c.TeamSourceCalendarSchema.parse({
          items: selected.slice(0, limit),
          nextCursor: this.kernel.opaqueCursor(
            scope.context,
            scope.stamp,
            actor.userId,
            selected.length > limit ? key(selected[limit - 1]!) : null,
          ),
        });
      },
    );
  }
  async crossWorkload(
    actor: RequestActor,
    query: z.infer<typeof c.TeamCrossWorkloadQuerySchema>,
  ) {
    const q = c.TeamCrossWorkloadQuerySchema.parse(query),
      hints = await this.kernel.readableContextHints(actor, 'TEAM');
    if (hints.ids.length > 100) throw new PayloadTooLargeException();
    if (!hints.ids.length)
      return c.TeamCrossWorkloadSchema.parse({
        asOf: new Date().toISOString(),
        basis: 'REQUESTER_OWN_VISIBLE_TEAM_ASSIGNMENTS_DISTINCT_TASKS',
        capacityBasis: 'INDEPENDENT_TEAM_BUDGETS_NO_SHARED_PERSONAL_CAPACITY',
        personalAvailability: 'UNKNOWN',
        items: [],
        knownEstimatedMinutes: 0,
        unknownEstimates: 0,
        recordedMinutes: 0,
        allocatedProjectMinutes: 0,
        distinctTasks: 0,
        capacityMinutes: null,
      });
    const projectHints = await this.kernel.readableContextHints(
      actor,
      'PROJECT',
    );
    const refs = [];
    for (const teamId of hints.ids)
      for (const ref of await this.projects.candidates(
        teamId,
        projectHints.ids,
      ))
        refs.push({ ...ref, teamId });
    const uniqueRefs = [...new Map(refs.map((r) => [r.projectId, r])).values()];
    if (uniqueRefs.length > 100) throw new PayloadTooLargeException();
    return this.kernel.run(
      actor,
      {
        userIds: [],
        spaceIds: [...hints.ids, ...uniqueRefs.map((r) => r.spaceId)],
      },
      [
        ...hints.ids.map((id) => ({
          spaceId: id,
          scopeId: id,
          capability: 'task.read' as const,
          allowArchived: true,
        })),
        ...uniqueRefs.map((r) => ({
          spaceId: r.spaceId,
          scopeId: r.projectId,
          capability: 'task.read' as const,
          allowArchived: true,
        })),
      ],
      async (tx, a) => {
        const items = [],
          distinct = new Map<string, number | null>();
        let capacityMinutes: number | null = 0;
        const recorded: { startedAt: Date; endedAt: Date }[] = [];
        let allocatedProjectMinutes = 0;
        const from = new Date(dayBoundary(q.from, q.timezone)),
          to = new Date(dayBoundary(addDays(q.to, 1), q.timezone));
        for (const id of hints.ids) {
          const me = a.require(tx, id, 'task.read');
          const visible = await this.work.scopeMetrics(tx, a, id);
          recorded.push(
            ...(
              await this.work.taskEffort(
                tx,
                a,
                id,
                visible.map((t) => t.taskId),
                from,
                to,
              )
            ).filter(
              (l) =>
                l.accessId === me.accessId && l.generation === me.generation,
            ),
          );
          const capacity = await this.insights.capacityInTransaction(
            tx,
            a,
            id,
            q,
          );
          capacity.members = capacity.members.filter(
            (m) =>
              m.member.accessId === me.accessId &&
              m.member.generation === me.generation,
          );
          // Recompute totals from the requester's own rows; colleague totals never leave this endpoint.
          const own = capacity.members[0];
          if (own) capacity.totals = own.totals;
          else {
            capacity.totals = {
              availableMinutes: 0,
              unknownDays: 1,
              timeOffMinutes: 0,
              netAvailableMinutes: 0,
              reservedMinutes: 0,
              actualMinutes: 0,
              bookedBasisPoints: null,
            };
          }
          items.push({ teamId: id, capacity });
          if (!own || own.totals.unknownDays) capacityMinutes = null;
          else if (capacityMinutes !== null)
            capacityMinutes += own.totals.netAvailableMinutes;
          const assignments = await tx.teamTaskAssignment.findMany({
            where: {
              spaceId: a.space(tx, id),
              scopeId: id,
              assigneeAccessId: me.accessId,
              assigneeGeneration: me.generation,
              state: 'ACCEPTED',
            },
            take: 10001,
          });
          if (assignments.length > 10000) throw new PayloadTooLargeException();
          const metrics = await this.work.metrics(tx, a, id, [
            ...new Set(assignments.map((r) => r.taskId)),
          ]);
          for (const t of metrics)
            if (
              ['OPEN', 'IN_PROGRESS'].includes(t.status) &&
              (!t.scheduledDate ||
                (t.scheduledDate >= q.from && t.scheduledDate <= q.to))
            )
              distinct.set(
                a.space(tx, id) + ':' + t.taskId,
                t.estimatedMinutes,
              );
        }
        for (const ref of uniqueRefs) {
          const p = await this.projects.analytics(
            tx,
            a,
            ref.teamId,
            ref.projectId,
            {
              fromDate: q.from,
              toDate: addDays(q.to, 1),
              timezone: q.timezone,
              from: new Date(dayBoundary(q.from, q.timezone)),
              to: new Date(dayBoundary(addDays(q.to, 1), q.timezone)),
            },
          );
          const me = a.require(
            tx,
            ref.spaceId,
            'task.read',
            undefined,
            ref.projectId,
          );
          const projectLogs = await this.work.taskEffort(
            tx,
            a,
            ref.projectId,
            p.tasks.map((t) => t.taskId),
            from,
            to,
          );
          recorded.push(
            ...projectLogs.filter(
              (l) =>
                l.accessId === me.accessId && l.generation === me.generation,
            ),
          );
          allocatedProjectMinutes += p.allocations
            .filter(
              (r) =>
                r.accessId === me.accessId && r.generation === me.generation,
            )
            .reduce((n, r) => n + r.plannedMinutes, 0);
          const assigned = new Set(
            p.allocations
              .filter(
                (r) =>
                  r.accessId === me.accessId && r.generation === me.generation,
              )
              .map((r) => r.taskId),
          );
          for (const t of p.tasks)
            if (
              assigned.has(t.taskId) &&
              ['OPEN', 'IN_PROGRESS'].includes(t.status)
            )
              distinct.set(p.spaceId + ':' + t.taskId, t.estimatedMinutes);
        }
        const now = (
          await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() now`
        )[0]!.now;
        return c.TeamCrossWorkloadSchema.parse({
          asOf: now.toISOString(),
          basis: 'REQUESTER_OWN_VISIBLE_TEAM_ASSIGNMENTS_DISTINCT_TASKS',
          capacityBasis: 'INDEPENDENT_TEAM_BUDGETS_NO_SHARED_PERSONAL_CAPACITY',
          personalAvailability: 'UNKNOWN',
          items,
          knownEstimatedMinutes: [...distinct.values()].reduce<number>(
            (n, v) => n + (v ?? 0),
            0,
          ),
          unknownEstimates: [...distinct.values()].filter((v) => v === null)
            .length,
          recordedMinutes: observedMinutes(recorded, +from, +to),
          allocatedProjectMinutes,
          distinctTasks: distinct.size,
          capacityMinutes: hints.ids.length > 1 ? null : capacityMinutes,
        });
      },
    );
  }
}
