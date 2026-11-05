import { Inject, Injectable } from '@nestjs/common';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import {
  SharedTasks,
  SharedTaskWork,
  ProjectTaskTools,
} from '../../tasks/public/index.js';
import {
  ProjectExecutionContext,
  projectWhere,
  executionHash,
} from './project-execution-context.js';
@Injectable()
export class ProjectViewsService {
  constructor(
    @Inject(ProjectExecutionContext)
    private readonly op: ProjectExecutionContext,
    @Inject(SharedTasks) private readonly tasks: SharedTasks,
    @Inject(SharedTaskWork) private readonly work: SharedTaskWork,
    @Inject(ProjectTaskTools) private readonly tools: ProjectTaskTools,
  ) {}
  query(
    actor: RequestActor,
    pid: string,
    q: z.infer<typeof c.ProjectViewQuerySchema>,
  ) {
    return this.op.read(actor, pid, [], q.taskId, async (s) => {
      if (q.taskId) await this.tasks.read(s.tx, s.a, pid, q.taskId);
      type Row = Awaited<ReturnType<SharedTasks['project']>>[number];
      const scan = async (
          after: string | undefined,
          wanted: number,
          visit?: (row: Row) => void,
        ) => {
          const out: Row[] = [];
          let position = after;
          for (;;) {
            const links = await s.tx.projectTask.findMany({
              where: {
                ...projectWhere(s),
                ...(q.taskId || position
                  ? {
                      taskId: {
                        ...(q.taskId ? { equals: q.taskId } : {}),
                        ...(position ? { gt: position } : {}),
                      },
                    }
                  : {}),
              },
              orderBy: { taskId: 'asc' },
              take: 100,
            });
            if (!links.length) break;
            const rows = await this.tasks.project(
              s.tx,
              s.a,
              links.map((r) => ({ spaceId: pid, id: r.taskId })),
              {
                limit: 100,
                ...(q.status ? { status: q.status } : {}),
                ...(q.from
                  ? {
                      range: { from: q.from, to: q.to!, timezone: q.timezone! },
                    }
                  : {}),
              },
            );
            for (const row of rows) {
              if (visit) visit(row);
              else out.push(row);
            }
            if (
              (!visit && out.length >= wanted) ||
              links.length < 100 ||
              q.taskId
            )
              break;
            position = links.at(-1)!.taskId;
          }
          return out;
        },
        { after: _after, ...filter } = q;
      const page = await this.op.page(
        s,
        'view:' + executionHash(filter),
        q,
        async (after) => {
          const rows = (await scan(after, q.limit + 1)).slice(0, q.limit + 1);
          const estimates = rows.length
            ? await this.work.metrics(
                s.tx,
                s.a,
                pid,
                rows.map((r) => r.task.id),
              )
            : [];
          return Promise.all(
            rows.map(async (r) => ({
              id: r.task.id,
              task: r.task,
              schedule: r.schedule,
              estimatedMinutes:
                estimates.find((e) => e.taskId === r.task.id)
                  ?.estimatedMinutes ?? null,
              workflow: await this.tools.binding(s.tx, s.a, s, r.task.id),
              fields: await this.tools.values(s.tx, s.a, s, r.task.id),
            })),
          );
        },
        q.taskId,
      );
      let totals: z.infer<typeof c.ProjectViewSchema>['totals'] = null;
      if (['DASHBOARD', 'KANBAN'].includes(q.kind)) {
        const byStatus = { OPEN: 0, IN_PROGRESS: 0, DONE: 0, CANCELED: 0 };
        let visibleTasks = 0;
        await scan(undefined, 0, (row) => {
          byStatus[row.task.status]++;
          visibleTasks++;
        });
        totals = { visibleTasks, byStatus };
      }
      const graph =
        q.kind === 'GANTT' && !q.taskId
          ? await this.tools.graph(s.tx, s.a, s)
          : { edges: [] };
      return c.ProjectViewSchema.parse({
        kind: q.kind,
        ...page,
        totals,
        dependencies: graph.edges,
      });
    });
  }
}
