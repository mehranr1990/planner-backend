import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type {
  Prisma,
  TeamPlan,
  TeamWorkItem,
} from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { SharedKernel, SharedAuthority } from '../../spaces/public/index.js';
import type {
  SharedRequest,
  SharedFeatureKey,
} from '../../spaces/public/index.js';
import { SharedTasks } from '../../tasks/public/index.js';
import { SharedGoals } from '../../goals/public/index.js';
import { SharedCalendar } from '../../calendar/public/index.js';
import type { SharedCalendarCommand } from '../../calendar/public/index.js';
import { TeamProjects } from '../../projects/public/index.js';
import { TeamsService } from './teams.service.js';
const hash = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
const date = (v: string) => new Date(v + 'T00:00:00Z');
type Page = z.infer<typeof c.TeamPageQuerySchema>;
type Target = z.infer<typeof c.TeamWorkTargetSchema>;
type Tx = Prisma.TransactionClient;
const planView = (r: TeamPlan) =>
  c.TeamPlanSchema.strip().parse({
    ...r,
    startDate: r.startDate.toISOString().slice(0, 10),
    endDate: r.endDate.toISOString().slice(0, 10),
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
  });
const target = (r: TeamWorkItem): Target => ({
  kind: r.taskId ? 'TASK' : 'GOAL',
  spaceId: r.sourceSpaceId,
  id: (r.taskId ?? r.goalId)!,
});
@Injectable()
export class TeamWorkService {
  constructor(
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
    @Inject(TeamsService) private readonly teams: TeamsService,
    @Inject(SharedTasks) private readonly tasks: SharedTasks,
    @Inject(SharedGoals) private readonly goals: SharedGoals,
    @Inject(SharedCalendar) private readonly calendar: SharedCalendar,
    @Inject(TeamProjects) private readonly projects: TeamProjects,
  ) {}
  private request(
    id: string,
    capability: SharedRequest['capability'] = 'task.read',
  ): SharedRequest {
    return { spaceId: id, scopeId: id, capability };
  }
  private async run<T>(
    actor: RequestActor,
    id: string,
    cap: SharedRequest['capability'],
    work: (tx: Tx, a: SharedAuthority) => Promise<T>,
    extra: SharedRequest[] = [],
  ) {
    await this.teams.hint(id);
    return this.kernel.run(
      actor,
      {
        userIds: [],
        spaceIds: [...new Set([id, ...extra.map((r) => r.spaceId)])],
      },
      [
        { ...this.request(id), allowArchived: cap === 'task.read' },
        { ...this.request(id, cap), allowArchived: cap === 'task.read' },
        ...extra,
      ],
      work,
    );
  }
  private async effect(
    tx: Tx,
    a: SharedAuthority,
    actor: RequestActor,
    id: string,
    cap: SharedRequest['capability'],
    action: string,
    resourceId: string,
    feature?: SharedFeatureKey,
  ) {
    const access = a.require(tx, id, cap);
    await this.kernel.offerEffect(
      tx,
      actor,
      id,
      access.actorId,
      action,
      resourceId,
      randomUUID(),
      feature ? { actorId: access.actorId, feature, delta: 1 } : undefined,
    );
  }
  private once(
    tx: Tx,
    a: SharedAuthority,
    id: string,
    cap: SharedRequest['capability'],
    operation: string,
    key: string | undefined,
    input: unknown,
    work: () => Promise<{ id: string }>,
    statusCode = 201,
  ) {
    if (!key || !/^[!-~]{1,128}$/.test(key)) throw new BadRequestException();
    const access = a.require(tx, id, cap);
    return this.kernel.receipt(
      tx,
      a,
      this.request(id, cap),
      {
        operation,
        key: access.generation + ':' + key,
        fingerprint: hash(input),
      },
      async () => ({ ...(await work()), statusCode }),
    );
  }
  async sourceList(
    actor: RequestActor,
    id: string,
    kind: 'TASK' | 'GOAL',
    q: Page,
  ) {
    return this.run(actor, id, 'task.read', async (tx, a) => {
      const cursor = this.kernel.scopeCursor(
        tx,
        a,
        this.request(id),
        'team-' + kind,
      );
      const after = this.kernel.cursorPosition(
        cursor.context,
        cursor.stamp,
        actor.userId,
        q.after,
      );
      const result =
        kind === 'TASK'
          ? await this.tasks.list(tx, a, id, {
              limit: q.limit,
              ...(after ? { after } : {}),
            })
          : await this.goals.list(tx, a, id, {
              limit: q.limit,
              ...(after ? { after } : {}),
            });
      return this.kernel.cursorPage<
        z.infer<typeof c.SharedTaskSchema> | z.infer<typeof c.SharedGoalSchema>
      >(cursor.context, cursor.stamp, actor.userId, result);
    });
  }
  async sourceRead(
    actor: RequestActor,
    id: string,
    kind: 'TASK' | 'GOAL',
    sourceId: string,
  ) {
    return this.run(actor, id, 'task.read', async (tx, a) =>
      kind === 'TASK'
        ? this.tasks.read(tx, a, id, sourceId)
        : this.goals.read(tx, a, id, sourceId),
    );
  }
  async createTask(
    actor: RequestActor,
    id: string,
    input: z.infer<typeof c.ProjectTaskCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.ProjectTaskCreateSchema.parse(input);
    return this.run(actor, id, 'task.create', async (tx, a) => {
      await this.once(
        tx,
        a,
        id,
        'task.create',
        'team.task.create',
        key,
        body,
        async () => {
          await this.kernel.featureGrowth(tx, id, 'task.shared');
          const row = await this.tasks
            .create(tx, a, id, body)
            .catch((error: unknown) => {
              if (
                error &&
                typeof error === 'object' &&
                'code' in error &&
                error.code === 'P2002'
              )
                throw new ConflictException();
              throw error;
            });
          await this.effect(
            tx,
            a,
            actor,
            id,
            'task.create',
            'team.task.create',
            row.id,
            'task.shared',
          );
          return row;
        },
      );
      return this.tasks.read(tx, a, id, body.id);
    });
  }
  async patchTask(
    actor: RequestActor,
    id: string,
    sourceId: string,
    revision: number,
    input: z.infer<typeof c.ProjectTaskPatchSchema>,
    key: string | undefined,
  ) {
    const body = c.ProjectTaskPatchSchema.parse(input),
      cap =
        body.status === 'DONE' || body.status === 'OPEN'
          ? 'task.complete'
          : 'task.update';
    return this.run(
      actor,
      id,
      cap,
      async (tx, a) => {
        await this.once(
          tx,
          a,
          id,
          cap,
          'team.task.update',
          key,
          { sourceId, revision, body },
          async () => {
            const row = await this.tasks.update(
              tx,
              a,
              id,
              sourceId,
              revision,
              body,
            );
            await this.effect(
              tx,
              a,
              actor,
              id,
              cap,
              'team.task.update',
              row.id,
            );
            return row;
          },
          200,
        );
        return this.tasks.read(tx, a, id, sourceId);
      },
      body.title !== undefined ||
        body.description !== undefined ||
        body.priority !== undefined
        ? [this.request(id, 'task.update')]
        : [],
    );
  }
  async createGoal(
    actor: RequestActor,
    id: string,
    input: z.infer<typeof c.ProjectGoalCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.ProjectGoalCreateSchema.parse(input);
    return this.run(actor, id, 'goal.manage', async (tx, a) => {
      await this.once(
        tx,
        a,
        id,
        'goal.manage',
        'team.goal.create',
        key,
        body,
        async () => {
          await this.kernel.featureGrowth(tx, id, 'goal.shared');
          const row = await this.goals.create(tx, a, id, body);
          await this.effect(
            tx,
            a,
            actor,
            id,
            'goal.manage',
            'team.goal.create',
            row.id,
            'goal.shared',
          );
          return row;
        },
      );
      return this.goals.read(tx, a, id, body.id);
    });
  }
  async patchGoal(
    actor: RequestActor,
    id: string,
    sourceId: string,
    revision: number,
    input: z.infer<typeof c.ProjectGoalPatchSchema>,
    key: string | undefined,
  ) {
    const body = c.ProjectGoalPatchSchema.parse(input);
    return this.run(actor, id, 'goal.manage', async (tx, a) => {
      await this.once(
        tx,
        a,
        id,
        'goal.manage',
        'team.goal.update',
        key,
        { sourceId, revision, body },
        async () => {
          const row = await this.goals.update(
            tx,
            a,
            id,
            sourceId,
            revision,
            body,
          );
          await this.effect(
            tx,
            a,
            actor,
            id,
            'goal.manage',
            'team.goal.update',
            row.id,
          );
          return row;
        },
        200,
      );
      return this.goals.read(tx, a, id, sourceId);
    });
  }
  async schedule(
    actor: RequestActor,
    id: string,
    sourceId: string,
    input?: {
      revision: number;
      value: z.infer<typeof c.SharedTaskScheduleInputSchema>;
    },
  ) {
    return this.run(
      actor,
      id,
      input ? 'task.update' : 'task.read',
      async (tx, a) => {
        const row = await this.tasks.schedule(tx, a, id, sourceId, input);
        if (input)
          await this.effect(
            tx,
            a,
            actor,
            id,
            'task.update',
            'team.task.schedule',
            sourceId,
          );
        return row;
      },
    );
  }
  async linkGoalTask(
    actor: RequestActor,
    id: string,
    goalId: string,
    taskId: string,
    revision: number,
  ) {
    return this.run(actor, id, 'goal.manage', async (tx, a) => {
      const task = await this.tasks.read(tx, a, id, taskId);
      await this.goals.linkTask(
        tx,
        a,
        id,
        goalId,
        taskId,
        revision,
        task.revision,
      );
      await this.effect(
        tx,
        a,
        actor,
        id,
        'goal.manage',
        'team.goal.link',
        goalId,
      );
      return this.goals.read(tx, a, id, goalId);
    });
  }
  async calendarCommand(
    actor: RequestActor,
    id: string,
    command: SharedCalendarCommand,
    key?: string,
  ) {
    const cap = ['READ', 'LIST', 'VIEW'].includes(command.kind)
      ? 'task.read'
      : 'work.manage';
    return this.run(actor, id, cap, async (tx, a) => {
      const context = 'team-calendar:' + id + ':' + command.kind,
        access = a.require(tx, id, cap);
      if (command.kind === 'LIST' || command.kind === 'VIEW') {
        const q = command.query,
          stamp = hash([
            String(access.authorizationVersion),
            access.generation,
            'from' in q ? [q.from, q.to, q.timezone] : null,
          ]);
        const position = this.kernel.opaquePosition(
          context,
          stamp,
          actor.userId,
          q.cursor,
        );
        const raw = await this.calendar.run(tx, a, actor, id, {
          ...command,
          query: { ...q, cursor: position },
        } as SharedCalendarCommand);
        const result =
          command.kind === 'LIST'
            ? c.TeamCalendarPageSchema.parse(raw)
            : c.CalendarViewSchema.parse(raw);
        return {
          ...result,
          nextCursor: this.kernel.opaqueCursor(
            context,
            stamp,
            actor.userId,
            result.nextCursor,
          ),
        };
      }
      if (command.kind === 'CREATE') {
        const receipt = await this.once(
          tx,
          a,
          id,
          cap,
          'team.calendar.create',
          key,
          command.input,
          async () =>
            c.TeamCalendarEventSchema.parse(
              await this.calendar.run(tx, a, actor, id, command),
            ),
        );
        return this.calendar.run(tx, a, actor, id, {
          kind: 'READ',
          id: receipt.id,
        });
      }
      if (command.kind === 'SERIES') {
        await this.once(
          tx,
          a,
          id,
          cap,
          'team.calendar.series',
          key,
          command,
          async () => {
            await this.calendar.run(tx, a, actor, id, command);
            return { id: command.id };
          },
        );
        return this.calendar.run(tx, a, actor, id, {
          ...command,
          kind: 'SERIES_RESULT',
        });
      }
      return this.calendar.run(tx, a, actor, id, command);
    });
  }
  private async plan(tx: Tx, id: string, planId: string) {
    const row = await tx.teamPlan.findFirst({
      where: { id: planId, spaceId: id },
    });
    if (!row) throw new NotFoundException();
    return row;
  }
  async plans(actor: RequestActor, id: string, q: Page) {
    return this.run(actor, id, 'task.read', async (tx, a) => {
      const cursor = this.kernel.scopeCursor(
          tx,
          a,
          this.request(id),
          'team-plans',
        ),
        after = this.kernel.cursorPosition(
          cursor.context,
          cursor.stamp,
          actor.userId,
          q.after,
        ),
        rows = await tx.teamPlan.findMany({
          where: { spaceId: id, ...(after ? { id: { gt: after } } : {}) },
          orderBy: { id: 'asc' },
          take: q.limit + 1,
        });
      return this.kernel.cursorPage(
        cursor.context,
        cursor.stamp,
        actor.userId,
        {
          items: rows.slice(0, q.limit).map(planView),
          nextCursor: rows.length > q.limit ? rows[q.limit - 1]!.id : null,
        },
      );
    });
  }
  async createPlan(
    actor: RequestActor,
    id: string,
    input: z.infer<typeof c.TeamPlanCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.TeamPlanCreateSchema.parse(input);
    return this.run(actor, id, 'work.manage', async (tx, a) => {
      await this.once(
        tx,
        a,
        id,
        'work.manage',
        'team.plan.create',
        key,
        body,
        async () => {
          await this.kernel.featureGrowth(tx, id, 'team.plan');
          const row = await tx.teamPlan.create({
            data: {
              ...body,
              spaceId: id,
              startDate: date(body.startDate),
              endDate: date(body.endDate),
              createdByActorId: a.require(tx, id, 'work.manage').actorId,
            },
          });
          await this.effect(
            tx,
            a,
            actor,
            id,
            'work.manage',
            'team.plan.create',
            row.id,
            'team.plan',
          );
          return row;
        },
      );
      return planView(await this.plan(tx, id, body.id));
    });
  }
  async readPlan(actor: RequestActor, id: string, planId: string) {
    return this.run(actor, id, 'task.read', async (tx) =>
      planView(await this.plan(tx, id, planId)),
    );
  }
  async patchPlan(
    actor: RequestActor,
    id: string,
    planId: string,
    revision: number,
    input: z.infer<typeof c.TeamPlanPatchSchema>,
  ) {
    const body = c.TeamPlanPatchSchema.parse(input);
    return this.run(actor, id, 'work.manage', async (tx, a) => {
      const before = await this.plan(tx, id, planId);
      if (before.revision !== revision) throw new ConflictException();
      if (
        body.state &&
        body.state !== before.state &&
        !(
          (before.state === 'DRAFT' && body.state === 'ACTIVE') ||
          (before.state === 'ACTIVE' && body.state === 'CLOSED')
        )
      )
        throw new ConflictException();
      const row = await tx.teamPlan.update({
        where: { id: planId },
        data: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.state ? { state: body.state } : {}),
          revision: { increment: 1 },
        },
      });
      await this.effect(
        tx,
        a,
        actor,
        id,
        'work.manage',
        'team.plan.update',
        planId,
      );
      return planView(row);
    });
  }
  async review(
    actor: RequestActor,
    id: string,
    planId: string,
    revision: number,
    input: z.infer<typeof c.TeamReviewInputSchema>,
  ) {
    const body = c.TeamReviewInputSchema.parse(input);
    return this.run(actor, id, 'work.manage', async (tx, a) => {
      const before = await this.plan(tx, id, planId);
      if (before.revision !== revision || before.kind !== 'WEEK')
        throw new ConflictException();
      const now = (
        await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() now`
      )[0]!.now;
      const row = await tx.teamPlan.update({
        where: { id: planId },
        data: {
          reviewSummary: body.summary,
          reviewedByActorId: a.require(tx, id, 'work.manage').actorId,
          reviewedAt: now,
          revision: { increment: 1 },
        },
      });
      await this.effect(
        tx,
        a,
        actor,
        id,
        'work.manage',
        'team.plan.review',
        planId,
      );
      return planView(row);
    });
  }
  private async source(tx: Tx, a: SharedAuthority, id: string, t: Target) {
    if (t.spaceId !== id) await this.projects.sourceReference(tx, a, id, t);
    return t.kind === 'TASK'
      ? this.tasks.read(tx, a, t.spaceId, t.id)
      : this.goals.read(tx, a, t.spaceId, t.id);
  }
  private async itemView(
    tx: Tx,
    a: SharedAuthority,
    id: string,
    row: TeamWorkItem,
  ) {
    const t = target(row);
    return c.TeamWorkItemSchema.parse({
      id: row.id,
      spaceId: row.spaceId,
      planId: row.planId,
      target: t,
      sourceRevision: row.sourceRevision,
      position: row.position,
      revision: row.revision,
      createdByActorId: row.createdByActorId,
      source: await this.source(tx, a, id, t),
    });
  }
  private async item(tx: Tx, id: string, itemId: string) {
    const row = await tx.teamWorkItem.findFirst({
      where: { id: itemId, spaceId: id },
    });
    if (!row) throw new NotFoundException();
    return row;
  }
  private async openPlan(tx: Tx, id: string, planId: string | null) {
    if (planId && (await this.plan(tx, id, planId)).state === 'CLOSED')
      throw new ConflictException();
  }
  async createItem(
    actor: RequestActor,
    id: string,
    input: z.infer<typeof c.TeamWorkItemCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.TeamWorkItemCreateSchema.parse(input),
      t = body.target;
    return this.run(
      actor,
      id,
      'work.manage',
      async (tx, a) => {
        await this.source(tx, a, id, t);
        await this.once(
          tx,
          a,
          id,
          'work.manage',
          'team.item.create',
          key,
          body,
          async () => {
            const source = await this.source(tx, a, id, t);
            if (source.revision !== body.sourceRevision)
              throw new ConflictException();
            await this.openPlan(tx, id, body.planId);
            await this.kernel.featureGrowth(tx, id, 'team.work-item');
            const row = await tx.teamWorkItem.create({
              data: {
                id: body.id,
                spaceId: id,
                planId: body.planId,
                sourceSpaceId: t.spaceId,
                taskId: t.kind === 'TASK' ? t.id : null,
                goalId: t.kind === 'GOAL' ? t.id : null,
                sourceRevision: body.sourceRevision,
                position: body.position,
                createdByActorId: a.require(tx, id, 'work.manage').actorId,
              },
            });
            await this.effect(
              tx,
              a,
              actor,
              id,
              'work.manage',
              'team.item.create',
              row.id,
              'team.work-item',
            );
            return row;
          },
        );
        return this.itemView(tx, a, id, await this.item(tx, id, body.id));
      },
      t.spaceId === id ? [] : [this.request(t.spaceId)],
    );
  }
  async patchItem(
    actor: RequestActor,
    id: string,
    itemId: string,
    revision: number,
    input: z.infer<typeof c.TeamWorkItemPatchSchema>,
    sourceHint: Target,
  ) {
    const body = c.TeamWorkItemPatchSchema.parse(input);
    return this.run(
      actor,
      id,
      'work.manage',
      async (tx, a) => {
        const before = await this.item(tx, id, itemId),
          t = target(before);
        if (JSON.stringify(t) !== JSON.stringify(sourceHint))
          throw new ConflictException();
        const source = await this.source(tx, a, id, t);
        if (
          before.revision !== revision ||
          source.revision !== body.sourceRevision
        )
          throw new ConflictException();
        await this.openPlan(tx, id, before.planId);
        await this.openPlan(tx, id, body.planId);
        const row = await tx.teamWorkItem.update({
          where: { id: itemId },
          data: { ...body, revision: { increment: 1 } },
        });
        await this.effect(
          tx,
          a,
          actor,
          id,
          'work.manage',
          'team.item.update',
          itemId,
        );
        return this.itemView(tx, a, id, row);
      },
      sourceHint.spaceId === id ? [] : [this.request(sourceHint.spaceId)],
    );
  }
  async itemHint(actor: RequestActor, id: string, itemId: string) {
    return this.run(actor, id, 'task.read', async (tx) =>
      target(await this.item(tx, id, itemId)),
    );
  }
  async removeItem(
    actor: RequestActor,
    id: string,
    itemId: string,
    revision: number,
  ) {
    return this.run(actor, id, 'work.manage', async (tx, a) => {
      const row = await this.item(tx, id, itemId);
      if (row.revision !== revision) throw new ConflictException();
      await tx.teamWorkItem.delete({ where: { id: itemId } });
      await this.effect(
        tx,
        a,
        actor,
        id,
        'work.manage',
        'team.item.remove',
        itemId,
      );
      return { id: itemId, removed: true as const };
    });
  }
  async items(
    actor: RequestActor,
    id: string,
    q: z.infer<typeof c.TeamWorkPageQuerySchema>,
  ) {
    await this.teams.hint(id);
    const hints = await this.kernel.readableContextHints(actor),
      refs = await this.projects.candidates(id, hints.ids),
      spaces = [id, ...refs.map((r) => r.spaceId)];
    return this.run(
      actor,
      id,
      'task.read',
      async (tx, a) => {
        const access = a.require(tx, id, 'task.read'),
          stamp = hash([
            String(access.authorizationVersion),
            access.generation,
            hints.stamp,
            refs.map((r) => [r.projectId, r.revision]),
            q.planId ?? null,
          ]),
          context = 'team-items:' + id,
          after = this.kernel.cursorPosition(
            context,
            stamp,
            actor.userId,
            q.after,
          );
        const liveRefs = await this.projects.candidates(id, hints.ids, tx);
        if (JSON.stringify(liveRefs) !== JSON.stringify(refs))
          throw new ConflictException();
        const rows = await tx.teamWorkItem.findMany({
          where: {
            spaceId: id,
            sourceSpaceId: { in: spaces },
            ...(q.planId
              ? { planId: q.planId === 'BACKLOG' ? null : q.planId }
              : {}),
            ...(after ? { id: { gt: after } } : {}),
            OR: [
              { taskId: { not: null }, Task: { deletedAt: null } },
              { goalId: { not: null } },
            ],
          },
          orderBy: { id: 'asc' },
          take: q.limit + 1,
        });
        const items = await Promise.all(
          rows.slice(0, q.limit).map((row) => this.itemView(tx, a, id, row)),
        );
        return this.kernel.cursorPage(context, stamp, actor.userId, {
          items,
          nextCursor: rows.length > q.limit ? rows[q.limit - 1]!.id : null,
        });
      },
      refs.map((r) => ({ ...this.request(r.spaceId), allowArchived: true })),
    );
  }
}
