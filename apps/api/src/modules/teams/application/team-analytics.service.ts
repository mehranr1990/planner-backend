import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type {
  Prisma,
  TeamCapacityDay,
} from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { SharedKernel, SharedAuthority } from '../../spaces/public/index.js';
import type { SharedRequest } from '../../spaces/public/index.js';
import { SharedTaskWork } from '../../tasks/public/index.js';
import { SharedGoals } from '../../goals/public/index.js';
import { TeamProjects } from '../../projects/public/index.js';
import { dayBoundary } from '../../calendar/public/index.js';
import { TeamsService } from './teams.service.js';
import { summarizeWork } from '../domain/analytics.js';
type Tx = Prisma.TransactionClient;
type Query = z.infer<typeof c.TeamAnalyticsQuerySchema>;
const hash = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
const request = (
  id: string,
  capability: SharedRequest['capability'] = 'task.read',
): SharedRequest => ({ spaceId: id, scopeId: id, capability });
const view = (r: TeamCapacityDay) =>
  c.TeamCapacitySchema.parse({
    id: r.id,
    teamId: r.spaceId,
    member: { accessId: r.accessId, generation: r.generation },
    date: r.date.toISOString().slice(0, 10),
    timezone: r.timezone,
    availableMinutes: r.availableMinutes,
    revision: r.revision,
  });
