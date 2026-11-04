import {
  Inject,
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type {
  Prisma,
  Task,
  TaskDependency,
  TaskReschedulePreview,
  TaskRescheduleItem,
} from '../../../generated/prisma/client.js';
import { SharedKernel } from '../../spaces/public/index.js';
import type { SharedAuthority } from '../../spaces/public/index.js';
import type { TaskToolContext } from '../public/project-tools.js';
import { scope, source, revision, rule, event } from './project-tool-common.js';
import { dependencyOrder, reschedulePlan } from '../domain/dependencies.js';
import type { Dependency } from '../domain/dependencies.js';
import { history } from '../domain/tasks.js';
const view = (r: TaskDependency) =>
  c.DependencySchema.strip().parse({
    ...r,
    retiredAt: r.retiredAt?.toISOString() ?? null,
  });
const scheduled = (r: Task) => ({
  ...r,
  scheduledDate: r.scheduledDate?.toISOString().slice(0, 10) ?? null,
});
const hash = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
@Injectable()
export class DependencyTools {
  constructor(@Inject(SharedKernel) private readonly kernel: SharedKernel) {}
  async graph(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
  ) {
    a.require(tx, ctx.spaceId, 'task.read');
    const r = await tx.taskDependencyGraph.findFirst({ where: scope(ctx) }),
      edges = await tx.taskDependency.findMany({
        where: { ...scope(ctx), retiredAt: null },
        orderBy: { id: 'asc' },
        take: 5001,
      });
    if (edges.length > 5000) throw new ConflictException();
    for (const e of edges) {
      await source(tx, a, ctx, e.predecessorId);
      await source(tx, a, ctx, e.successorId);
    }
    return { revision: r?.revision ?? 0, edges: edges.map(view) };
  }
  async dependency(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    input: z.infer<typeof c.DependencyInputSchema>,
    expected?: number,
  ) {
    const actor = a.require(tx, ctx.spaceId, 'work.manage');
    await source(tx, a, ctx, input.predecessorId);
    await source(tx, a, ctx, input.successorId);
    const old = await tx.taskDependency.findFirst({
      where: { ...scope(ctx), id: input.id },
    });
    if (expected !== undefined) {
      if (!old || old.retiredAt) throw new NotFoundException();
      revision(old.revision, expected);
      if (
        old.predecessorId !== input.predecessorId ||
        old.successorId !== input.successorId ||
        old.kind !== input.kind
      )
        throw new ConflictException();
    } else if (old) {
      if (
        old.retiredAt ||
        old.predecessorId !== input.predecessorId ||
        old.successorId !== input.successorId ||
        old.kind !== input.kind ||
        old.lagMinutes !== input.lagMinutes
      )
        throw new ConflictException();
      return view(old);
    }
    const edges = await tx.taskDependency.findMany({
        where: { ...scope(ctx), retiredAt: null, id: { not: input.id } },
      }),
      next = [...edges, { ...input, revision: 1 }] as Dependency[],
      ids = [...new Set(next.flatMap((e) => [e.predecessorId, e.successorId]))];
    rule(() => dependencyOrder(ids, next));
    if (!old)
      await this.kernel.featureGrowth(tx, ctx.spaceId, 'task.dependency');
    await ctx.begin?.();
    const row = old
      ? await tx.taskDependency.update({
          where: { id: input.id },
          data: { lagMinutes: input.lagMinutes, revision: { increment: 1 } },
        })
      : await tx.taskDependency.create({
          data: { ...scope(ctx), ...input, createdByActorId: actor.actorId },
        });
    for (const taskId of [input.predecessorId, input.successorId]) {
      const task = await tx.task.update({
        where: { id: taskId },
        data: { revision: { increment: 1 } },
      });
      await event(
        tx,
        a,
        ctx,
        task,
        'DEPENDENCY',
        old ? view(old) : null,
        view(row),
      );
    }
    return view(row);
  }
  async retireDependency(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    id: string,
    expected: number,
    now: Date,
  ) {
    a.require(tx, ctx.spaceId, 'work.manage');
    const row = await tx.taskDependency.findFirst({
      where: { ...scope(ctx), id },
    });
    if (!row) throw new NotFoundException();
    for (const t of [row.predecessorId, row.successorId])
      await source(tx, a, ctx, t);
    if (row.retiredAt) return view(row);
    revision(row.revision, expected);
    await ctx.begin?.();
    const next = await tx.taskDependency.update({
      where: { id },
      data: { retiredAt: now, revision: { increment: 1 } },
    });
    for (const id of [row.predecessorId, row.successorId]) {
      const t = await tx.task.update({
        where: { id },
        data: { revision: { increment: 1 } },
      });
      await event(tx, a, ctx, t, 'DEPENDENCY_RETIRE', view(row), view(next));
    }
    return view(next);
  }
  private async readPlan(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    id: string,
  ) {
    const r = await tx.taskReschedulePreview.findFirst({
      where: { ...scope(ctx), id },
    });
    if (!r) throw new NotFoundException();
    const access = a.require(tx, ctx.spaceId, 'work.manage');
    if (
      r.creatorAccessId !== access.accessId ||
      r.creatorGeneration !== access.generation
    )
      throw new NotFoundException();
    const items = await tx.taskRescheduleItem.findMany({
      where: { ...scope(ctx), previewId: id },
      orderBy: { taskId: 'asc' },
    });
    for (const item of items) await source(tx, a, ctx, item.taskId);
    return { r, items };
  }
  private planView(r: TaskReschedulePreview, items: TaskRescheduleItem[]) {
    return c.ReschedulePreviewSchema.strip().parse({
      ...r,
      expiresAt: r.expiresAt.toISOString(),
      appliedAt: r.appliedAt?.toISOString() ?? null,
      items: items.map((i) => ({
        taskId: i.taskId,
        sourceRevision: i.sourceRevision,
        changed: i.changed,
        plannedStartAt: i.plannedStartAt?.toISOString() ?? null,
        dueAt: i.dueAt?.toISOString() ?? null,
        scheduledDate: i.scheduledDate?.toISOString().slice(0, 10) ?? null,
      })),
    });
  }
  async plan(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    id: string,
  ) {
    const { r, items } = await this.readPlan(tx, a, ctx, id);
    return this.planView(r, items);
  }
  async preview(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    input: z.infer<typeof c.ReschedulePreviewInputSchema>,
    key: string,
    fingerprint: string,
    now: Date,
  ) {
    const actor = a.require(tx, ctx.spaceId, 'work.manage');
    a.require(tx, ctx.spaceId, 'task.update');
    const anchor = await source(tx, a, ctx, input.taskId, 'task.update');
    const old = await tx.taskReschedulePreview.findFirst({
      where: {
        ...scope(ctx),
        creatorAccessId: actor.accessId,
        creatorGeneration: actor.generation,
        creationKey: key,
      },
    });
    if (old) {
      if (old.id !== input.id || old.fingerprint !== fingerprint)
        throw new ConflictException();
      return this.plan(tx, a, ctx, old.id);
    }
    revision(anchor.revision, input.sourceRevision);
    const graph = await this.graph(tx, a, ctx),
      ids = [
        ...new Set([
          input.taskId,
          ...graph.edges.flatMap((e) => [e.predecessorId, e.successorId]),
        ]),
      ].sort();
    if (ids.length > 1000) throw new ConflictException({ code: 'GRAPH_LIMIT' });
    const tasks = await tx.task.findMany({
      where: { ...scope(ctx), deletedAt: null, id: { in: ids } },
      orderBy: { id: 'asc' },
    });
    if (tasks.length !== ids.length) throw new NotFoundException();
    const requested = {
        plannedStartAt: input.schedule.plannedStartAt
          ? new Date(input.schedule.plannedStartAt)
          : null,
        dueAt: input.schedule.dueAt ? new Date(input.schedule.dueAt) : null,
      },
      changes = rule(() =>
        reschedulePlan(tasks.map(scheduled), graph.edges, anchor.id, requested),
      ),
      changed = new Map(changes.map((t) => [t.id, t]));
    const items = tasks.map((t) => {
      const n = changed.get(t.id);
      return {
        ...scope(ctx),
        previewId: input.id,
        taskId: t.id,
        sourceRevision: t.revision,
        changed: Boolean(n),
        plannedStartAt: n ? n.plannedStartAt : t.plannedStartAt,
        dueAt: n ? n.dueAt : t.dueAt,
        scheduledDate:
          t.id === input.taskId
            ? input.schedule.scheduledDate
              ? new Date(input.schedule.scheduledDate)
              : null
            : t.scheduledDate,
      };
    });
    const authorizationVersion = actor.authorizationVersion + 1n,
      manifestHash = hash({
        spaceId: ctx.spaceId,
        scopeId: ctx.scopeId,
        graphRevision: graph.revision,
        authorizationVersion: String(authorizationVersion),
        items,
      });
    await this.kernel.featureGrowth(tx, ctx.spaceId, 'task.reschedule-preview');
    await ctx.begin?.();
    const r = await tx.taskReschedulePreview.create({
      data: {
        id: input.id,
        ...scope(ctx),
        createdByActorId: actor.actorId,
        creatorAccessId: actor.accessId,
        creatorGeneration: actor.generation,
        graphRevision: graph.revision,
        authorizationVersion,
        manifestHash,
        creationKey: key,
        fingerprint,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 1800000),
      },
    });
    await tx.taskRescheduleItem.createMany({ data: items });
    return this.planView(r, items);
  }
  async apply(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    id: string,
    expected: number,
    manifestHash: string,
    now: Date,
  ) {
    const actor = a.require(tx, ctx.spaceId, 'task.update');
    a.require(tx, ctx.spaceId, 'work.manage');
    const { r, items } = await this.readPlan(tx, a, ctx, id);
    if (r.manifestHash !== manifestHash) throw new ConflictException();
    if (r.state === 'APPLIED') return this.planView(r, items);
    revision(r.revision, expected);
    const graph = await tx.taskDependencyGraph.findFirst({ where: scope(ctx) });
    if (
      r.expiresAt <= now ||
      r.authorizationVersion !== actor.authorizationVersion ||
      r.graphRevision !== (graph?.revision ?? 0)
    )
      throw new ConflictException({ code: 'RESCHEDULE_PREVIEW_STALE' });
    const originals = new Map<string, Task>();
    for (const item of items) {
      const t = await source(tx, a, ctx, item.taskId, 'task.update');
      revision(t.revision, item.sourceRevision);
      originals.set(t.id, t);
    }
    // The immutable manifest is computed from the complete DAG; apply all final schedules atomically.
    await ctx.begin?.();
    for (const item of items.filter((i) => i.changed)) {
      const before = originals.get(item.taskId)!,
        after = await tx.task.update({
          where: { id: item.taskId },
          data: {
            plannedStartAt: item.plannedStartAt,
            dueAt: item.dueAt,
            scheduledDate: item.scheduledDate,
            revision: { increment: 1 },
          },
        });
      await tx.taskChange.create({
        data: {
          ...scope(ctx),
          actorId: actor.actorId,
          actorUserId: null,
          ...history(before, after, 'UPDATED', [
            'plannedStartAt',
            'dueAt',
            'scheduledDate',
          ]),
        },
      });
      await event(
        tx,
        a,
        ctx,
        after,
        'RESCHEDULE_APPLY',
        { previewId: id },
        { previewId: id, manifestHash },
      );
    }
    const row = await tx.taskReschedulePreview.update({
      where: { id },
      data: { state: 'APPLIED', revision: { increment: 1 }, appliedAt: now },
    });
    return this.planView(row, items);
  }
}
