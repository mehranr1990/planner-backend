import {
  Inject,
  Injectable,
  PayloadTooLargeException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { SharedTaskWork, SharedTasks } from '../../tasks/public/index.js';
import {
  ProjectExecutionContext,
  projectWhere,
  executionHash,
} from './project-execution-context.js';
import type { ExecutionContext } from './project-execution-context.js';
import { advisoryHealth } from '../domain/project-health.js';
import { unionedWorkSeconds, cycleTime } from '../domain/project-analytics.js';
import {
  ProjectContentService,
  contentTarget,
} from './project-content.service.js';
@Injectable()
export class ProjectAnalyticsService {
  constructor(
    @Inject(ProjectExecutionContext)
    private readonly op: ProjectExecutionContext,
    @Inject(SharedTaskWork) private readonly work: SharedTaskWork,
    @Inject(SharedTasks) private readonly tasks: SharedTasks,
    @Inject(ProjectContentService)
    private readonly content: ProjectContentService,
  ) {}
  private async data(s: ExecutionContext) {
    const links = await s.tx.projectTask.findMany({
      where: { ...projectWhere(s), Task: { deletedAt: null } },
      orderBy: { taskId: 'asc' },
      take: 10001,
    });
    if (links.length > 10000) throw new PayloadTooLargeException();
    const tasks = await this.work.metrics(
      s.tx,
      s.a,
      s.pid,
      links.map((l) => l.taskId),
    );
    return { links, tasks };
  }
  order(
    actor: RequestActor,
    pid: string,
    q: z.infer<typeof c.ProjectTaskOrderQuerySchema>,
  ) {
    return this.op.read(actor, pid, [], undefined, async (s) => {
      const { links, tasks } = await this.data(s),
        visible = new Set(tasks.map((t) => t.taskId));
      const rows = links
        .filter(
          (l) =>
            visible.has(l.taskId) &&
            (!q.sectionId || l.sectionId === q.sectionId),
        )
        .sort(
          (a, b) =>
            (a.sectionId ?? '').localeCompare(b.sectionId ?? '') ||
            a.position - b.position ||
            a.taskId.localeCompare(b.taskId),
        );
      const snapshot = executionHash(
        rows.map((r) => [r.taskId, r.sectionId, r.position, r.revision]),
      );
      const result = await this.op.page(
        s,
        'task-order:' + snapshot,
        q,
        async (after) => {
          const start = after
            ? rows.findIndex((r) => r.taskId === after) + 1
            : 0;
          return rows.slice(start, start + q.limit + 1).map((r) => ({
            id: r.taskId,
            sectionId: r.sectionId,
            position: r.position,
            revision: tasks.find((t) => t.taskId === r.taskId)!.sourceRevision,
          }));
        },
      );
      return c.ProjectTaskOrderSchema.parse(result);
    });
  }
  health(actor: RequestActor, pid: string) {
    return this.op.read(actor, pid, [], undefined, async (s) => {
      const { tasks } = await this.data(s),
        p = await s.tx.project.findUniqueOrThrow({ where: { id: pid } }),
        live = tasks.filter(
          (t) => t.status === 'OPEN' || t.status === 'IN_PROGRESS',
        );
      return c.ProjectHealthSchema.parse(
        advisoryHealth(
          tasks,
          p.endDate?.toISOString().slice(0, 10) ?? null,
          await this.work.blocked(
            s.tx,
            s.a,
            pid,
            live.map((t) => t.taskId),
          ),
          s.now,
        ),
      );
    });
  }
  report(
    actor: RequestActor,
    pid: string,
    q: z.infer<typeof c.ProjectReportWindowSchema>,
  ) {
    return this.op.read(actor, pid, [], undefined, async (s) => {
      const { tasks } = await this.data(s),
        ids = tasks.map((t) => t.taskId),
        from = new Date(q.fromAt),
        to = new Date(q.toAt),
        fromMs = from.getTime(),
        toMs = to.getTime();
      const starts = await this.work.firstStarted(s.tx, s.a, pid, ids),
        logs = await this.work.taskEffort(s.tx, s.a, pid, ids, from, to);
      const done = tasks.filter(
        (t) =>
          t.status === 'DONE' &&
          t.completedAt &&
          Date.parse(t.completedAt) >= fromMs &&
          Date.parse(t.completedAt) < toMs,
      );
      const overdue = (t: (typeof tasks)[number]) =>
        ['OPEN', 'IN_PROGRESS'].includes(t.status) &&
        t.dueAt !== null &&
        Date.parse(t.dueAt) < s.now.getTime();
      const assignments = await s.tx.taskAssignment.findMany({
        where: {
          ...projectWhere(s),
          taskId: { in: ids },
          kind: 'PRIMARY',
          decision: 'ACCEPTED',
          endedAt: null,
        },
        take: 10001,
      });
      if (assignments.length > 10000) throw new PayloadTooLargeException();
      const people = new Map<
        string,
        { accessId: string; generation: number; ids: Set<string> }
      >();
      for (const a of assignments) {
        if (
          !(await this.op.kernel.visibleWorkMember(
            s.tx,
            s.a,
            pid,
            a.recipientAccessId,
            a.recipientGeneration,
          ))
        )
          continue;
        const key = a.recipientAccessId + ':' + a.recipientGeneration,
          row = people.get(key) ?? {
            accessId: a.recipientAccessId,
            generation: a.recipientGeneration,
            ids: new Set<string>(),
          };
        row.ids.add(a.taskId);
        people.set(key, row);
      }
      const assignees = [...people.values()].map((p) => {
        const selected = tasks.filter((t) => p.ids.has(t.taskId));
        return {
          accessId: p.accessId,
          generation: p.generation,
          taskCount: selected.length,
          completedTasks: done.filter((t) => p.ids.has(t.taskId)).length,
          overdueTasks: selected.filter(overdue).length,
          estimatedMinutes: selected.reduce(
            (n, t) => n + (t.estimatedMinutes ?? 0),
            0,
          ),
          unknownEstimates: selected.filter((t) => t.estimatedMinutes === null)
            .length,
          recordedSeconds: unionedWorkSeconds(
            logs.filter(
              (l) => l.accessId === p.accessId && l.generation === p.generation,
            ),
            from,
            to,
          ),
        };
      });
      const weeklyThroughput = [];
      for (let start = fromMs; start < toMs; start += 7 * 86400000) {
        const end = Math.min(start + 7 * 86400000, toMs);
        weeklyThroughput.push({
          fromAt: new Date(start).toISOString(),
          toAt: new Date(end).toISOString(),
          completedTasks: done.filter(
            (t) =>
              Date.parse(t.completedAt!) >= start &&
              Date.parse(t.completedAt!) < end,
          ).length,
        });
      }
      const due = done.filter((t) => t.dueAt !== null),
        onTime = due.filter(
          (t) => Date.parse(t.completedAt!) <= Date.parse(t.dueAt!),
        ).length;
      return c.ProjectAnalyticsSchema.parse({
        projectId: pid,
        ...q,
        asOf: s.now.toISOString(),
        basis:
          'CURRENT_VISIBLE_TASKS_CURRENT_PRIMARY_ASSIGNEES_AND_SHARED_LOGS',
        cycleBasis:
          'FIRST_RECORDED_IN_PROGRESS_TO_CURRENT_DONE_INCLUDES_REOPEN_INTERVALS',
        recordedWorkBasis: 'UNION_PER_RECORDED_MEMBER',
        taskCount: tasks.length,
        completedTasks: done.length,
        overdueTasks: tasks.filter(overdue).length,
        estimatedMinutes: tasks.reduce(
          (n, t) => n + (t.estimatedMinutes ?? 0),
          0,
        ),
        unknownEstimates: tasks.filter((t) => t.estimatedMinutes === null)
          .length,
        recordedSeconds: unionedWorkSeconds(logs, from, to),
        onTime: {
          completedWithDueDate: due.length,
          completedOnTime: onTime,
          percent: due.length
            ? Math.round((onTime * 10000) / due.length) / 100
            : null,
        },
        cycleTime: cycleTime(done, starts),
        weeklyThroughput,
        assignees,
      });
    });
  }
  activity(
    actor: RequestActor,
    pid: string,
    q: z.infer<typeof c.ProjectDetailedActivityQuerySchema>,
    scopeOnly = false,
  ) {
    return this.op.read(
      actor,
      pid,
      [],
      undefined,
      async (s) => {
        const { after: _after, ...filters } = q;
        return c.ProjectDetailedActivitySchema.parse(
          await this.op.page(
            s,
            'detailed-activity:' + executionHash({ filters, scopeOnly }),
            q,
            async (after) => {
              const result: z.infer<
                typeof c.ProjectDetailedActivitySchema
              >['items'] = [];
              let position = after
                ? await s.tx.projectActivity.findFirst({
                    where: { ...projectWhere(s), id: after },
                    select: { id: true, createdAt: true },
                  })
                : null;
              if (after && !position)
                throw new BadRequestException({ code: 'INVALID_CURSOR' });
              let scanned = 0;
              for (;;) {
                const rows = await s.tx.projectActivity.findMany({
                  where: {
                    ...projectWhere(s),
                    ...(position
                      ? {
                          OR: [
                            { createdAt: { lt: position.createdAt } },
                            {
                              createdAt: position.createdAt,
                              id: { lt: position.id },
                            },
                          ],
                        }
                      : {}),
                    ...(q.taskId ? { taskId: q.taskId } : {}),
                    ...(q.actorId ? { actorId: q.actorId } : {}),
                    ...(q.action ? { action: q.action } : {}),
                    ...(scopeOnly
                      ? {
                          action: {
                            ...(q.action ? { equals: q.action } : {}),
                            in: [
                              'task.create',
                              'task.delete',
                              'project.metadata.update',
                              'project.association.change',
                              'project.phases.create',
                              'project.phases.update',
                              'project.phases.delete',
                              'project.sections.create',
                              'project.sections.update',
                              'project.sections.delete',
                              'project.milestones.create',
                              'project.milestones.update',
                              'project.milestones.delete',
                            ],
                          },
                        }
                      : {}),
                  },
                  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                  take: 100,
                });
                scanned += rows.length;
                if (scanned > 10000)
                  throw new PayloadTooLargeException({
                    code: 'ACTIVITY_FILTER_TOO_BROAD',
                  });
                for (const row of rows) {
                  if (
                    row.action.startsWith('workflow.draft.') &&
                    !s.a.has(s.tx, pid, 'workflow.publish')
                  )
                    continue;
                  const parent = contentTarget(row);
                  try {
                    await this.content.authorize(s, parent);
                  } catch (error) {
                    if (!(error instanceof NotFoundException)) throw error;
                    if (!(scopeOnly && row.action === 'task.delete')) continue;
                  }
                  if (
                    row.action.startsWith('file.') &&
                    !s.a.has(s.tx, pid, 'file.read')
                  )
                    continue;
                  let title: string | null = null;
                  if (row.taskId && row.action !== 'task.delete')
                    title = (await this.tasks.read(s.tx, s.a, pid, row.taskId))
                      .title;
                  else if (parent.kind === 'PROJECT')
                    title = (
                      await s.tx.project.findUniqueOrThrow({
                        where: { id: pid },
                      })
                    ).title;
                  const parsed =
                    c.ProjectDetailedActivitySchema.shape.items.element.shape.changes.safeParse(
                      row.details &&
                        typeof row.details === 'object' &&
                        !Array.isArray(row.details)
                        ? row.details.changes
                        : [],
                    );
                  const allowed = new Set([
                    'title',
                    'status',
                    'priority',
                    'position',
                    'sectionId',
                    'parentTaskId',
                    'phaseId',
                    'startDate',
                    'endDate',
                    'targetDate',
                    'completed',
                    'statusNote',
                    'manualStatus',
                    'key',
                    'color',
                  ]);
                  const changes = parsed.success
                      ? parsed.data.filter((d) => allowed.has(d.field))
                      : [],
                    status = changes.find((d) => d.field === 'status');
                  const kind = scopeOnly
                    ? ('SCOPE_CHANGED' as const)
                    : status?.to === 'DONE'
                      ? ('TASK_COMPLETED' as const)
                      : status
                        ? ('TASK_STATUS' as const)
                        : changes.some((d) => d.field === 'statusNote')
                          ? ('STATUS_NOTE' as const)
                          : row.action.startsWith('project.milestones.') &&
                              changes.some(
                                (d) => d.field === 'completed' && d.to === true,
                              )
                            ? ('MILESTONE_REACHED' as const)
                            : row.action.startsWith('comment.') ||
                                row.action.startsWith('file.') ||
                                row.action.startsWith('document.')
                              ? ('CONTENT' as const)
                              : ('OTHER' as const);
                  const entityType = row.action.startsWith('project.phases.')
                    ? 'PHASE'
                    : row.action.startsWith('project.sections.')
                      ? 'SECTION'
                      : row.action.startsWith('project.milestones.')
                        ? 'MILESTONE'
                        : row.action.startsWith('file.')
                          ? 'FILE'
                          : row.action.startsWith('workflow.')
                            ? 'WORKFLOW'
                            : row.action.startsWith('register.')
                              ? 'REGISTER_ITEM'
                              : parent.kind;
                  const entityId =
                    entityType === parent.kind ? parent.id : row.resourceId;
                  if (entityId !== parent.id) title = null;
                  result.push({
                    id: row.id,
                    actorId: row.actorId,
                    action: row.action,
                    entityType,
                    entityId,
                    at: row.createdAt.toISOString(),
                    target: { id: entityId, title },
                    changes,
                    kind,
                  });
                  if (result.length > q.limit) return result;
                }
                if (rows.length < 100) return result;
                position = rows.at(-1)!;
              }
            },
          ),
        );
      },
      ['file.read', 'workflow.publish'],
    );
  }
  structure(actor: RequestActor, pid: string) {
    return this.op.read(actor, pid, [], undefined, async (s) => {
      const { links, tasks } = await this.data(s),
        phases = await s.tx.projectPhase.findMany({
          where: projectWhere(s),
          take: 10001,
        }),
        milestones = await s.tx.projectMilestone.findMany({
          where: projectWhere(s),
          take: 10001,
        }),
        sections = await s.tx.projectSection.findMany({
          where: projectWhere(s),
          take: 10001,
        });
      if (phases.length + milestones.length + sections.length > 10000)
        throw new PayloadTooLargeException();
      const items = [
        ...phases.map((p) => ({
          id: p.id,
          kind: 'PHASE' as const,
          title: p.title,
          phaseId: null,
          startDate: p.startDate?.toISOString().slice(0, 10) ?? null,
          endDate: p.endDate?.toISOString().slice(0, 10) ?? null,
          status: null,
          revision: p.revision,
        })),
        ...milestones.map((m) => ({
          id: m.id,
          kind: 'MILESTONE' as const,
          title: m.title,
          phaseId: m.phaseId,
          startDate: null,
          endDate: m.targetDate?.toISOString().slice(0, 10) ?? null,
          status: m.completed ? ('COMPLETED' as const) : ('OPEN' as const),
          revision: m.revision,
        })),
      ].map((p) => {
        const ids = new Set(
          links
            .filter((l) =>
              p.kind === 'MILESTONE'
                ? l.milestoneId === p.id
                : sections.some(
                    (sc) => sc.id === l.sectionId && sc.phaseId === p.id,
                  ) ||
                  milestones.some(
                    (m) => m.id === l.milestoneId && m.phaseId === p.id,
                  ),
            )
            .map((l) => l.taskId),
        );
        const selected = tasks.filter((t) => ids.has(t.taskId)),
          eligible = selected.filter((t) => t.status !== 'CANCELED'),
          completed = eligible.filter((t) => t.status === 'DONE').length;
        return {
          ...p,
          totalTasks: selected.length,
          eligibleTasks: eligible.length,
          openTasks: eligible.length - completed,
          completedTasks: completed,
          progressPercent: eligible.length
            ? Math.round((completed * 10000) / eligible.length) / 100
            : null,
        };
      });
      return c.ProjectStructureProgressSchema.parse({
        asOf: s.now.toISOString(),
        items,
      });
    });
  }
}
