import {
  Inject,
  Injectable,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
  ForbiddenException,
} from '@nestjs/common';
import * as c from '@mehran/api-contracts';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../../generated/prisma/client.js';
import { projectMemberCapacity } from '../../teams/public/project-capacity.js';
import { memberCapacity } from '../domain/member-capacity.js';
import type { z } from 'zod';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import { SharedTaskWork, SharedTasks } from '../../tasks/public/index.js';
import {
  ProjectExecutionContext,
  projectWhere,
  executionKey,
  executionHash,
  matchRevision,
} from './project-execution-context.js';
import type { ExecutionContext } from './project-execution-context.js';
import { recordedSeconds, taskReport } from '../domain/work-reports.js';
const capacityView = (r: {
  date: Date;
  accessId: string;
  generation: number;
}) =>
  c.ProjectCapacitySchema.strip().parse({
    ...r,
    date: r.date.toISOString().slice(0, 10),
    member: { accessId: r.accessId, generation: r.generation },
  });
const allocationView = (r: {
  date: Date;
  accessId: string;
  generation: number;
}) =>
  c.ProjectAllocationSchema.strip().parse({
    ...r,
    date: r.date.toISOString().slice(0, 10),
    member: { accessId: r.accessId, generation: r.generation },
  });
@Injectable()
export class ProjectWorkMetricsService {
  constructor(
    @Inject(ProjectExecutionContext)
    private readonly op: ProjectExecutionContext,
    @Inject(SharedTaskWork) private readonly work: SharedTaskWork,
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(SharedTasks) private readonly tasks: SharedTasks,
  ) {}
  private async checklistView(s: ExecutionContext, taskId: string) {
    const task = await this.tasks.read(s.tx, s.a, s.pid, taskId),
      items = await this.work.checklist(s.tx, s.a, s.pid, taskId);
    return c.ProjectChecklistSchema.parse({
      taskId,
      revision: task.revision,
      items,
      done: items.filter((i) => i.completed).length,
      total: items.length,
    });
  }
  checklist(actor: RequestActor, pid: string, taskId: string) {
    return this.op.read(actor, pid, [], taskId, (s) =>
      this.checklistView(s, taskId),
    );
  }
  changeChecklist(
    actor: RequestActor,
    pid: string,
    taskId: string,
    revision: number,
    input: z.infer<typeof c.ProjectChecklistChangeSchema>,
    raw: string | undefined,
  ) {
    const key = executionKey(raw),
      change = c.ProjectChecklistChangeSchema.parse(input);
    return this.op.write(
      actor,
      pid,
      ['task.update'],
      taskId,
      'task.checklist',
      taskId,
      [],
      async (s) => {
        await this.op.kernel.receipt(
          s.tx,
          s.a,
          {
            spaceId: s.spaceId,
            scopeId: s.scopeId,
            capability: 'task.update',
            resource: { kind: 'TASK', id: taskId },
          },
          {
            operation: 'project.checklist',
            key,
            fingerprint: executionHash({ taskId, revision, change }),
          },
          async () => {
            await this.work.changeChecklist(
              s.tx,
              s.a,
              s,
              taskId,
              revision,
              change,
            );
            return { id: taskId, statusCode: 200 };
          },
        );
        return this.checklistView(s, taskId);
      },
    );
  }
  records(
    actor: RequestActor,
    pid: string,
    kind: 'capacity' | 'allocations',
    q: z.infer<typeof c.ProjectWorkRecordsQuerySchema>,
  ) {
    return this.op.read(actor, pid, [], undefined, (s) =>
      this.op.page<
        | z.infer<typeof c.ProjectCapacitySchema>
        | z.infer<typeof c.ProjectAllocationSchema>
      >(
        s,
        kind +
          ':' +
          executionHash({
            from: q.fromDate,
            to: q.toDate,
            timezone: q.timezone,
          }).slice(0, 24),
        q,
        async (after) => {
          const where = {
            ...projectWhere(s),
            timezone: q.timezone,
            date: { gte: new Date(q.fromDate), lt: new Date(q.toDate) },
            ...(after ? { id: { gt: after } } : {}),
          };
          if (kind === 'capacity')
            return (
              await s.tx.projectCapacityDay.findMany({
                where,
                orderBy: { id: 'asc' },
                take: q.limit + 1,
              })
            ).map(capacityView);
          const rows = await s.tx.projectWorkAllocation.findMany({
            where: { ...where, ProjectTask: { Task: { deletedAt: null } } },
            orderBy: { id: 'asc' },
            take: q.limit + 1,
          });
          await this.work.metrics(s.tx, s.a, pid, [
            ...new Set(rows.map((r) => r.taskId)),
          ]);
          return rows.map(allocationView);
        },
      ),
    );
  }
  getRecord(
    actor: RequestActor,
    pid: string,
    kind: 'capacity' | 'allocations',
    id: string,
  ) {
    return this.op.read(actor, pid, [], undefined, async (s) => {
      if (kind === 'capacity') {
        const row = await s.tx.projectCapacityDay.findFirst({
          where: { ...projectWhere(s), id },
        });
        if (!row) throw new NotFoundException();
        return capacityView(row);
      }
      const row = await s.tx.projectWorkAllocation.findFirst({
        where: { ...projectWhere(s), id },
      });
      if (!row) throw new NotFoundException();
      await this.work.metrics(s.tx, s.a, pid, [row.taskId]);
      return allocationView(row);
    });
  }
  estimate(
    actor: RequestActor,
    pid: string,
    tid: string,
    input?: { revision: number; estimatedMinutes: number | null },
  ) {
    return input
      ? this.op.write(
          actor,
          pid,
          ['task.update'],
          tid,
          'task.estimate',
          tid,
          [],
          (s) => this.work.estimate(s.tx, s.a, s, tid, input),
        )
      : this.op.read(actor, pid, [], tid, (s) =>
          this.work.estimate(s.tx, s.a, s, tid),
        );
  }
  logs(
    actor: RequestActor,
    pid: string,
    tid: string,
    q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    return this.op.read(actor, pid, [], tid, (s) =>
      this.op.page(s, 'shared-work-logs:' + tid, q, (after) =>
        this.work.logs(s.tx, s.a, s, tid, after, q.limit + 1),
      ),
    );
  }
  record(
    actor: RequestActor,
    pid: string,
    tid: string,
    revision: number,
    input: z.infer<typeof c.SharedWorkLogCreateSchema>,
    raw: string | undefined,
  ) {
    const key = executionKey(raw),
      fingerprint = executionHash({ tid, revision, input });
    return this.op.write(
      actor,
      pid,
      ['task.update'],
      tid,
      'task.work.log.record',
      input.id,
      [],
      (s) =>
        this.work.record(s.tx, s.a, s, tid, revision, input, key, fingerprint),
      'task.shared-work-log',
    );
  }
  void(
    actor: RequestActor,
    pid: string,
    tid: string,
    id: string,
    revision: number,
  ) {
    return this.op.write(
      actor,
      pid,
      ['task.update'],
      tid,
      'task.work.log.void',
      id,
      [],
      (s) => this.work.void(s.tx, s.a, s, tid, id, revision, s.now),
    );
  }
  capacity(
    actor: RequestActor,
    pid: string,
    id: string,
    revision: number,
    input: z.infer<typeof c.ProjectCapacityInputSchema>,
  ) {
    return this.op.write(
      actor,
      pid,
      ['work.manage'],
      undefined,
      'project.capacity',
      id,
      [input.member.accessId],
      async (s) => {
        await s.member(input.member.accessId, input.member.generation);
        const row = await s.tx.projectCapacityDay.findFirst({
          where: { ...projectWhere(s), id },
        });
        if (row) {
          if (
            row.accessId !== input.member.accessId ||
            row.generation !== input.member.generation ||
            row.date.toISOString().slice(0, 10) !== input.date ||
            row.timezone !== input.timezone
          )
            throw new ConflictException();
          matchRevision(row.revision, revision);
        } else if (revision !== 0) throw new NotFoundException();
        if (!row) await s.grow('project.capacity-day');
        await s.begin();
        const data = { availableMinutes: input.availableMinutes };
        return capacityView(
          row
            ? await s.tx.projectCapacityDay.update({
                where: { id },
                data: { ...data, revision: { increment: 1 } },
              })
            : await s.tx.projectCapacityDay.create({
                data: {
                  id,
                  ...projectWhere(s),
                  ...data,
                  accessId: input.member.accessId,
                  generation: input.member.generation,
                  date: new Date(input.date),
                  timezone: input.timezone,
                },
              }),
        );
      },
    );
  }
  weekdayCapacity(
    actor: RequestActor,
    pid: string,
    accessId: string,
    generation: number,
  ) {
    return this.op.read(actor, pid, [], undefined, async (s) => {
      if (
        !(await this.op.kernel.visibleWorkMember(
          s.tx,
          s.a,
          pid,
          accessId,
          generation,
        ))
      )
        throw new NotFoundException();
      const row = await s.tx.projectMemberCapacityTemplate.findUnique({
        where: {
          projectId_accessId_generation: {
            projectId: pid,
            accessId,
            generation,
          },
        },
      });
      return c.ProjectWeekdayCapacitySchema.parse({
        projectId: pid,
        member: { accessId, generation },
        template: row?.template ?? null,
        revision: row?.revision ?? 1,
      });
    });
  }
  setWeekdayCapacity(
    actor: RequestActor,
    pid: string,
    accessId: string,
    revision: number,
    input: z.infer<typeof c.ProjectWeekdayCapacityInputSchema>,
  ) {
    const body = c.ProjectWeekdayCapacityInputSchema.parse(input);
    if (body.member.accessId !== accessId) throw new NotFoundException();
    return this.op.write(
      actor,
      pid,
      ['work.manage'],
      undefined,
      'project.capacity.weekdays',
      accessId,
      [accessId],
      async (s) => {
        await s.member(accessId, body.member.generation);
        const where = {
          projectId_accessId_generation: {
            projectId: pid,
            accessId,
            generation: body.member.generation,
          },
        };
        const before = await s.tx.projectMemberCapacityTemplate.findUnique({
          where,
        });
        matchRevision(before?.revision ?? 1, revision);
        await s.begin();
        const row = await s.tx.projectMemberCapacityTemplate.upsert({
          where,
          create: {
            id: randomUUID(),
            ...projectWhere(s),
            accessId,
            generation: body.member.generation,
            template: body.template ?? Prisma.DbNull,
          },
          update: {
            template: body.template ?? Prisma.DbNull,
            revision: { increment: 1 },
          },
        });
        return c.ProjectWeekdayCapacitySchema.parse({
          projectId: pid,
          member: body.member,
          template: row.template,
          revision: row.revision,
        });
      },
    );
  }
  async allocation(
    actor: RequestActor,
    pid: string,
    id: string,
    revision: number,
    input: z.infer<typeof c.ProjectAllocationInputSchema>,
  ) {
    this.op.kernel.assertEnabled();
    const hint = await this.db.client.taskAssignment.findFirst({
      where: { id: input.assignmentId, projectId: pid },
    });
    return this.op.write(
      actor,
      pid,
      ['work.manage'],
      undefined,
      'project.work.allocation',
      id,
      hint ? [hint.recipientAccessId] : [],
      async (s) => {
        const assignment = await s.tx.taskAssignment.findFirst({
          where: {
            ...projectWhere(s),
            id: input.assignmentId,
            decision: 'ACCEPTED',
            endedAt: null,
          },
        });
        if (!assignment) throw new NotFoundException();
        await s.member(
          assignment.recipientAccessId,
          assignment.recipientGeneration,
        );
        const task = (
          await this.work.metrics(s.tx, s.a, pid, [assignment.taskId])
        )[0]!;
        if (task.status !== 'OPEN' && task.status !== 'IN_PROGRESS')
          throw new ConflictException();
        const row = await s.tx.projectWorkAllocation.findFirst({
          where: { ...projectWhere(s), id },
        });
        if (row) {
          if (
            row.assignmentId !== assignment.id ||
            row.date.toISOString().slice(0, 10) !== input.date ||
            row.timezone !== input.timezone
          )
            throw new ConflictException();
          matchRevision(row.revision, revision);
        } else if (revision !== 0) throw new NotFoundException();
        if (!row) await s.grow('project.work-allocation');
        await s.begin();
        return allocationView(
          row
            ? await s.tx.projectWorkAllocation.update({
                where: { id },
                data: {
                  plannedMinutes: input.plannedMinutes,
                  revision: { increment: 1 },
                },
              })
            : await s.tx.projectWorkAllocation.create({
                data: {
                  id,
                  ...projectWhere(s),
                  taskId: assignment.taskId,
                  assignmentId: assignment.id,
                  accessId: assignment.recipientAccessId,
                  generation: assignment.recipientGeneration,
                  date: new Date(input.date),
                  timezone: input.timezone,
                  plannedMinutes: input.plannedMinutes,
                },
              }),
        );
      },
    );
  }
  workload(
    actor: RequestActor,
    pid: string,
    q: z.infer<typeof c.ProjectWorkloadQuerySchema>,
    selected?: { accessId: string; generation: number },
  ) {
    return this.op.read(actor, pid, [], undefined, async (s) => {
      const where = {
          ...projectWhere(s),
          timezone: q.timezone,
          date: { gte: new Date(q.fromDate), lt: new Date(q.toDate) },
        },
        capacities = await s.tx.projectCapacityDay.findMany({
          where,
          take: 10001,
        }),
        allocations = await s.tx.projectWorkAllocation.findMany({
          where,
          take: 10001,
        });
      if (capacities.length + allocations.length > 10000)
        throw new PayloadTooLargeException();
      const membership = new Map<string, Promise<boolean>>(),
        visible = (accessId: string, generation: number) => {
          const key = accessId + ':' + generation;
          if (!membership.has(key))
            membership.set(
              key,
              this.op.kernel.visibleWorkMember(
                s.tx,
                s.a,
                pid,
                accessId,
                generation,
              ),
            );
          return membership.get(key)!;
        };
      const assignments = await s.tx.taskAssignment.findMany({
          where: {
            ...projectWhere(s),
            id: { in: allocations.map((a) => a.assignmentId) },
            decision: 'ACCEPTED',
            endedAt: null,
          },
        }),
        accepted = new Set(assignments.map((a) => a.id)),
        eligible = [];
      for (const row of allocations)
        if (
          accepted.has(row.assignmentId) &&
          (await visible(row.accessId, row.generation))
        )
          eligible.push(row);
      const metrics = new Map(
          (
            await this.work.metrics(s.tx, s.a, pid, [
              ...new Set(eligible.map((r) => r.taskId)),
            ])
          ).map((t) => [t.taskId, t]),
        ),
        rows = new Map<
          string,
          z.infer<typeof c.ProjectWorkloadRowSchema> & { tasks: Set<string> }
        >();
      const get = (accessId: string, generation: number, date: Date) => {
        const d = date.toISOString().slice(0, 10),
          key = accessId + ':' + generation + ':' + d;
        let row = rows.get(key);
        if (!row) {
          row = {
            member: { accessId, generation },
            date: d,
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
      for (const r of capacities)
        if (await visible(r.accessId, r.generation))
          get(r.accessId, r.generation, r.date).capacityMinutes =
            r.availableMinutes;
      for (const r of eligible) {
        const metric = metrics.get(r.taskId)!;
        if (metric.status !== 'OPEN' && metric.status !== 'IN_PROGRESS')
          continue;
        const row = get(r.accessId, r.generation, r.date);
        row.allocatedMinutes += r.plannedMinutes;
        if (!row.tasks.has(r.taskId)) {
          row.tasks.add(r.taskId);
          row.taskCount++;
          if (metric.estimatedMinutes === null) row.unknownEstimates++;
          else row.estimatedMinutes += metric.estimatedMinutes;
        }
      }
      const project = await s.tx.project.findUniqueOrThrow({
        where: { id: pid },
        select: { keyOwnerTeamId: true },
      });
      const templates = await s.tx.projectMemberCapacityTemplate.findMany({
        where: projectWhere(s),
        take: 10001,
      });
      if (templates.length > 10000) throw new PayloadTooLargeException();
      if (selected) {
        if (!(await visible(selected.accessId, selected.generation)))
          throw new NotFoundException();
        for (
          let time = Date.parse(q.fromDate);
          time < Date.parse(q.toDate);
          time += 86400000
        )
          get(selected.accessId, selected.generation, new Date(time));
      }
      const inherited = new Map<
        string,
        Awaited<ReturnType<typeof projectMemberCapacity>>
      >();
      for (const row of rows.values()) {
        const template = templates.find(
          (t) =>
            t.accessId === row.member.accessId &&
            t.generation === row.member.generation,
        );
        const parsed = c.ProjectWeekdayCapacityTemplateSchema.safeParse(
          template?.template,
        );
        const override =
          parsed.success &&
          parsed.data.timezone === q.timezone &&
          row.date >= parsed.data.effectiveFrom
            ? parsed.data.weekdays[
                new Date(row.date + 'T00:00:00Z').getUTCDay()
              ]
            : undefined;
        const key = row.member.accessId + ':' + row.member.generation;
        if (project.keyOwnerTeamId && !inherited.has(key)) {
          const user = await this.op.kernel.memberUserInTransaction(
            s.tx,
            pid,
            row.member.accessId,
          );
          inherited.set(
            key,
            user
              ? await projectMemberCapacity(
                  s.tx,
                  project.keyOwnerTeamId,
                  user,
                  q.fromDate,
                  q.toDate,
                  q.timezone,
                )
              : null,
          );
        }
        const dated = capacities.find(
          (d) =>
            d.accessId === row.member.accessId &&
            d.generation === row.member.generation &&
            d.date.toISOString().slice(0, 10) === row.date,
        );
        row.capacityMinutes = memberCapacity(
          row.date,
          dated ? { minutes: dated.availableMinutes } : null,
          override,
          inherited.get(key)?.day(row.date) ?? null,
          project.keyOwnerTeamId !== null,
        );
      }
      return c.ProjectWorkloadSchema.parse({
        projectId: pid,
        ...q,
        basis: 'EXPLICIT_ACCEPTED_ASSIGNMENT_ALLOCATIONS',
        rows: [...rows.values()]
          .filter(
            (row) =>
              !selected ||
              (row.member.accessId === selected.accessId &&
                row.member.generation === selected.generation),
          )
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
    });
  }
  private async report(
    s: Pick<
      ExecutionContext,
      'tx' | 'a' | 'pid' | 'spaceId' | 'scopeId' | 'now'
    >,
    input: z.infer<typeof c.ProjectReportWindowSchema>,
  ) {
    const links = await s.tx.projectTask.findMany({
      where: { ...projectWhere(s), Task: { deletedAt: null } },
      orderBy: { taskId: 'asc' },
      take: 10001,
    });
    if (links.length > 10000) throw new PayloadTooLargeException();
    const ids = links.map((r) => r.taskId),
      tasks = await this.work.metrics(s.tx, s.a, s.pid, ids),
      from = new Date(input.fromAt),
      to = new Date(input.toAt),
      logs = await this.work.effort(s.tx, s.a, s.pid, ids, from, to),
      effort = recordedSeconds(logs, from, to),
      open = {
        ...projectWhere(s),
        retiredAt: null,
        status: { in: ['OPEN', 'MITIGATING'] },
      },
      openRiskCount = await s.tx.projectRiskIssue.count({
        where: { ...open, kind: 'RISK' },
      }),
      openIssueCount = await s.tx.projectRiskIssue.count({
        where: { ...open, kind: 'ISSUE' },
      });
    return {
      report: c.ProjectReportSchema.parse({
        projectId: s.pid,
        ...input,
        asOf: s.now.toISOString(),
        basis: 'CURRENT_VISIBLE_TASKS_AND_EXPLICIT_SHARED_WORK',
        ...taskReport(tasks, from, to, s.now),
        recordedSeconds: effort.seconds,
        workLogCount: effort.count,
        openRiskCount,
        openIssueCount,
      }),
      tasks,
    };
  }
  async reportAuthorized(
    tx: ExecutionContext['tx'],
    a: ExecutionContext['a'],
    pid: string,
    input: z.infer<typeof c.ProjectReportWindowSchema>,
    now: Date,
  ) {
    a.require(tx, pid, 'task.read');
    a = a.forScope(tx, a.space(tx, pid), pid);
    return (
      await this.report(
        { tx, a, pid, spaceId: a.space(tx, pid), scopeId: pid, now },
        input,
      )
    ).report;
  }
  currentReport(
    actor: RequestActor,
    pid: string,
    input: z.infer<typeof c.ProjectReportWindowSchema>,
  ) {
    return this.op.read(
      actor,
      pid,
      [],
      undefined,
      async (s) => (await this.report(s, input)).report,
    );
  }
  private async snapshot(s: ExecutionContext, id: string) {
    const r = await s.tx.projectReportSnapshot.findFirst({
      where: { ...projectWhere(s), id },
    });
    if (!r) throw new NotFoundException();
    const sources = await s.tx.projectReportSource.findMany({
      where: { ...projectWhere(s), snapshotId: id },
      take: 10001,
    });
    if (sources.length > 10000) throw new PayloadTooLargeException();
    await this.work.metrics(
      s.tx,
      s.a,
      s.pid,
      sources.map((x) => x.taskId),
    );
    return c.ProjectReportSnapshotSchema.parse({
      id,
      projectId: s.pid,
      createdByActorId: r.createdByActorId,
      createdAt: r.createdAt.toISOString(),
      report: r.report,
    });
  }
  getSnapshot(actor: RequestActor, pid: string, id: string) {
    return this.op.read(actor, pid, [], undefined, (s) => this.snapshot(s, id));
  }
  listSnapshots(
    actor: RequestActor,
    pid: string,
    query: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    return this.op.read(actor, pid, [], undefined, async (s) =>
      c.ProjectReportSnapshotPageSchema.parse(
        await this.op.page(s, 'report-snapshots', query, async (after) => {
          const items = [];
          let position = after;
          for (;;) {
            const rows = await s.tx.projectReportSnapshot.findMany({
              where: {
                ...projectWhere(s),
                ...(position ? { id: { gt: position } } : {}),
              },
              orderBy: { id: 'asc' },
              take: 100,
            });
            for (const row of rows) {
              try {
                items.push(await this.snapshot(s, row.id));
              } catch (error) {
                if (
                  !(error instanceof NotFoundException) &&
                  !(error instanceof ForbiddenException)
                )
                  throw error;
              }
              if (items.length > query.limit) return items;
            }
            if (rows.length < 100) return items;
            position = rows.at(-1)!.id;
          }
        }),
      ),
    );
  }
  createSnapshot(
    actor: RequestActor,
    pid: string,
    input: z.infer<typeof c.ProjectReportCreateSchema>,
    raw: string | undefined,
  ) {
    const creationKey = executionKey(raw),
      fingerprint = executionHash(input);
    return this.op.write(
      actor,
      pid,
      ['work.manage'],
      undefined,
      'project.report.snapshot',
      input.id,
      [],
      async (s) => {
        const old = await s.tx.projectReportSnapshot.findFirst({
          where: { ...projectWhere(s), creationKey },
        });
        if (old) {
          if (old.id !== input.id || old.fingerprint !== fingerprint)
            throw new ConflictException();
          return this.snapshot(s, old.id);
        }
        const { report, tasks } = await this.report(s, {
          fromAt: input.fromAt,
          toAt: input.toAt,
        });
        await s.grow('project.report-snapshot');
        await s.begin();
        await s.tx.projectReportSnapshot.create({
          data: {
            ...projectWhere(s),
            id: input.id,
            createdByActorId: s.a.require(s.tx, pid, 'work.manage').actorId,
            report,
            creationKey,
            fingerprint,
          },
        });
        if (tasks.length)
          await s.tx.projectReportSource.createMany({
            data: tasks.map((t) => ({
              ...projectWhere(s),
              snapshotId: input.id,
              taskId: t.taskId,
              sourceRevision: t.sourceRevision,
            })),
          });
        return this.snapshot(s, input.id);
      },
    );
  }
}
