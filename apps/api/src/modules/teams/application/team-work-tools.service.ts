import { Inject, Injectable, PayloadTooLargeException } from '@nestjs/common';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import {
  ProjectTaskTools,
  SharedTasks,
  SharedTaskWork,
} from '../../tasks/public/index.js';
import type { TaskToolContext } from '../../tasks/public/index.js';
import { SharedGoals } from '../../goals/public/index.js';
import { TeamInteractionContext } from './team-interaction.context.js';
import type { Interaction } from './team-interaction.context.js';
/**
 * Team task checklists, blockedBy dependencies, readiness and the TM-12 export
 * snapshot. Everything runs through the shared Task/dependency engines; Team
 * only adds the Team authority and projections.
 */
@Injectable()
export class TeamWorkToolsService {
  constructor(
    @Inject(TeamInteractionContext) private readonly op: TeamInteractionContext,
    @Inject(SharedTasks) private readonly tasks: SharedTasks,
    @Inject(SharedTaskWork) private readonly work: SharedTaskWork,
    @Inject(ProjectTaskTools) private readonly tools: ProjectTaskTools,
    @Inject(SharedGoals) private readonly goals: SharedGoals,
  ) {}
  private ctx(s: Interaction): TaskToolContext {
    return {
      ...this.op.scope(s),
      actor: s.actor,
      lockedUsers: s.locked,
      begin: () => s.begin(),
    };
  }
  private async checklistView(s: Interaction, taskId: string) {
    const task = await this.tasks.read(s.tx, s.a, s.id, taskId),
      items = await this.work.checklist(s.tx, s.a, s.id, taskId);
    return c.TeamChecklistSchema.parse({
      taskId,
      revision: task.revision,
      items,
      done: items.filter((i) => i.completed).length,
      total: items.length,
    });
  }
  checklist(actor: RequestActor, id: string, taskId: string) {
    return this.op.read(actor, id, (s) => this.checklistView(s, taskId));
  }
  changeChecklist(
    actor: RequestActor,
    id: string,
    taskId: string,
    revision: number,
    input: z.infer<typeof c.TeamChecklistChangeSchema>,
  ) {
    const change = c.TeamChecklistChangeSchema.parse(input);
    return this.op.write(
      actor,
      id,
      'task.update',
      [],
      'team.task.checklist',
      taskId,
      async (s) => {
        await this.work.changeChecklist(
          s.tx,
          s.a,
          this.ctx(s),
          taskId,
          revision,
          change,
        );
        return this.checklistView(s, taskId);
      },
    );
  }
  dependencies(actor: RequestActor, id: string) {
    return this.op.read(actor, id, async (s) =>
      c.DependencyGraphSchema.parse(
        await this.tools.graph(s.tx, s.a, this.ctx(s)),
      ),
    );
  }
  addDependency(
    actor: RequestActor,
    id: string,
    input: z.infer<typeof c.DependencyInputSchema>,
  ) {
    const body = c.DependencyInputSchema.parse(input);
    return this.op.write(
      actor,
      id,
      'work.manage',
      [],
      'team.task.dependency.create',
      body.id,
      async (s) =>
        c.DependencySchema.parse(
          await this.tools.dependency(s.tx, s.a, this.ctx(s), body),
        ),
    );
  }
  retireDependency(
    actor: RequestActor,
    id: string,
    dependencyId: string,
    revision: number,
  ) {
    return this.op.write(
      actor,
      id,
      'work.manage',
      [],
      'team.task.dependency.retire',
      dependencyId,
      async (s) =>
        c.DependencySchema.parse(
          await this.tools.retireDependency(
            s.tx,
            s.a,
            this.ctx(s),
            dependencyId,
            revision,
            s.now,
          ),
        ),
    );
  }
  /** blockedBy = active predecessors still OPEN/IN_PROGRESS; ready = open with none. */
  private async readinessRows(s: Interaction) {
    const metrics = await this.work.scopeMetrics(s.tx, s.a, s.id);
    if (metrics.length > 2000) throw new PayloadTooLargeException();
    const status = new Map(metrics.map((m) => [m.taskId, m.status])),
      graph = await this.tools.graph(s.tx, s.a, this.ctx(s));
    return metrics.map((m) => {
      const blockedBy = graph.edges
        .filter(
          (e) =>
            e.successorId === m.taskId &&
            ['OPEN', 'IN_PROGRESS'].includes(status.get(e.predecessorId) ?? ''),
        )
        .map((e) => e.predecessorId);
      return {
        taskId: m.taskId,
        status: m.status,
        blockedBy,
        ready:
          ['OPEN', 'IN_PROGRESS'].includes(m.status) && blockedBy.length === 0,
      };
    });
  }
  readiness(actor: RequestActor, id: string) {
    return this.op.read(actor, id, async (s) =>
      c.TeamTaskReadinessSchema.parse({ items: await this.readinessRows(s) }),
    );
  }
  /** Owner/Admin/Lead (`work.manage`); audited; bounded; Team-visible data only. */
  exportSnapshot(actor: RequestActor, id: string) {
    return this.op.write(
      actor,
      id,
      'work.manage',
      [],
      'team.export.snapshot',
      id,
      async (s) => {
        const scope = this.op.scope(s);
        const team = await s.tx.team.findFirst({
          where: { spaceId: scope.spaceId, scopeId: id },
          select: { title: true },
        });
        const members = (
          await this.op.kernel.currentMemberships(s.tx, s.a, id)
        ).filter((m) => m.state === 'ACTIVE');
        const titles = new Map(
          (
            await s.tx.teamMemberProfile.findMany({
              where: {
                ...scope,
                OR: members.map((m) => ({
                  accessId: m.id,
                  generation: m.generation,
                })),
              },
            })
          ).map((p) => [p.accessId + ':' + p.generation, p.jobTitle]),
        );
        const readiness = new Map(
          (await this.readinessRows(s)).map((r) => [r.taskId, r.blockedBy]),
        );
        const metrics = await this.work.scopeMetrics(s.tx, s.a, id);
        const points = new Map(
          (await s.tx.teamTaskPoints.findMany({ where: scope })).map((p) => [
            p.taskId,
            p.points,
          ]),
        );
        const assignments = await s.tx.teamTaskAssignment.findMany({
          where: { ...scope, state: 'ACCEPTED' },
          take: 10001,
        });
        if (assignments.length > 10000) throw new PayloadTooLargeException();
        const tasks = [];
        for (const m of metrics) {
          const task = await this.tasks.read(s.tx, s.a, id, m.taskId),
            items = await this.work.checklist(s.tx, s.a, id, m.taskId);
          tasks.push({
            id: m.taskId,
            title: task.title,
            status: m.status,
            estimatedMinutes: m.estimatedMinutes,
            points: points.get(m.taskId) ?? null,
            dueAt: m.dueAt,
            completedAt: m.completedAt,
            checklist: {
              done: items.filter((i) => i.completed).length,
              total: items.length,
            },
            assignees: assignments
              .filter((a) => a.taskId === m.taskId)
              .map((a) => ({
                accessId: a.assigneeAccessId,
                generation: a.assigneeGeneration,
              })),
            blockedBy: readiness.get(m.taskId) ?? [],
          });
        }
        const goals = [];
        for (let after: string | undefined, guard = 0; guard < 20; guard++) {
          const page = await this.goals.list(s.tx, s.a, id, {
            limit: 100,
            ...(after ? { after } : {}),
          });
          for (const g of page.items)
            goals.push({
              id: g.id,
              title: g.title,
              status: g.status,
              keyResults: await s.tx.teamKeyResult.count({
                where: { ...scope, goalId: g.id, archivedAt: null },
              }),
            });
          if (!page.nextCursor) break;
          after = page.nextCursor;
        }
        await s.begin();
        return c.TeamExportSchema.parse({
          teamId: id,
          title: team?.title ?? '',
          generatedAt: s.now.toISOString(),
          members: members.map((m) => ({
            member: { accessId: m.id, generation: m.generation },
            role: m.memberRole,
            jobTitle: titles.get(m.id + ':' + m.generation) ?? null,
          })),
          tasks,
          plans: (
            await s.tx.teamPlan.findMany({
              where: scope,
              orderBy: { startDate: 'asc' },
              take: 1000,
            })
          ).map((p) => ({
            id: p.id,
            kind: p.kind,
            title: p.title,
            state: p.state,
            startDate: p.startDate.toISOString().slice(0, 10),
            endDate: p.endDate.toISOString().slice(0, 10),
          })),
          goals,
        });
      },
    );
  }
}
