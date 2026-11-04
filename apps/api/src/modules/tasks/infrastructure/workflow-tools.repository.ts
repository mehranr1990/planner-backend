import {
  Inject,
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type {
  Prisma,
  Task,
  TaskWorkflowBinding,
  TaskWorkflowApproval,
} from '../../../generated/prisma/client.js';
import { SharedKernel } from '../../spaces/public/index.js';
import type { SharedAuthority } from '../../spaces/public/index.js';
import type { TaskToolContext } from '../public/project-tools.js';
import {
  scope,
  source,
  revision,
  rule,
  event,
  participant,
  taskView,
} from './project-tool-common.js';
import {
  validateWorkflow,
  workflowEdge,
  designatedApprover,
} from '../domain/workflows.js';
import { transition, history } from '../domain/tasks.js';
const bindingView = (b: TaskWorkflowBinding, t: Task) =>
  c.WorkflowBindingSchema.strip().parse({ ...b, sourceRevision: t.revision });
const approvalView = (r: TaskWorkflowApproval) =>
  c.WorkflowApprovalSchema.strip().parse({
    ...r,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
  });
const statusCap = (s: Task['status']) =>
  s === 'DONE' || s === 'OPEN'
    ? ('task.complete' as const)
    : ('task.update' as const);
@Injectable()
export class WorkflowTools {
  constructor(@Inject(SharedKernel) private readonly kernel: SharedKernel) {}
  async replayedTransition(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    taskId: string,
    key: string,
    fingerprint: string,
  ) {
    const actor = a.require(tx, ctx.spaceId, 'workflow.transition'),
      task = await source(tx, a, ctx, taskId),
      b = await this.binding(tx, a, ctx, taskId);
    if (!b.binding) throw new NotFoundException();
    const approval = await tx.taskWorkflowApproval.findFirst({
      where: {
        ...scope(ctx),
        taskId,
        requesterAccessId: actor.accessId,
        requesterGeneration: actor.generation,
        creationKey: key,
      },
    });
    if (approval && approval.fingerprint !== fingerprint)
      throw new ConflictException();
    return {
      task: taskView(task),
      binding: b.binding,
      approval: approval ? approvalView(approval) : null,
    };
  }
  async transitionHint(
    db: Prisma.TransactionClient,
    spaceId: string,
    taskId: string,
    edgeId: string,
    approvalId?: string,
  ) {
    const b = approvalId
      ? await db.taskWorkflowApproval.findFirst({
          where: { spaceId, taskId, id: approvalId },
        })
      : await db.taskWorkflowBinding.findFirst({ where: { spaceId, taskId } });
    if (!b) return 'task.update';
    const edge = await db.taskWorkflowEdge.findFirst({
      where: {
        spaceId,
        scopeId: spaceId,
        workflowId: b.workflowId,
        version: b.version,
        id: approvalId ? (b as TaskWorkflowApproval).edgeId : edgeId,
      },
    });
    if (!edge) return 'task.update';
    const s = await db.taskWorkflowState.findFirst({
      where: {
        spaceId,
        scopeId: spaceId,
        workflowId: b.workflowId,
        version: b.version,
        id: edge.toStateId,
      },
    });
    return statusCap(s?.status ?? 'IN_PROGRESS');
  }
  async workflowHint(
    db: Prisma.TransactionClient,
    spaceId: string,
    taskId: string,
  ) {
    return Boolean(
      await db.taskWorkflowBinding.findFirst({ where: { spaceId, taskId } }),
    );
  }
  async approvalHint(
    db: Prisma.TransactionClient,
    spaceId: string,
    scopeId: string,
    id: string,
  ) {
    return (
      (
        await db.taskWorkflowApproval.findFirst({
          where: { id, spaceId, scopeId },
        })
      )?.requesterAccessId ?? null
    );
  }
  async workflows(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    after: string | undefined,
    limit: number,
  ) {
    a.require(tx, ctx.spaceId, 'task.read');
    return (
      await tx.taskWorkflow.findMany({
        where: { ...scope(ctx), ...(after ? { id: { gt: after } } : {}) },
        orderBy: { id: 'asc' },
        take: limit,
      })
    ).map((r) => c.WorkflowSchema.strip().parse(r));
  }
  async workflow(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    id: string,
    version: number,
  ) {
    a.require(tx, ctx.spaceId, 'task.read');
    return this.version(tx, ctx, id, version);
  }
  private async version(
    tx: Prisma.TransactionClient,
    ctx: TaskToolContext,
    id: string,
    version: number,
  ) {
    const where = { ...scope(ctx), workflowId: id, version },
      r = await tx.taskWorkflowVersion.findFirst({ where });
    if (!r) throw new NotFoundException();
    const states = await tx.taskWorkflowState.findMany({
        where,
        orderBy: { id: 'asc' },
      }),
      edges = await tx.taskWorkflowEdge.findMany({
        where,
        orderBy: { id: 'asc' },
      }),
      approvers = await tx.taskWorkflowApprover.findMany({
        where,
        orderBy: { accessId: 'asc' },
      });
    return c.WorkflowVersionSchema.parse({
      workflowId: id,
      version,
      name: r.name,
      publishedByActorId: r.publishedByActorId,
      createdAt: r.createdAt.toISOString(),
      states: states.map(({ id, label, status }) => ({ id, label, status })),
      edges: edges.map(({ id, fromStateId, toStateId, requiresApproval }) => ({
        id,
        fromStateId,
        toStateId,
        requiresApproval,
        approvers: approvers
          .filter((x) => x.edgeId === id)
          .map(({ accessId, generation }) => ({ accessId, generation })),
      })),
    });
  }
  async publishWorkflow(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    id: string,
    expected: number,
    input: z.infer<typeof c.WorkflowVersionInputSchema>,
    key: string,
    fingerprint: string,
  ) {
    const actor = a.require(tx, ctx.spaceId, 'workflow.publish');
    a.require(tx, ctx.spaceId, 'task.read');
    rule(() => validateWorkflow(input.states, input.edges));
    const current = await tx.taskWorkflow.findFirst({
      where: { ...scope(ctx), id },
    });
    if (expected === 0) {
      const old = await tx.taskWorkflow.findFirst({
        where: { ...scope(ctx), creationKey: key },
      });
      if (old) {
        if (old.id !== id || old.fingerprint !== fingerprint)
          throw new ConflictException();
        return this.version(tx, ctx, id, 1);
      }
      if (current) throw new ConflictException();
    } else {
      if (!current) throw new NotFoundException();
      revision(current.revision, expected);
    }
    for (const edge of input.edges) {
      const target = input.states.find((s) => s.id === edge.toStateId)!;
      for (const p of edge.approvers)
        await participant(this.kernel, tx, ctx, p.accessId, p.generation, [
          'task.read',
          'workflow.transition',
          statusCap(target.status),
        ]);
    }
    await this.kernel.featureGrowth(tx, ctx.spaceId, 'task.workflow-version');
    await ctx.begin?.();
    const version = (current?.currentVersion ?? 0) + 1;
    if (!current)
      await tx.taskWorkflow.create({
        data: {
          ...scope(ctx),
          id,
          name: input.name,
          createdByActorId: actor.actorId,
          creationKey: key,
          fingerprint,
        },
      });
    else
      await tx.taskWorkflow.update({
        where: { id },
        data: {
          name: input.name,
          currentVersion: version,
          revision: { increment: 1 },
        },
      });
    const where = { ...scope(ctx), workflowId: id, version };
    await tx.taskWorkflowVersion.create({
      data: { ...where, name: input.name, publishedByActorId: actor.actorId },
    });
    await tx.taskWorkflowState.createMany({
      data: input.states.map((s) => ({ ...where, ...s })),
    });
    for (const { approvers, ...edge } of input.edges) {
      await tx.taskWorkflowEdge.create({ data: { ...where, ...edge } });
      if (approvers.length)
        await tx.taskWorkflowApprover.createMany({
          data: approvers.map((p) => ({ ...where, edgeId: edge.id, ...p })),
        });
    }
    return this.version(tx, ctx, id, version);
  }
  async binding(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    taskId: string,
  ) {
    const task = await source(tx, a, ctx, taskId),
      b = await tx.taskWorkflowBinding.findFirst({
        where: { ...scope(ctx), taskId },
      });
    return {
      taskId,
      sourceRevision: task.revision,
      binding: b ? bindingView(b, task) : null,
    };
  }
  async bind(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    taskId: string,
    expected: number,
    input: z.infer<typeof c.WorkflowBindSchema>,
  ) {
    a.require(tx, ctx.spaceId, 'workflow.publish');
    const task = await source(tx, a, ctx, taskId, 'task.update');
    revision(task.revision, expected);
    const v = await this.version(tx, ctx, input.workflowId, input.version),
      state = v.states.find((s) => s.id === input.stateId);
    if (!state) throw new NotFoundException();
    if (state.status !== task.status)
      throw new ConflictException({ code: 'WORKFLOW_STATE_MISMATCH' });
    const before = await tx.taskWorkflowBinding.findUnique({
      where: { taskId },
    });
    if (
      await tx.taskWorkflowApproval.count({
        where: { ...scope(ctx), taskId, state: 'REQUESTED' },
      })
    )
      throw new ConflictException({ code: 'PENDING_WORKFLOW_APPROVAL' });
    await ctx.begin?.();
    await tx.taskWorkflowBinding.upsert({
      where: { taskId },
      create: { ...scope(ctx), taskId, ...input },
      update: { ...input, revision: { increment: 1 } },
    });
    const updated = await tx.task.update({
      where: { id: taskId },
      data: { revision: { increment: 1 } },
    });
    await event(tx, a, ctx, updated, 'WORKFLOW_BIND', before, input);
    return this.binding(tx, a, ctx, taskId);
  }
  private async current(
    tx: Prisma.TransactionClient,
    ctx: TaskToolContext,
    task: Task,
    edgeId: string,
  ) {
    const b = await tx.taskWorkflowBinding.findFirst({
      where: { ...scope(ctx), taskId: task.id },
    });
    if (!b) throw new NotFoundException();
    const v = await this.version(tx, ctx, b.workflowId, b.version),
      selected = rule(() =>
        workflowEdge(v.states, v.edges, b.stateId, task.status, edgeId),
      );
    return { b, ...selected };
  }
  private async move(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    task: Task,
    b: TaskWorkflowBinding,
    target: { id: string; status: Task['status'] },
    now: Date,
  ) {
    const actor = a.require(tx, ctx.spaceId, statusCap(target.status), {
      kind: 'TASK',
      id: task.id,
    });
    const change =
      target.status === 'DONE'
        ? transition(task, 'complete', now)
        : target.status === 'OPEN'
          ? transition(task, 'reopen', now)
          : { status: target.status, completedAt: null };
    await ctx.begin?.();
    const updated = await tx.task.update({
      where: { id: task.id },
      data: { ...change, revision: { increment: 1 } },
    });
    await tx.taskChange.create({
      data: {
        ...scope(ctx),
        actorId: actor.actorId,
        actorUserId: null,
        ...history(task, updated, 'UPDATED', ['status']),
      },
    });
    const binding = await tx.taskWorkflowBinding.update({
      where: { taskId: task.id },
      data: { stateId: target.id, revision: { increment: 1 } },
    });
    await event(
      tx,
      a,
      ctx,
      updated,
      'WORKFLOW_TRANSITION',
      { workflowId: b.workflowId, version: b.version, stateId: b.stateId },
      { workflowId: b.workflowId, version: b.version, stateId: target.id },
    );
    return { task: taskView(updated), binding: bindingView(binding, updated) };
  }
  async transition(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    taskId: string,
    expected: number,
    edgeId: string,
    key: string,
    fingerprint: string,
    now: Date,
  ) {
    const actor = a.require(tx, ctx.spaceId, 'workflow.transition'),
      task = await source(tx, a, ctx, taskId);
    const previous = await tx.taskWorkflowApproval.findFirst({
      where: {
        ...scope(ctx),
        requesterAccessId: actor.accessId,
        requesterGeneration: actor.generation,
        creationKey: key,
      },
    });
    if (previous) {
      if (previous.taskId !== taskId || previous.fingerprint !== fingerprint)
        throw new ConflictException();
      const v = await this.version(
          tx,
          ctx,
          previous.workflowId,
          previous.version,
        ),
        e = v.edges.find((e) => e.id === previous.edgeId)!;
      a.require(
        tx,
        ctx.spaceId,
        statusCap(v.states.find((s) => s.id === e.toStateId)!.status),
        { kind: 'TASK', id: taskId },
      );
      const b = await this.binding(tx, a, ctx, taskId);
      return {
        task: taskView(task),
        binding: b.binding!,
        approval: approvalView(previous),
      };
    }
    revision(task.revision, expected);
    const { b, edge, target } = await this.current(tx, ctx, task, edgeId);
    a.require(tx, ctx.spaceId, statusCap(target.status), {
      kind: 'TASK',
      id: taskId,
    });
    if (!edge.requiresApproval)
      return {
        ...(await this.move(tx, a, ctx, task, b, target, now)),
        approval: null,
      };
    // Full admission required for requests; a resource grant cannot impersonate a member.
    await participant(this.kernel, tx, ctx, actor.accessId, actor.generation, [
      'task.read',
      'workflow.transition',
      statusCap(target.status),
    ]);
    const pending = await tx.taskWorkflowApproval.findFirst({
      where: { ...scope(ctx), taskId, state: 'REQUESTED' },
    });
    await ctx.begin?.();
    if (pending) {
      if (pending.expiresAt > now)
        throw new ConflictException({ code: 'PENDING_WORKFLOW_APPROVAL' });
      await tx.taskWorkflowApproval.update({
        where: { id: pending.id },
        data: { state: 'EXPIRED', decidedAt: now, revision: { increment: 1 } },
      });
    }
    const approval = await tx.taskWorkflowApproval.create({
      data: {
        id: randomUUID(),
        ...scope(ctx),
        taskId,
        workflowId: b.workflowId,
        version: b.version,
        edgeId,
        requesterAccessId: actor.accessId,
        requesterGeneration: actor.generation,
        requestedByActorId: actor.actorId,
        sourceRevision: task.revision,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 1800000),
        creationKey: key,
        fingerprint,
      },
    });
    await event(tx, a, ctx, task, 'WORKFLOW_APPROVAL_REQUEST', null, {
      id: approval.id,
      edgeId,
    });
    return {
      task: taskView(task),
      binding: bindingView(b, task),
      approval: approvalView(approval),
    };
  }
  async approvals(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    taskId: string,
    after: string | undefined,
    limit: number,
  ) {
    await source(tx, a, ctx, taskId);
    return (
      await tx.taskWorkflowApproval.findMany({
        where: {
          ...scope(ctx),
          taskId,
          ...(after ? { id: { gt: after } } : {}),
        },
        orderBy: { id: 'asc' },
        take: limit,
      })
    ).map(approvalView);
  }
  async decide(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    taskId: string,
    id: string,
    expected: number,
    approve: boolean,
    now: Date,
  ) {
    const actor = a.require(tx, ctx.spaceId, 'workflow.transition'),
      task = await source(tx, a, ctx, taskId),
      request = await tx.taskWorkflowApproval.findFirst({
        where: { ...scope(ctx), taskId, id },
      });
    if (!request) throw new NotFoundException();
    const v = await this.version(tx, ctx, request.workflowId, request.version),
      edge = v.edges.find((e) => e.id === request.edgeId)!,
      target = v.states.find((s) => s.id === edge.toStateId)!;
    try {
      designatedApprover(
        edge,
        {
          accessId: request.requesterAccessId,
          actorId: request.requestedByActorId,
        },
        actor,
      );
    } catch {
      throw new ForbiddenException({ code: 'DESIGNATED_APPROVER_REQUIRED' });
    }
    a.require(tx, ctx.spaceId, statusCap(target.status), {
      kind: 'TASK',
      id: taskId,
    });
    await participant(this.kernel, tx, ctx, actor.accessId, actor.generation, [
      'task.read',
      'workflow.transition',
      statusCap(target.status),
    ]);
    if (request.state !== 'REQUESTED') {
      if (
        request.state !== (approve ? 'APPROVED' : 'REJECTED') ||
        request.decidedByActorId !== actor.actorId ||
        request.decisionGeneration !== actor.generation
      )
        throw new ConflictException();
      const b = await this.binding(tx, a, ctx, taskId);
      return {
        task: taskView(task),
        binding: b.binding!,
        approval: approvalView(request),
      };
    }
    revision(request.revision, expected);
    if (request.expiresAt <= now)
      throw new ConflictException({ code: 'WORKFLOW_APPROVAL_EXPIRED' });
    revision(task.revision, request.sourceRevision);
    const selected = await this.current(tx, ctx, task, request.edgeId);
    if (
      selected.b.workflowId !== request.workflowId ||
      selected.b.version !== request.version
    )
      throw new ConflictException();
    await participant(
      this.kernel,
      tx,
      ctx,
      request.requesterAccessId,
      request.requesterGeneration,
      ['task.read', 'workflow.transition', statusCap(target.status)],
    );
    await ctx.begin?.();
    const result = approve
      ? await this.move(tx, a, ctx, task, selected.b, target, now)
      : { task: taskView(task), binding: bindingView(selected.b, task) };
    const row = await tx.taskWorkflowApproval.update({
      where: { id },
      data: {
        state: approve ? 'APPROVED' : 'REJECTED',
        revision: { increment: 1 },
        decidedAt: now,
        decidedByActorId: actor.actorId,
        decisionAccessId: actor.accessId,
        decisionGeneration: actor.generation,
      },
    });
    await event(
      tx,
      a,
      ctx,
      { ...task, revision: result.task.revision },
      'WORKFLOW_APPROVAL_DECISION',
      { id, state: request.state },
      { id, state: row.state },
    );
    return { ...result, approval: approvalView(row) };
  }
}
