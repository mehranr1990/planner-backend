import {
  Inject,
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  PayloadTooLargeException,
} from '@nestjs/common';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type {
  Prisma,
  SharedTaskWorkLog,
} from '../../../generated/prisma/client.js';
import { SharedKernel } from '../../spaces/public/index.js';
import type { SharedAuthority } from '../../spaces/public/index.js';
import { SharedTaskWork } from '../public/shared-task-work.js';
import type { TaskToolContext } from '../public/project-tools.js';
import {
  source,
  scope,
  revision,
  event,
  participant,
  rule,
} from './project-tool-common.js';
import { normalizeTitle } from '../domain/tasks.js';
import { legacyWorkflowEdge } from '../domain/workflows.js';
import { dependencyScheduleGuard } from './task-tool-guards.js';
const logView = (r: SharedTaskWorkLog) =>
  c.SharedWorkLogSchema.parse({
    id: r.id,
    taskId: r.taskId,
    actorId: r.actorId,
    accessId: r.accessId,
    generation: r.generation,
    revision: r.revision,
    startedAt: r.startedAt.toISOString(),
    endedAt: r.endedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    voidedAt: r.voidedAt?.toISOString() ?? null,
  });
@Injectable()
export class SharedTaskWorkRepository extends SharedTaskWork {
  async scopeMetrics(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    spaceId: string,
  ) {
    a.require(tx, spaceId, 'task.read');
    const rows = await tx.task.findMany({
      where: {
        spaceId: a.space(tx, spaceId),
        scopeId: a.scope(tx, spaceId),
        deletedAt: null,
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: 10001,
    });
    if (rows.length > 10000) throw new PayloadTooLargeException();
    return this.metrics(
      tx,
      a,
      spaceId,
      rows.map((r) => r.id),
    );
  }
  constructor(@Inject(SharedKernel) private readonly kernel: SharedKernel) {
    super();
  }
  async estimate(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    id: string,
    input?: { revision: number; estimatedMinutes: number | null },
  ) {
    const before = await source(
      tx,
      a,
      ctx,
      id,
      input ? 'task.update' : 'task.read',
    );
    if (!input)
      return {
        taskId: id,
        sourceRevision: before.revision,
        estimatedMinutes: before.estimatedMinutes,
      };
    revision(before.revision, input.revision);
    c.SharedEstimateInputSchema.parse({
      estimatedMinutes: input.estimatedMinutes,
    });
    await ctx.begin?.();
    const after = await tx.task.update({
      where: { id },
      data: {
        estimatedMinutes: input.estimatedMinutes,
        revision: { increment: 1 },
      },
    });
    await event(
      tx,
      a,
      ctx,
      after,
      'WORK_ESTIMATE',
      { estimatedMinutes: before.estimatedMinutes },
      { estimatedMinutes: after.estimatedMinutes },
    );
    return {
      taskId: id,
      sourceRevision: after.revision,
      estimatedMinutes: after.estimatedMinutes,
    };
  }
  async metrics(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    spaceId: string,
    ids: string[],
  ) {
    if (!ids.length) a.require(tx, spaceId, 'task.read');
    for (const id of ids)
      a.require(tx, spaceId, 'task.read', { kind: 'TASK', id });
    if (ids.length > 10000 || new Set(ids).size !== ids.length)
      throw new BadRequestException();
    const rows = await tx.task.findMany({
      where: {
        spaceId: a.space(tx, spaceId),
        scopeId: a.scope(tx, spaceId),
        id: { in: ids },
        deletedAt: null,
      },
      select: {
        id: true,
        revision: true,
        status: true,
        estimatedMinutes: true,
        plannedStartAt: true,
        dueAt: true,
        scheduledDate: true,
        completedAt: true,
      },
      orderBy: { id: 'asc' },
    });
    if (rows.length !== ids.length) throw new NotFoundException();
    return rows.map((r) =>
      c.ProjectTaskMetricSchema.parse({
        taskId: r.id,
        sourceRevision: r.revision,
        status: r.status,
        estimatedMinutes: r.estimatedMinutes,
        plannedStartAt: r.plannedStartAt?.toISOString() ?? null,
        dueAt: r.dueAt?.toISOString() ?? null,
        scheduledDate: r.scheduledDate?.toISOString().slice(0, 10) ?? null,
        completedAt: r.completedAt?.toISOString() ?? null,
      }),
    );
  }
  async validate(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    operations: z.infer<typeof c.ProjectChangeOperationSchema>[],
  ) {
    for (const op of operations) {
      if (op.kind === 'CREATE_TASK') {
        a.require(tx, ctx.spaceId, 'task.create');
        rule(() => normalizeTitle(op.task.title));
        if (op.task.description?.includes('\0'))
          throw new BadRequestException();
        if (
          await tx.task.findUnique({
            where: { id: op.task.id },
            select: { id: true },
          })
        )
          throw new ConflictException();
        continue;
      }
      if (op.kind !== 'UPDATE_TASK') continue;
      const task = await source(tx, a, ctx, op.taskId);
      revision(task.revision, op.sourceRevision);
      if (op.patch?.description?.includes('\0'))
        throw new BadRequestException();
      if (
        op.estimatedMinutes !== undefined ||
        op.schedule ||
        op.patch?.title !== undefined ||
        op.patch?.description !== undefined ||
        op.patch?.priority !== undefined
      )
        a.require(tx, ctx.spaceId, 'task.update', {
          kind: 'TASK',
          id: task.id,
        });
      if (op.patch?.title) rule(() => normalizeTitle(op.patch!.title!));
      if (op.patch?.status) {
        a.require(
          tx,
          ctx.spaceId,
          op.patch.status === 'DONE' || op.patch.status === 'OPEN'
            ? 'task.complete'
            : 'task.update',
          { kind: 'TASK', id: task.id },
        );
        const binding = await tx.taskWorkflowBinding.findUnique({
          where: { taskId: task.id },
        });
        if (binding) {
          a.require(tx, ctx.spaceId, 'workflow.transition');
          const where = {
              ...scope(ctx),
              workflowId: binding.workflowId,
              version: binding.version,
            },
            states = await tx.taskWorkflowState.findMany({ where }),
            edges = await tx.taskWorkflowEdge.findMany({ where });
          rule(() =>
            legacyWorkflowEdge(
              states,
              edges.map((e) => ({ ...e, approvers: [] })),
              binding.stateId,
              task.status,
              op.patch!.status!,
            ),
          );
        }
      }
      if (op.schedule)
        await dependencyScheduleGuard(tx, task, {
          plannedStartAt: op.schedule.plannedStartAt
            ? new Date(op.schedule.plannedStartAt)
            : null,
          dueAt: op.schedule.dueAt ? new Date(op.schedule.dueAt) : null,
          scheduledDate: op.schedule.scheduledDate,
        });
    }
  }
  async logs(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    taskId: string,
    after: string | undefined,
    limit: number,
  ) {
    a.require(tx, ctx.spaceId, 'task.read');
    await source(tx, a, ctx, taskId);
    return (
      await tx.sharedTaskWorkLog.findMany({
        where: {
          ...scope(ctx),
          taskId,
          ...(after ? { id: { gt: after } } : {}),
        },
        orderBy: { id: 'asc' },
        take: limit,
      })
    ).map(logView);
  }
  async record(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    taskId: string,
    expected: number,
    input: z.infer<typeof c.SharedWorkLogCreateSchema>,
    key: string,
    fingerprint: string,
  ) {
    const task = await source(tx, a, ctx, taskId, 'task.update'),
      actor = a.require(tx, ctx.spaceId, 'task.update', {
        kind: 'TASK',
        id: taskId,
      });
    await participant(this.kernel, tx, ctx, actor.accessId, actor.generation, [
      'task.read',
      'task.update',
    ]);
    const old = await tx.sharedTaskWorkLog.findFirst({
      where: {
        ...scope(ctx),
        accessId: actor.accessId,
        generation: actor.generation,
        creationKey: key,
      },
    });
    if (old) {
      if (
        old.id !== input.id ||
        old.taskId !== taskId ||
        old.fingerprint !== fingerprint
      )
        throw new ConflictException();
      return logView(old);
    }
    revision(task.revision, expected);
    c.SharedWorkLogCreateSchema.parse(input);
    await this.kernel.featureGrowth(tx, ctx.spaceId, 'task.shared-work-log');
    await ctx.begin?.();
    const row = await tx.sharedTaskWorkLog.create({
        data: {
          id: input.id,
          ...scope(ctx),
          taskId,
          actorId: actor.actorId,
          accessId: actor.accessId,
          generation: actor.generation,
          startedAt: new Date(input.startedAt),
          endedAt: new Date(input.endedAt),
          creationKey: key,
          fingerprint,
        },
      }),
      after = await tx.task.update({
        where: { id: taskId },
        data: { revision: { increment: 1 } },
      });
    await event(tx, a, ctx, after, 'WORK_LOG_RECORD', null, { id: row.id });
    return logView(row);
  }
  async void(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    taskId: string,
    id: string,
    expected: number,
    now: Date,
  ) {
    await source(tx, a, ctx, taskId, 'task.update');
    const actor = a.require(tx, ctx.spaceId, 'task.update', {
      kind: 'TASK',
      id: taskId,
    });
    await participant(this.kernel, tx, ctx, actor.accessId, actor.generation, [
      'task.read',
      'task.update',
    ]);
    const row = await tx.sharedTaskWorkLog.findFirst({
      where: { ...scope(ctx), taskId, id },
    });
    if (!row) throw new NotFoundException();
    if (row.actorId !== actor.actorId) throw new ForbiddenException();
    if (row.voidedAt) return logView(row);
    revision(row.revision, expected);
    await ctx.begin?.();
    const after = await tx.sharedTaskWorkLog.update({
        where: { id },
        data: { voidedAt: now, revision: { increment: 1 } },
      }),
      changed = await tx.task.update({
        where: { id: taskId },
        data: { revision: { increment: 1 } },
      });
    await event(
      tx,
      a,
      ctx,
      changed,
      'WORK_LOG_VOID',
      { id, voided: false },
      { id, voided: true },
    );
    return logView(after);
  }
  async effort(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    spaceId: string,
    ids: string[],
    from: Date,
    to: Date,
  ) {
    a.require(tx, spaceId, 'task.read');
    if (ids.length > 10000) throw new BadRequestException();
    const rows = await tx.sharedTaskWorkLog.findMany({
      where: {
        spaceId: a.space(tx, spaceId),
        scopeId: a.scope(tx, spaceId),
        taskId: { in: ids },
        voidedAt: null,
        startedAt: { lt: to },
        endedAt: { gt: from },
      },
      take: 10001,
    });
    if (rows.length > 10000)
      throw new BadRequestException({ code: 'REPORT_LIMIT' });
    return rows.map(({ startedAt, endedAt, voidedAt }) => ({
      startedAt,
      endedAt,
      voidedAt,
    }));
  }
}
