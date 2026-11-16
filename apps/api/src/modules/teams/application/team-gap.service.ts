import { createHash } from 'node:crypto';
import { TeamProjects } from '../../projects/public/index.js';
import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { SharedTaskWork } from '../../tasks/public/index.js';
import { TeamInteractionContext } from './team-interaction.context.js';
import type { Interaction, Member } from './team-interaction.context.js';
import { TeamInsightsService } from './team-insights.service.js';
import { addDays } from '../domain/collaboration.js';
import { dayBoundary } from '../../calendar/public/index.js';
import { forecastPeriod } from '../domain/capacity-template.js';

function templateView(value: unknown) {
  const parsed = c.TeamWeeklyCapacityStoredSchema.safeParse(value);
  if (!parsed.success) return null;
  const { version: _version, ...template } = parsed.data;
  return template;
}
@Injectable()
export class TeamGapService {
  constructor(
    @Inject(TeamProjects) private readonly projects: TeamProjects,
    @Inject(TeamInteractionContext) private readonly op: TeamInteractionContext,
    @Inject(SharedTaskWork) private readonly work: SharedTaskWork,
    @Inject(TeamInsightsService) private readonly insights: TeamInsightsService,
  ) {}
  private async capacityMember(s: Interaction, accessId: string) {
    const m = (await this.op.kernel.currentMemberships(s.tx, s.a, s.id)).find(
      (m) => m.id === accessId && m.state === 'ACTIVE',
    );
    const me = this.op.access(s);
    if (
      !m ||
      (me.role === 'VIEWER' && accessId !== me.accessId) ||
      !(await this.op.kernel.visibleWorkMember(
        s.tx,
        s.a,
        s.id,
        m.id,
        m.generation,
      ))
    )
      throw new NotFoundException();
    return { accessId: m.id, generation: m.generation };
  }
  weekly(actor: RequestActor, id: string, accessId: string) {
    return this.op.read(actor, id, async (s) => {
      const member = await this.capacityMember(s, accessId);
      const row = await s.tx.teamMemberProfile.findUnique({
        where: {
          spaceId_accessId_generation: {
            spaceId: this.op.scope(s).spaceId,
            ...member,
          },
        },
      });
      return c.TeamWeeklyCapacitySchema.parse({
        member,
        template: templateView(row?.capacityTemplate),
        revision: row?.capacityRevision ?? 1,
      });
    });
  }
  setWeekly(
    actor: RequestActor,
    id: string,
    accessId: string,
    revision: number,
    input: z.infer<typeof c.TeamWeeklyCapacityInputSchema>,
  ) {
    const body = c.TeamWeeklyCapacityInputSchema.parse(input);
    return this.op.write(
      actor,
      id,
      'work.manage',
      [],
      'team.capacity.weekly',
      accessId,
      async (s) => {
        const member = await this.capacityMember(s, accessId),
          scope = this.op.scope(s);
        const row = await s.tx.teamMemberProfile.findUnique({
          where: {
            spaceId_accessId_generation: { spaceId: scope.spaceId, ...member },
          },
        });
        this.op.match(row?.capacityRevision ?? 1, revision);
        await s.begin();
        const updated = row
          ? await s.tx.teamMemberProfile.update({
              where: { id: row.id },
              data: {
                capacityTemplate: { ...body, version: 1 },
                capacityRevision: { increment: 1 },
                revision: { increment: 1 },
                updatedAt: s.now,
              },
            })
          : await s.tx.teamMemberProfile.create({
              data: {
                id: randomUUID(),
                ...scope,
                ...member,
                capacityTemplate: { ...body, version: 1 },
                capacityRevision: 2,
                updatedAt: s.now,
              },
            });
        return c.TeamWeeklyCapacitySchema.parse({
          member,
          template: templateView(updated.capacityTemplate),
          revision: updated.capacityRevision,
        });
      },
    );
  }
  async availability(
    actor: RequestActor,
    id: string,
    q: z.infer<typeof c.TeamCapacitySummaryQuerySchema>,
    forecast = false,
  ) {
    const hints = await this.op.kernel.readableContextHints(actor, 'PROJECT');
    const refs = await this.projects.candidates(id, hints.ids);
    if (refs.length > 100) throw new PayloadTooLargeException();
    return this.op.read(
      actor,
      id,
      async (s) => {
        const capacity = await this.insights.capacityInTransaction(
          s.tx,
          s.a,
          id,
          q,
        );
        const memberKeys = new Set(
          capacity.members.map(
            (m) => m.member.accessId + ':' + m.member.generation,
          ),
        );
        const assignments = await s.tx.teamTaskAssignment.findMany({
          where: { ...this.op.scope(s), state: 'ACCEPTED' },
          take: 10001,
        });
        if (assignments.length > 10000) throw new PayloadTooLargeException();
        const metrics = new Map(
          (await this.work.scopeMetrics(s.tx, s.a, id)).map((t) => [
            t.taskId,
            t,
          ]),
        );
        const unknown = new Map<string, number>();
        let missingEstimates = 0;
        for (const r of assignments) {
          const memberKey = r.assigneeAccessId + ':' + r.assigneeGeneration,
            t = metrics.get(r.taskId);
          if (
            !memberKeys.has(memberKey) ||
            !t ||
            !['OPEN', 'IN_PROGRESS'].includes(t.status) ||
            t.estimatedMinutes !== null
          )
            continue;
          if (
            t.scheduledDate &&
            (t.scheduledDate < q.from || t.scheduledDate > q.to)
          )
            continue;
          missingEstimates++;
          if (t.scheduledDate) {
            const key = memberKey + ':' + t.scheduledDate;
            unknown.set(key, (unknown.get(key) ?? 0) + 1);
          } else
            for (const m of capacity.members.filter(
              (m) => m.member.accessId === r.assigneeAccessId,
            ))
              for (const d of m.days) {
                const key = memberKey + ':' + d.date;
                unknown.set(key, (unknown.get(key) ?? 0) + 1);
              }
        }
        const projectAllocations: z.infer<
          typeof c.TeamAvailabilitySchema
        >['projectAllocations'] = [];
        const byUser = new Map<string, Member>();
        for (const m of capacity.members) {
          const user = await this.op.kernel.memberUserInTransaction(
            s.tx,
            id,
            m.member.accessId,
          );
          if (user) byUser.set(user, m.member);
        }
        for (const ref of await this.projects.candidates(id, hints.ids, s.tx)) {
          if (
            !s.a.has(s.tx, ref.spaceId, 'task.read', undefined, ref.projectId)
          )
            continue;
          const p = await this.projects.analytics(
            s.tx,
            s.a,
            id,
            ref.projectId,
            {
              fromDate: q.from,
              toDate: addDays(q.to, 1),
              timezone: q.timezone,
              from: new Date(dayBoundary(q.from, q.timezone)),
              to: new Date(dayBoundary(addDays(q.to, 1), q.timezone)),
            },
          );
          const tasks = new Map(p.tasks.map((t) => [t.taskId, t]));
          for (const alloc of p.allocations) {
            const user = await this.op.kernel.memberUserInTransaction(
                s.tx,
                ref.projectId,
                alloc.accessId,
              ),
              member = user ? byUser.get(user) : undefined;
            const task = tasks.get(alloc.taskId);
            if (member && task && ['OPEN', 'IN_PROGRESS'].includes(task.status))
              projectAllocations.push({
                member,
                date: alloc.date.toISOString().slice(0, 10),
                projectId: ref.projectId,
                taskId: alloc.taskId,
                plannedMinutes: alloc.plannedMinutes,
              });
          }
        }
        if (projectAllocations.length > 10000)
          throw new PayloadTooLargeException();
        const result = {
          hiddenProjectWork: 'UNKNOWN' as const,
          projectAllocations,
          basis:
            'EXPLICIT_TEAM_CAPACITY_APPROVED_TIME_OFF_AND_VISIBLE_TEAM_WORK' as const,
          personalAvailability: 'UNKNOWN' as const,
          busyIntervals: 'UNKNOWN' as const,
          asOf: s.now.toISOString(),
          capacity,
          missingEstimates,
        };
        if (!forecast) return c.TeamAvailabilitySchema.parse(result);
        return c.TeamForecastSchema.parse({
          ...result,
          advisory: true,
          periods: capacity.members.flatMap((m) =>
            m.days.map((d) => ({
              member: m.member,
              date: d.date,
              ...forecastPeriod(
                d.netAvailableMinutes,
                d.reservedMinutes +
                  projectAllocations
                    .filter(
                      (p) =>
                        p.member.accessId === m.member.accessId &&
                        p.member.generation === m.member.generation &&
                        p.date === d.date,
                    )
                    .reduce((n, p) => n + p.plannedMinutes, 0),
                unknown.get(
                  m.member.accessId + ':' + m.member.generation + ':' + d.date,
                ) ?? 0,
              ),
            })),
          ),
        });
      },
      [],
      refs.map((r) => ({
        spaceId: r.spaceId,
        scopeId: r.projectId,
        capability: 'task.read' as const,
        allowArchived: true,
      })),
    );
  }
  async sprintCapacity(actor: RequestActor, id: string, planId: string) {
    return this.op.read(actor, id, async (s) =>
      this.sprintCapacityView(s, planId),
    );
  }
  private async sprintCapacityView(s: Interaction, planId: string) {
    const p = await s.tx.teamPlan.findFirst({
      where: { ...this.op.scope(s), id: planId, kind: 'SPRINT' },
    });
    if (!p) throw new NotFoundException();
    const items = await s.tx.teamWorkItem.findMany({
      where: {
        ...this.op.scope(s),
        planId,
        sourceScopeId: s.id,
        taskId: { not: null },
        Task: { deletedAt: null },
      },
      take: 2001,
    });
    if (items.length > 2000) throw new PayloadTooLargeException();
    const taskIds = [...new Set(items.map((i) => i.taskId!))];
    const points = await s.tx.teamTaskPoints.findMany({
      where: { ...this.op.scope(s), taskId: { in: taskIds } },
    });
    const values = new Map(points.map((r) => [r.taskId, r.points]));
    const committedPoints = taskIds.reduce(
      (n, t) => n + (values.get(t) ?? 0),
      0,
    );
    const unestimatedTasks = taskIds.filter(
      (t) => values.get(t) == null,
    ).length;
    return c.TeamSprintCapacitySchema.parse({
      sourceBasis: 'TEAM_OWNED_TASKS',
      planId,
      revision: p.revision,
      capacityPoints: p.capacityPoints,
      committedPoints,
      unestimatedTasks,
      remainingPoints:
        p.capacityPoints === null || unestimatedTasks
          ? null
          : p.capacityPoints - committedPoints,
    });
  }
  setSprintCapacity(
    actor: RequestActor,
    id: string,
    planId: string,
    revision: number,
    input: z.infer<typeof c.TeamSprintCapacityInputSchema>,
  ) {
    const body = c.TeamSprintCapacityInputSchema.parse(input);
    return this.op.write(
      actor,
      id,
      'work.manage',
      [],
      'team.plan.capacity',
      planId,
      async (s) => {
        const p = await s.tx.teamPlan.findFirst({
          where: { ...this.op.scope(s), id: planId, kind: 'SPRINT' },
        });
        if (!p) throw new NotFoundException();
        this.op.match(p.revision, revision);
        if (p.state === 'CLOSED') throw new ConflictException();
        await s.begin();
        await s.tx.teamPlan.update({
          where: { id: planId, revision },
          data: {
            capacityPoints: body.capacityPoints,
            revision: { increment: 1 },
          },
        });
        return this.sprintCapacityView(s, planId);
      },
    );
  }
  async activity(
    actor: RequestActor,
    id: string,
    q: z.infer<typeof c.TeamHistoryQuerySchema>,
  ) {
    const hints = await this.op.kernel.readableContextHints(actor, 'PROJECT');
    const refs = await this.projects.candidates(id, hints.ids);
    if (refs.length > 100) throw new PayloadTooLargeException();
    return this.op.read(
      actor,
      id,
      async (s) => {
        const visibleProjects = (
          await this.projects.candidates(id, hints.ids, s.tx)
        )
          .filter((r) =>
            s.a.has(s.tx, r.spaceId, 'task.read', undefined, r.projectId),
          )
          .map((r) => r.projectId);
        // Deliberate allowlist: confidential cases, disclosure, feedback and proofs never enter this feed.
        const prefixes = [
          'team.create',
          'team.update',
          'team.settings',
          'team.task.',
          'team.plan.',
          'team.work.',
          'team.backlog.',
          'team.file',
          'team.capacity.',
        ];
        const me = this.op.access(s),
          manager = ['OWNER', 'ADMIN', 'LEAD'].includes(me.role ?? '');
        if (manager)
          prefixes.push('membership.', 'invitation.', 'team.timeoff.');
        return this.op.page(
          s,
          'team-activity:' +
            createHash('sha256')
              .update(
                JSON.stringify([
                  q.action,
                  q.resourceId,
                  hints.stamp,
                  visibleProjects,
                ]),
              )
              .digest('hex')
              .slice(0, 24),
          q,
          async (after) => {
            const rows = await s.tx.sharedAuditEvent.findMany({
              where: {
                ...this.op.scope(s),
                OR: [
                  ...prefixes.map((p) => ({ action: { startsWith: p } })),
                  ...[id, ...visibleProjects].map((scopeId) => ({
                    action: { startsWith: 'team.item.' },
                    details: { path: ['sourceScopeId'], equals: scopeId },
                  })),
                  {
                    action: { startsWith: 'team.project.' },
                    resourceId: { in: visibleProjects },
                  },
                ],
                ...(q.action ? { action: q.action } : {}),
                ...(q.resourceId ? { resourceId: q.resourceId } : {}),
                ...(after ? { id: { gt: after } } : {}),
              },
              orderBy: { id: 'asc' },
              take: q.limit + 1,
            });
            const items = [];
            for (const r of rows) {
              items.push(
                c.TeamRecordedActivitySchema.parse({
                  id: r.id,
                  actorId: r.actorId,
                  at: r.occurredAt.toISOString(),
                  action: r.action,
                  resourceId: r.resourceId,
                  changedFields: [],
                  detailsBasis: 'RECORDED_METADATA_ONLY',
                }),
              );
            }
            return items;
          },
        );
      },
      [],
      refs.map((r) => ({
        spaceId: r.spaceId,
        scopeId: r.projectId,
        capability: 'task.read' as const,
        allowArchived: true,
      })),
    );
  }
}
