import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { SharedKernel, SharedAuthority } from '../../spaces/public/index.js';
import type { SharedRequest } from '../../spaces/public/index.js';
import { SharedTasks, SharedTaskWork } from '../../tasks/public/index.js';
import { localKey } from '../../calendar/public/index.js';
import { TeamsService } from './teams.service.js';
import { addDays, boardState, engineStatus } from '../domain/collaboration.js';
import type { BoardState, TaskStatus } from '../domain/collaboration.js';
type Tx = Prisma.TransactionClient;
type Cap = SharedRequest['capability'];
type Page = z.infer<typeof c.ProjectPageQuerySchema>;
const request = (id: string, capability: Cap = 'task.read'): SharedRequest => ({
  spaceId: id,
  scopeId: id,
  capability,
});
const now = async (tx: Tx) =>
  (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() now`)[0]!.now;
const day = (d: Date) => d.toISOString().slice(0, 10);
@Injectable()
export class TeamPlanningService {
  constructor(
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
    @Inject(TeamsService) private readonly teams: TeamsService,
    @Inject(SharedTasks) private readonly tasks: SharedTasks,
    @Inject(SharedTaskWork) private readonly work: SharedTaskWork,
  ) {}
  private async run<T>(
    actor: RequestActor,
    id: string,
    caps: Cap[],
    work: (tx: Tx, a: SharedAuthority) => Promise<T>,
  ) {
    await this.teams.hint(id);
    const read = caps.every((cap) => cap === 'task.read');
    return this.kernel.run(
      actor,
      { userIds: [], spaceIds: [id] },
      [...new Set<Cap>(['task.read', ...caps])].map((cap) => ({
        ...request(id, cap),
        allowArchived: read,
      })),
      work,
    );
  }
  private async effect(
    tx: Tx,
    a: SharedAuthority,
    actor: RequestActor,
    id: string,
    cap: Cap,
    action: string,
    resourceId: string,
  ) {
    await this.kernel.offerEffect(
      tx,
      actor,
      id,
      a.require(tx, id, cap).actorId,
      action,
      resourceId,
      randomUUID(),
    );
  }
  private scope(tx: Tx, a: SharedAuthority, id: string) {
    return { spaceId: a.space(tx, id), scopeId: id };
  }
  /** Team-owned Task rows with board state, estimate, schedule and work-item placement. */
  private async rows(
    tx: Tx,
    a: SharedAuthority,
    id: string,
    list: z.infer<typeof c.SharedTaskSchema>[],
  ) {
    const ids = list.map((t) => t.id),
      scope = this.scope(tx, a, id),
      metrics = new Map(
        (await this.work.metrics(tx, a, id, ids)).map((m) => [m.taskId, m]),
      ),
      overlays = new Map(
        (
          await tx.teamTaskState.findMany({
            where: { spaceId: scope.spaceId, taskId: { in: ids } },
          })
        ).map((o) => [o.taskId, o]),
      ),
      items = await tx.teamWorkItem.findMany({
        where: { ...scope, sourceScopeId: id, taskId: { in: ids } },
        orderBy: { id: 'asc' },
      });
    return list.map((task) => {
      const m = metrics.get(task.id)!;
      return c.TeamTaskPlanningSchema.parse({
        task,
        boardState: boardState(task.status, overlays.get(task.id)),
        estimatedMinutes: m.estimatedMinutes,
        dueAt: m.dueAt,
        scheduledDate: m.scheduledDate,
        items: items
          .filter((i) => i.taskId === task.id)
          .map((i) => ({
            id: i.id,
            planId: i.planId,
            carriedFromPlanId: i.carriedFromPlanId,
            position: i.position,
            revision: i.revision,
          })),
      });
    });
  }
  taskPlanning(actor: RequestActor, id: string, q: Page) {
    return this.run(actor, id, ['task.read'], async (tx, a) => {
      const cursor = this.kernel.scopeCursor(
          tx,
          a,
          request(id),
          'team-task-planning',
        ),
        after = this.kernel.cursorPosition(
          cursor.context,
          cursor.stamp,
          actor.userId,
          q.after,
        ),
        page = await this.tasks.list(tx, a, id, {
          limit: q.limit,
          ...(after ? { after } : {}),
        });
      return this.kernel.cursorPage(
        cursor.context,
        cursor.stamp,
        actor.userId,
        {
          items: await this.rows(tx, a, id, page.items),
          nextCursor: page.nextCursor,
        },
      );
    });
  }
  async setBoardState(
    actor: RequestActor,
    id: string,
    sourceId: string,
    revision: number,
    input: z.infer<typeof c.TeamBoardStateInputSchema>,
  ) {
    const { state } = c.TeamBoardStateInputSchema.parse(input),
      caps: Cap[] =
        state === 'TODO' || state === 'DONE'
          ? ['task.complete']
          : state === 'BLOCKED'
            ? ['task.update', 'task.complete']
            : ['task.update'];
    return this.run(actor, id, caps, async (tx, a) => {
      const before = await this.tasks.read(tx, a, id, sourceId),
        status = engineStatus(state, before.status as TaskStatus),
        task = await this.tasks.update(tx, a, id, sourceId, revision, {
          status,
        }),
        scope = this.scope(tx, a, id);
      await tx.teamTaskState.deleteMany({
        where: { spaceId: scope.spaceId, taskId: sourceId },
      });
      if (state === 'REVIEW' || state === 'BLOCKED')
        await tx.teamTaskState.create({
          data: {
            id: randomUUID(),
            ...scope,
            taskId: sourceId,
            state,
            taskStatus: status,
            updatedByActorId: a.require(tx, id, caps[0]!).actorId,
          },
        });
      await this.effect(
        tx,
        a,
        actor,
        id,
        caps[0]!,
        'team.task.board-state',
        sourceId,
      );
      return (await this.rows(tx, a, id, [task]))[0]!;
    });
  }
  async setEstimate(
    actor: RequestActor,
    id: string,
    sourceId: string,
    revision: number,
    input: z.infer<typeof c.TeamTaskEstimateInputSchema>,
  ) {
    const body = c.TeamTaskEstimateInputSchema.parse(input);
    return this.run(actor, id, ['task.update'], async (tx, a) => {
      await this.work.estimate(
        tx,
        a,
        {
          ...this.scope(tx, a, id),
          actor,
          lockedUsers: [actor.userId],
        },
        sourceId,
        { revision, estimatedMinutes: body.estimatedMinutes },
      );
      await this.effect(
        tx,
        a,
        actor,
        id,
        'task.update',
        'team.task.estimate',
        sourceId,
      );
      return (
        await this.rows(tx, a, id, [await this.tasks.read(tx, a, id, sourceId)])
      )[0]!;
    });
  }
  private async plan(tx: Tx, a: SharedAuthority, id: string, planId: string) {
    const row = await tx.teamPlan.findFirst({
      where: { id: planId, ...this.scope(tx, a, id) },
    });
    if (!row) throw new NotFoundException();
    return row;
  }
  /** Team-owned Task items only; Project read-through items keep their own authority. */
  private async summarize(
    tx: Tx,
    a: SharedAuthority,
    id: string,
    planId: string,
  ) {
    const plan = await this.plan(tx, a, id, planId),
      scope = this.scope(tx, a, id),
      at = await now(tx),
      items = await tx.teamWorkItem.findMany({
        where: {
          ...scope,
          planId,
          sourceScopeId: id,
          taskId: { not: null },
          Task: { deletedAt: null },
        },
        orderBy: { id: 'asc' },
        take: 2001,
      });
    if (items.length > 2000) throw new PayloadTooLargeException();
    const ids = [...new Set(items.map((i) => i.taskId!))],
      metrics = new Map(
        (await this.work.metrics(tx, a, id, ids)).map((m) => [m.taskId, m]),
      ),
      overlays = new Map(
        (
          await tx.teamTaskState.findMany({
            where: { spaceId: scope.spaceId, taskId: { in: ids } },
          })
        ).map((o) => [o.taskId, o]),
      ),
      state = (taskId: string) =>
        boardState(
          metrics.get(taskId)!.status as TaskStatus,
          overlays.get(taskId),
        ),
      local = (d: Date) => localKey(d, plan.timezone).slice(0, 10),
      today = local(at),
      count = (f: (s: BoardState) => boolean) =>
        items.filter((i) => f(state(i.taskId!))).length,
      known = items.filter(
        (i) => metrics.get(i.taskId!)!.estimatedMinutes !== null,
      ),
      minutes = (i: (typeof items)[number]) =>
        metrics.get(i.taskId!)!.estimatedMinutes ?? 0,
      plannedMinutes = known.reduce((n, i) => n + minutes(i), 0),
      done = items.filter((i) => state(i.taskId!) === 'DONE'),
      carried = await tx.teamWorkItem.findMany({
        where: { ...scope, carriedFromPlanId: planId, sourceScopeId: id },
        select: { planId: true },
      }),
      days: string[] = [];
    for (
      let d = day(plan.startDate);
      d < day(plan.endDate) && days.length < 93;
      d = addDays(d, 1)
    )
      days.push(d);
    const unfinished = items.filter(
      (i) => !['DONE', 'CANCELED'].includes(state(i.taskId!)),
    );
    const titles = new Map(
      await Promise.all(
        unfinished.map(
          async (i) =>
            [
              i.taskId!,
              (await this.tasks.read(tx, a, id, i.taskId!)).title,
            ] as const,
        ),
      ),
    );
    return c.TeamPlanSummarySchema.parse({
      planId,
      kind: plan.kind,
      state: plan.state,
      revision: plan.revision,
      sprintNumber:
        plan.kind === 'SPRINT'
          ? await tx.teamPlan.count({
              where: {
                ...scope,
                kind: 'SPRINT',
                OR: [
                  { startDate: { lt: plan.startDate } },
                  { startDate: plan.startDate, id: { lte: plan.id } },
                ],
              },
            })
          : null,
      focus: plan.focus,
      focusByActorId: plan.focusByActorId,
      focusAt: plan.focusAt?.toISOString() ?? null,
      goal: plan.goal,
      publishedAt: plan.publishedAt?.toISOString() ?? null,
      publishedByActorId: plan.publishedByActorId,
      closedAt: plan.closedAt?.toISOString() ?? null,
      planned: items.length,
      done: done.length,
      canceled: count((s) => s === 'CANCELED'),
      blocked: count((s) => s === 'BLOCKED'),
      review: count((s) => s === 'REVIEW'),
      carriedIn: items.filter((i) => i.carriedFromPlanId).length,
      addedAfterPublish: plan.publishedAt
        ? items.filter((i) => i.plannedAt && i.plannedAt > plan.publishedAt!)
            .length
        : null,
      carriedOut: {
        toPlan: carried.filter((r) => r.planId).length,
        toBacklog: carried.filter((r) => !r.planId).length,
      },
      plannedMinutes,
      doneMinutes: done.reduce((n, i) => n + minutes(i), 0),
      unknownEstimates: items.length - known.length,
      days: days.map((d) => ({
        date: d,
        scheduled: items.filter(
          (i) => metrics.get(i.taskId!)!.scheduledDate === d,
        ).length,
        completed: done.filter((i) => {
          const at = metrics.get(i.taskId!)!.completedAt;
          return at !== null && local(new Date(at)) === d;
        }).length,
        remainingMinutes:
          d > today
            ? null
            : plannedMinutes -
              done
                .filter((i) => {
                  const at = metrics.get(i.taskId!)!.completedAt;
                  return at !== null && local(new Date(at)) <= d;
                })
                .reduce((n, i) => n + minutes(i), 0),
      })),
      unfinished: unfinished.map((i) => ({
        itemId: i.id,
        itemRevision: i.revision,
        taskId: i.taskId!,
        title: titles.get(i.taskId!)!,
        sourceRevision: metrics.get(i.taskId!)!.sourceRevision,
        boardState: state(i.taskId!),
      })),
      asOf: at.toISOString(),
    });
  }
  summary(actor: RequestActor, id: string, planId: string) {
    return this.run(actor, id, ['task.read'], (tx, a) =>
      this.summarize(tx, a, id, planId),
    );
  }
  async setPlanning(
    actor: RequestActor,
    id: string,
    planId: string,
    revision: number,
    input: z.infer<typeof c.TeamPlanPlanningInputSchema>,
  ) {
    const body = c.TeamPlanPlanningInputSchema.parse(input);
    return this.run(actor, id, ['work.manage'], async (tx, a) => {
      const before = await this.plan(tx, a, id, planId);
      if (before.revision !== revision || before.state === 'CLOSED')
        throw new ConflictException();
      if (
        (body.focus !== undefined && before.kind !== 'WEEK') ||
        (body.goal !== undefined && before.kind !== 'SPRINT')
      )
        throw new BadRequestException({ code: 'PLAN_KIND_MISMATCH' });
      await tx.teamPlan.update({
        where: { id: planId },
        data: {
          ...(body.focus !== undefined
            ? {
                focus: body.focus,
                focusByActorId: a.require(tx, id, 'work.manage').actorId,
                focusAt: await now(tx),
              }
            : {}),
          ...(body.goal !== undefined ? { goal: body.goal } : {}),
          revision: { increment: 1 },
        },
      });
      await this.effect(
        tx,
        a,
        actor,
        id,
        'work.manage',
        'team.plan.planning',
        planId,
      );
      return this.summarize(tx, a, id, planId);
    });
  }
  async carryOver(
    actor: RequestActor,
    id: string,
    planId: string,
    itemId: string,
    revision: number,
    input: z.infer<typeof c.TeamCarryOverInputSchema>,
  ) {
    const body = c.TeamCarryOverInputSchema.parse(input),
      caps: Cap[] =
        body.decision === 'CLOSE'
          ? ['work.manage', 'task.update']
          : ['work.manage'];
    return this.run(actor, id, caps, async (tx, a) => {
      const plan = await this.plan(tx, a, id, planId),
        scope = this.scope(tx, a, id),
        item = await tx.teamWorkItem.findFirst({
          where: { id: itemId, ...scope, planId },
        });
      if (!item) throw new NotFoundException();
      if (plan.state === 'CLOSED' || item.revision !== revision)
        throw new ConflictException();
      if (!item.taskId || item.sourceScopeId !== id)
        throw new ConflictException({ code: 'TEAM_TASK_ITEM_REQUIRED' });
      const task = await this.tasks.read(tx, a, id, item.taskId);
      if (task.revision !== body.sourceRevision) throw new ConflictException();
      if (task.status === 'DONE' || task.status === 'CANCELED')
        throw new ConflictException({ code: 'TASK_FINISHED' });
      if (body.decision === 'CLOSE')
        await this.tasks.update(tx, a, id, item.taskId, task.revision, {
          status: 'CANCELED',
        });
      else {
        if (body.targetPlanId) {
          const target = await this.plan(tx, a, id, body.targetPlanId);
          if (target.state === 'CLOSED' || target.id === planId)
            throw new ConflictException();
        }
        await tx.teamWorkItem.update({
          where: { id: itemId },
          data: {
            planId: body.targetPlanId,
            carriedFromPlanId: planId,
            plannedAt: body.targetPlanId ? await now(tx) : null,
            revision: { increment: 1 },
          },
        });
      }
      await this.effect(
        tx,
        a,
        actor,
        id,
        'work.manage',
        'team.plan.carry-over',
        itemId,
      );
      return this.summarize(tx, a, id, planId);
    });
  }
  backlogOrder(
    actor: RequestActor,
    id: string,
    input: z.infer<typeof c.TeamBacklogOrderInputSchema>,
  ) {
    const body = c.TeamBacklogOrderInputSchema.parse(input);
    return this.run(actor, id, ['work.manage'], async (tx, a) => {
      const scope = this.scope(tx, a, id),
        rows = await tx.teamWorkItem.findMany({
          where: { ...scope, id: { in: body.items.map((i) => i.id) } },
        });
      if (rows.length !== body.items.length) throw new NotFoundException();
      const byId = new Map(rows.map((r) => [r.id, r]));
      for (const i of body.items) {
        const r = byId.get(i.id)!;
        if (r.planId !== null || r.sourceScopeId !== id)
          throw new ConflictException({ code: 'TEAM_BACKLOG_ITEM_REQUIRED' });
        if (r.revision !== i.revision) throw new ConflictException();
      }
      const items = [];
      for (const [position, i] of body.items.entries()) {
        const r = await tx.teamWorkItem.update({
          where: { id: i.id },
          data: { position, revision: { increment: 1 } },
        });
        items.push({ id: r.id, position: r.position, revision: r.revision });
      }
      await this.effect(
        tx,
        a,
        actor,
        id,
        'work.manage',
        'team.backlog.order',
        id,
      );
      return c.TeamBacklogOrderSchema.parse({ items });
    });
  }
}