function bounded(n: number) {
  if (n > 10000) throw new PayloadTooLargeException();
}
@Injectable()
export class TeamAnalyticsService {
  constructor(
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
    @Inject(TeamsService) private readonly teams: TeamsService,
    @Inject(TeamProjects) private readonly projects: TeamProjects,
    @Inject(SharedTaskWork) private readonly work: SharedTaskWork,
    @Inject(SharedGoals) private readonly goals: SharedGoals,
  ) {}
  private async run<T>(
    actor: RequestActor,
    id: string,
    cap: SharedRequest['capability'],
    work: (tx: Tx, a: SharedAuthority) => Promise<T>,
    users: string[] = [],
    extra: SharedRequest[] = [],
  ) {
    await this.teams.hint(id);
    return this.kernel.run(
      actor,
      {
        userIds: users,
        spaceIds: [...new Set([id, ...extra.map((r) => r.spaceId)])],
      },
      [
        { ...request(id), allowArchived: cap === 'task.read' },
        { ...request(id, cap), allowArchived: cap === 'task.read' },
        ...extra,
      ],
      work,
    );
  }
  async capacity(
    actor: RequestActor,
    id: string,
    input: z.infer<typeof c.TeamCapacityCreateSchema>,
    revision: number | undefined,
    key?: string,
  ) {
    const body = c.TeamCapacityCreateSchema.parse(input);
    if (revision === undefined && (!key || !/^[!-~]{1,128}$/.test(key)))
      throw new BadRequestException();
    await this.teams.hint(id);
    const user = await this.kernel.memberUserHint(id, body.member.accessId);
    return this.run(
      actor,
      id,
      'work.manage',
      async (tx, a) => {
        const currentUser = await this.kernel.memberUserInTransaction(
          tx,
          id,
          body.member.accessId,
        );
        if (!user || currentUser !== user) throw new NotFoundException();
        await this.kernel.toolParticipant(
          tx,
          id,
          body.member.accessId,
          body.member.generation,
          user,
          ['task.read'],
        );
        const mutate = async () => {
          const old = await tx.teamCapacityDay.findFirst({
            where: { id: body.id, spaceId: id },
          });
          if (
            revision === undefined
              ? old !== null
              : !old || old.revision !== revision
          )
            throw new ConflictException();
          if (
            old &&
            (old.accessId !== body.member.accessId ||
              old.generation !== body.member.generation ||
              old.date.toISOString().slice(0, 10) !== body.date ||
              old.timezone !== body.timezone)
          )
            throw new ConflictException();
          if (!old) {
            if (
              await tx.teamCapacityDay.findFirst({
                where: {
                  OR: [
                    { id: body.id },
                    {
                      spaceId: id,
                      accessId: body.member.accessId,
                      generation: body.member.generation,
                      date: new Date(body.date),
                      timezone: body.timezone,
                    },
                  ],
                },
              })
            )
              throw new ConflictException();
            await this.kernel.featureGrowth(tx, id, 'team.capacity-day');
          }
          const row = old
            ? await tx.teamCapacityDay.update({
                where: { id: body.id },
                data: {
                  availableMinutes: body.availableMinutes,
                  revision: { increment: 1 },
                },
              })
            : await tx.teamCapacityDay.create({
                data: {
                  id: body.id,
                  spaceId: id,
                  scopeId: id,
                  accessId: body.member.accessId,
                  generation: body.member.generation,
                  date: new Date(body.date),
                  timezone: body.timezone,
                  availableMinutes: body.availableMinutes,
                },
              });
          const access = a.require(tx, id, 'work.manage');
          await this.kernel.offerEffect(
            tx,
            actor,
            id,
            access.actorId,
            'team.capacity.change',
            row.id,
            randomUUID(),
            old
              ? undefined
              : {
                  actorId: access.actorId,
                  feature: 'team.capacity-day',
                  delta: 1,
                },
          );
          return { id: row.id, statusCode: 201 };
        };
        if (revision === undefined) {
          const access = a.require(tx, id, 'work.manage');
          await this.kernel.receipt(
            tx,
            a,
            request(id, 'work.manage'),
            {
              operation: 'team.capacity.create',
              key: access.generation + ':' + key!,
              fingerprint: hash(body),
            },
            mutate,
          );
        } else await mutate();
        const row = await tx.teamCapacityDay.findFirst({
          where: { id: body.id, spaceId: id },
        });
        if (!row) throw new NotFoundException();
        return view(row);
      },
      user ? [user] : [],
    );
  }
  async capacities(
    actor: RequestActor,
    id: string,
    q: z.infer<typeof c.TeamCapacityQuerySchema>,
  ) {
    return this.run(actor, id, 'task.read', async (tx, a) => {
      const cursor = this.kernel.scopeCursor(
        tx,
        a,
        request(id),
        'team-capacity:' +
          hash({
            fromDate: q.fromDate,
            toDate: q.toDate,
            timezone: q.timezone,
          }).slice(0, 24),
      );
      const after = this.kernel.cursorPosition(
        cursor.context,
        cursor.stamp,
        actor.userId,
        q.after,
      );
      const members = await this.kernel.currentMemberships(tx, a, id),
        eligible = [];
      bounded(members.length);
      for (const m of members)
        if (await this.kernel.visibleWorkMember(tx, a, id, m.id, m.generation))
          eligible.push({ accessId: m.id, generation: m.generation });
      const rows = eligible.length
        ? await tx.teamCapacityDay.findMany({
            where: {
              spaceId: id,
              timezone: q.timezone,
              date: { gte: new Date(q.fromDate), lt: new Date(q.toDate) },
              OR: eligible,
              ...(after ? { id: { gt: after } } : {}),
            },
            orderBy: { id: 'asc' },
            take: q.limit + 1,
          })
        : [];
      return this.kernel.cursorPage(
        cursor.context,
        cursor.stamp,
        actor.userId,
        {
          items: rows.slice(0, q.limit).map(view),
          nextCursor: rows.length > q.limit ? rows[q.limit - 1]!.id : null,
        },
      );
    });
  }
  async analyze(
    actor: RequestActor,
    id: string,
    query: Query,
    kind: 'portfolio' | 'workload' | 'dashboard',
  ) {
    const q = c.TeamAnalyticsQuerySchema.parse(query);
    await this.teams.hint(id);
    const hints = await this.kernel.readableContextHints(actor),
      refs = await this.projects.candidates(id, hints.ids);
    if (refs.length > 100) throw new PayloadTooLargeException();
    return this.run(
      actor,
      id,
      'task.read',
      async (tx, a) => {
        if (
          JSON.stringify(await this.projects.candidates(id, hints.ids, tx)) !==
          JSON.stringify(refs)
        )
          throw new ConflictException();
        const from = new Date(dayBoundary(q.fromDate, q.timezone)),
          to = new Date(dayBoundary(q.toDate, q.timezone));
        const asOf = (
          await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() now`
        )[0]!.now;
        const tasks = await this.work.scopeMetrics(tx, a, id);
        const logs = await this.work.effort(
          tx,
          a,
          id,
          tasks.map((t) => t.taskId),
          from,
          to,
        );
        const goalCount = await this.goals.scopeCount(tx, a, id);
        const sources: z.infer<typeof c.TeamPortfolioSourceSchema>[] = [
          {
            kind: 'TEAM' as const,
            spaceId: id,
            summary: summarizeWork(tasks, logs, goalCount, from, to, asOf),
          },
        ];
        const projects = [];
        let recordCount = tasks.length + logs.length + goalCount;
        for (const ref of refs) {
          const p = await this.projects.analytics(tx, a, id, ref.projectId, {
            ...q,
            from,
            to,
          });
          projects.push(p);
          recordCount +=
            p.tasks.length + p.logs.length + p.goalCount + p.allocations.length;
          bounded(recordCount);
          sources.push({
            kind: 'PROJECT',
            spaceId: p.spaceId,
            summary: summarizeWork(
              p.tasks,
              p.logs,
              p.goalCount,
              from,
              to,
              asOf,
            ),
          });
        }
        bounded(recordCount);
        const summary = summarizeWork([], [], 0, from, to, asOf);
        for (const s of sources) {
          for (const status of [
            'OPEN',
            'IN_PROGRESS',
            'DONE',
            'CANCELED',
          ] as const)
            summary.statusCounts[status] += s.summary.statusCounts[status];
          for (const field of [
            'taskCount',
            'estimatedMinutes',
            'unknownEstimates',
            'completedInWindow',
            'overdueTaskCount',
            'recordedSeconds',
            'workLogCount',
            'goalCount',
          ] as const)
            summary[field] += s.summary[field];
        }
        const portfolio = c.TeamPortfolioSchema.parse({
          teamId: id,
          ...q,
          asOf: asOf.toISOString(),
          window: { fromAt: from.toISOString(), toAt: to.toISOString() },
          basis: 'CURRENT_AUTHORIZED_SOURCES_AND_EXPLICIT_SHARED_WORK',
          denominator:
            'CURRENT_NONDELETED_TASKS_IN_TEAM_AND_VISIBLE_REFERENCED_PROJECTS',
          sources,
          summary,
        });
        if (kind === 'portfolio') return portfolio;
        const memberByUser = new Map<
          string,
          { accessId: string; generation: number }
        >();
        const members = await this.kernel.currentMemberships(tx, a, id);
        bounded(members.length);
        for (const m of members)
          if (
            await this.kernel.visibleWorkMember(tx, a, id, m.id, m.generation)
          ) {
            const user = await this.kernel.memberUserInTransaction(
              tx,
              id,
              m.id,
            );
            if (user)
              memberByUser.set(user, {
                accessId: m.id,
                generation: m.generation,
              });
          }
        const rows = new Map<
          string,
          z.infer<typeof c.ProjectWorkloadRowSchema> & { tasks: Set<string> }
        >();
        const get = (
          member: { accessId: string; generation: number },
          date: string,
        ) => {
          const key = member.accessId + ':' + member.generation + ':' + date;
          let row = rows.get(key);
          if (!row) {
            row = {
              member,
              date,
              capacityMinutes: null,
              allocatedMinutes: 0,
              overbookedMinutes: null,
              taskCount: 0,
              estimatedMinutes: 0,
              unknownEstimates: 0,
              tasks: new Set(),
            };
            rows.set(key, row);
          }
          return row;
        };
        const capacities = await tx.teamCapacityDay.findMany({
          where: {
            spaceId: id,
            timezone: q.timezone,
            date: { gte: new Date(q.fromDate), lt: new Date(q.toDate) },
            OR: [...memberByUser.values()],
          },
          take: 10001,
        });
        bounded(capacities.length + recordCount);
        for (const r of capacities)
          get(
            { accessId: r.accessId, generation: r.generation },
            r.date.toISOString().slice(0, 10),
          ).capacityMinutes = r.availableMinutes;
        for (const p of projects) {
          const metrics = new Map(p.tasks.map((t) => [t.taskId, t]));
          for (const alloc of p.allocations) {
            const user = await this.kernel.memberUserInTransaction(
              tx,
              p.spaceId,
              alloc.accessId,
            );
            const member = user ? memberByUser.get(user) : undefined,
              task = metrics.get(alloc.taskId);
            if (
              !member ||
              !task ||
              !['OPEN', 'IN_PROGRESS'].includes(task.status)
            )
              continue;
            const row = get(member, alloc.date.toISOString().slice(0, 10));
            row.allocatedMinutes += alloc.plannedMinutes;
            const taskKey = p.spaceId + ':' + alloc.taskId;
            if (!row.tasks.has(taskKey)) {
              row.tasks.add(taskKey);
              row.taskCount++;
              if (task.estimatedMinutes === null) row.unknownEstimates++;
              else row.estimatedMinutes += task.estimatedMinutes;
            }
          }
        }
        const workload = c.TeamWorkloadSchema.parse({
          teamId: id,
          ...q,
          basis:
            'CURRENT_TEAM_MEMBERS_AND_VISIBLE_ACCEPTED_PROJECT_ALLOCATIONS',
          rows: [...rows.values()]
            .sort(
              (a, b) =>
                a.date.localeCompare(b.date) ||
                a.member.accessId.localeCompare(b.member.accessId),
            )
            .map(({ tasks: _tasks, ...row }) => ({
              ...row,
              overbookedMinutes:
                row.capacityMinutes === null
                  ? null
                  : Math.max(0, row.allocatedMinutes - row.capacityMinutes),
            })),
        });
        if (kind === 'workload') return workload;
        const visibleItems = await tx.teamWorkItem.findMany({
          where: {
            spaceId: id,
            sourceSpaceId: { in: [id, ...refs.map((r) => r.spaceId)] },
            OR: [
              { taskId: { not: null }, Task: { deletedAt: null } },
              { goalId: { not: null } },
            ],
          },
          select: { planId: true },
          take: 10001,
        });
        bounded(visibleItems.length);
        return c.TeamDashboardSchema.parse({
          portfolio,
          workload,
          planning: {
            visibleBacklogItems: visibleItems.filter((r) => !r.planId).length,
            visiblePlannedItems: visibleItems.filter((r) => r.planId).length,
            activePlans: await tx.teamPlan.count({
              where: { spaceId: id, state: 'ACTIVE' },
            }),
          },
        });
      },
      [],
      refs.map((r) => ({ ...request(r.spaceId), allowArchived: true })),
    );
  }
}
