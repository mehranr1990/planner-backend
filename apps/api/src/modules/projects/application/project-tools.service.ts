import {
  Inject,
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import {
  SharedKernel,
  SharedAuthority,
  CollaborationService,
} from '../../spaces/public/index.js';
import type {
  SharedRequest,
  SharedFeatureKey,
} from '../../spaces/public/index.js';
import { ProjectTaskTools } from '../../tasks/public/index.js';
import type { TaskToolContext } from '../../tasks/public/index.js';
import { ProjectsService } from './projects.service.js';
import { appendProjectActivity } from './project-activity.js';
type Session = {
  tx: Prisma.TransactionClient;
  a: SharedAuthority;
  ctx: TaskToolContext;
  now: Date;
};
const hash = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
const key = (raw: string | undefined) => {
  if (!raw || !/^[!-~]{1,128}$/.test(raw)) throw new BadRequestException();
  return hash(raw);
};
type Cap = SharedRequest['capability'];
@Injectable()
export class ProjectToolsService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
    @Inject(CollaborationService)
    private readonly collaboration: CollaborationService,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(ProjectTaskTools) private readonly tools: ProjectTaskTools,
  ) {}
  private requests(
    pid: string,
    caps: Cap[],
    taskId?: string,
    archived = false,
  ): SharedRequest[] {
    return [...new Set([...caps, 'task.read' as const])].map((capability) => ({
      spaceId: pid,
      scopeId: pid,
      capability,
      ...(taskId &&
      !['workflow.publish', 'workflow.transition', 'work.manage'].includes(
        capability,
      )
        ? { resource: { kind: 'TASK' as const, id: taskId } }
        : {}),
      allowArchived: archived,
    }));
  }
  private async users(pid: string, accessIds: string[]) {
    const users = await Promise.all(
      [...new Set(accessIds)].map((id) => this.kernel.memberUserHint(pid, id)),
    );
    return users.filter((v): v is string => Boolean(v));
  }
  private async linked(
    tx: Prisma.TransactionClient,
    pid: string,
    taskId?: string,
  ) {
    if (
      taskId &&
      !(await tx.projectTask.findFirst({
        where: { projectId: pid, taskId, spaceId: pid, scopeId: pid },
      }))
    )
      throw new NotFoundException();
  }
  private async read<T>(
    actor: RequestActor,
    pid: string,
    caps: Cap[],
    taskId: string | undefined,
    work: (s: Session) => Promise<T>,
  ) {
    await this.projects.hint(pid);
    return this.kernel.run(
      actor,
      { spaceIds: [pid], userIds: [] },
      this.requests(pid, caps, taskId, true),
      async (tx, a) => {
        await this.linked(tx, pid, taskId);
        return work({
          tx,
          a,
          ctx: { spaceId: pid, scopeId: pid, actor, lockedUsers: [] },
          now: new Date(),
        });
      },
    );
  }
  private async command<T>(
    actor: RequestActor,
    pid: string,
    caps: Cap[],
    taskId: string | undefined,
    action: string,
    target: string,
    accessIds: string[],
    work: (s: Session, k: string, f: string) => Promise<T>,
    options?: {
      key: string | undefined;
      input: unknown;
      replay: (s: Session) => Promise<T>;
      feature?: SharedFeatureKey;
    },
  ) {
    await this.projects.hint(pid);
    const requests = this.requests(pid, caps, taskId),
      users = [
        ...(await this.users(pid, accessIds)),
        ...(await this.kernel.resourceLockHints(actor, requests)),
      ],
      creationKey = options ? key(options.key) : '',
      fingerprint = options ? hash({ pid, target, input: options.input }) : '';
    return this.collaboration.signed(
      actor,
      pid,
      users,
      action,
      target,
      async (tx, now, lockedUsers, begin) => {
        let audit: string | undefined;
        const entries: Awaited<
          ReturnType<SharedKernel['participantAuthority']>
        >[] = [];
        for (const r of requests)
          entries.push(
            await this.kernel.participantAuthority(
              tx,
              actor,
              actor.userId,
              r,
              lockedUsers,
            ),
          );
        const a = new SharedAuthority(tx, entries),
          ctx = {
            spaceId: pid,
            scopeId: pid,
            actor,
            lockedUsers,
            begin: async () => {
              audit ??= await begin();
            },
          },
          s = { tx, a, ctx, now };
        try {
          await this.linked(tx, pid, taskId);
          let result: T | undefined;
          const mutate = async () => {
            result = await work(s, creationKey, fingerprint);
            const actorId = entries[0]!.actorId;
            if (audit && !action.includes('.preview'))
              await appendProjectActivity(
                tx,
                pid,
                actorId,
                action,
                target,
                taskId ? { kind: 'TASK', id: taskId } : undefined,
              );
            if (audit)
              await this.kernel.offerEffect(
                tx,
                actor,
                pid,
                actorId,
                action,
                target,
                audit,
                options?.feature
                  ? { actorId, feature: options.feature, delta: 1 }
                  : undefined,
              );
            return { id: target, statusCode: 200 };
          };
          if (options)
            await this.kernel.receipt(
              tx,
              a,
              requests[0]!,
              {
                operation: action,
                key: 'generation:' + entries[0]!.generation + ':' + creationKey,
                fingerprint,
              },
              mutate,
            );
          else await mutate();
          return result === undefined ? await options!.replay(s) : result;
        } finally {
          a.close();
        }
      },
    );
  }
  private async paged<T extends { id: string }>(
    actor: RequestActor,
    pid: string,
    taskId: string | undefined,
    kind: string,
    q: z.infer<typeof c.ProjectPageQuerySchema>,
    work: (s: Session, after: string | undefined) => Promise<T[]>,
  ) {
    return this.read(actor, pid, [], taskId, async (s) => {
      const r = this.requests(pid, [], taskId, true)[0]!,
        b = this.kernel.scopeCursor(s.tx, s.a, r, kind),
        after = this.kernel.cursorPosition(
          b.context,
          b.stamp,
          actor.userId,
          q.after,
        ),
        rows = await work(s, after);
      return this.kernel.cursorPage(b.context, b.stamp, actor.userId, {
        items: rows.slice(0, q.limit),
        nextCursor: rows.length > q.limit ? rows[q.limit - 1]!.id : null,
      });
    });
  }
  workflows(
    actor: RequestActor,
    pid: string,
    q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    return this.paged(
      actor,
      pid,
      undefined,
      'workflows',
      q,
      ({ tx, a, ctx }, after) =>
        this.tools.workflows(tx, a, ctx, after, q.limit + 1),
    );
  }
  workflow(actor: RequestActor, pid: string, id: string, version: number) {
    return this.read(actor, pid, [], undefined, ({ tx, a, ctx }) =>
      this.tools.workflow(tx, a, ctx, id, version),
    );
  }
  publishWorkflow(
    actor: RequestActor,
    pid: string,
    id: string,
    expected: number,
    input: z.infer<typeof c.WorkflowVersionInputSchema>,
    raw: string | undefined,
  ) {
    return this.command(
      actor,
      pid,
      ['workflow.publish'],
      undefined,
      'workflow.publish',
      id,
      input.edges.flatMap((e) => e.approvers.map((p) => p.accessId)),
      (s, k, f) =>
        this.tools.publishWorkflow(s.tx, s.a, s.ctx, id, expected, input, k, f),
      {
        key: raw,
        input: { expected, input },
        feature: 'task.workflow-version',
        replay: (s) => this.tools.workflow(s.tx, s.a, s.ctx, id, expected + 1),
      },
    );
  }
  binding(actor: RequestActor, pid: string, tid: string) {
    return this.read(actor, pid, [], tid, (s) =>
      this.tools.binding(s.tx, s.a, s.ctx, tid),
    );
  }
  bind(
    actor: RequestActor,
    pid: string,
    tid: string,
    rev: number,
    input: z.infer<typeof c.WorkflowBindSchema>,
  ) {
    return this.command(
      actor,
      pid,
      ['workflow.publish', 'task.update'],
      tid,
      'workflow.bind',
      tid,
      [],
      (s) => this.tools.bind(s.tx, s.a, s.ctx, tid, rev, input),
    );
  }
  async transition(
    actor: RequestActor,
    pid: string,
    tid: string,
    rev: number,
    edgeId: string,
    raw: string | undefined,
  ) {
    const cap = await this.tools.transitionHint(
      this.db.client,
      pid,
      tid,
      edgeId,
    );
    return this.command(
      actor,
      pid,
      ['workflow.transition', cap],
      tid,
      'workflow.transition',
      tid,
      [],
      (s, k, f) =>
        this.tools.transition(s.tx, s.a, s.ctx, tid, rev, edgeId, k, f, s.now),
      {
        key: raw,
        input: { rev, edgeId, cap },
        replay: (s) =>
          this.tools.replayedTransition(
            s.tx,
            s.a,
            s.ctx,
            tid,
            key(raw),
            hash({ pid, target: tid, input: { rev, edgeId, cap } }),
          ),
      },
    );
  }
  approvals(
    actor: RequestActor,
    pid: string,
    tid: string,
    q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    return this.paged(actor, pid, tid, 'approvals:' + tid, q, (s, after) =>
      this.tools.approvals(s.tx, s.a, s.ctx, tid, after, q.limit + 1),
    );
  }
  async decide(
    actor: RequestActor,
    pid: string,
    tid: string,
    id: string,
    rev: number,
    approve: boolean,
  ) {
    const requester = await this.tools.approvalHint(
        this.db.client,
        pid,
        pid,
        id,
      ),
      cap = await this.tools.transitionHint(this.db.client, pid, tid, '', id);
    return this.command(
      actor,
      pid,
      ['workflow.transition', cap],
      tid,
      'workflow.approval.' + (approve ? 'approve' : 'reject'),
      id,
      requester ? [requester] : [],
      (s) => this.tools.decide(s.tx, s.a, s.ctx, tid, id, rev, approve, s.now),
    );
  }
  fields(
    actor: RequestActor,
    pid: string,
    q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    return this.paged(actor, pid, undefined, 'fields', q, (s, after) =>
      this.tools.fields(s.tx, s.a, s.ctx, after, q.limit + 1),
    );
  }
  field(actor: RequestActor, pid: string, id: string, version: number) {
    return this.read(actor, pid, [], undefined, (s) =>
      this.tools.field(s.tx, s.a, s.ctx, id, version),
    );
  }
  publishField(
    actor: RequestActor,
    pid: string,
    id: string,
    rev: number,
    input: z.infer<typeof c.CustomFieldVersionInputSchema>,
    raw: string | undefined,
  ) {
    const p =
      input.kind === 'PERSON' &&
      input.defaultValue &&
      typeof input.defaultValue === 'object' &&
      !Array.isArray(input.defaultValue) &&
      'accessId' in input.defaultValue
        ? [input.defaultValue.accessId]
        : [];
    return this.command(
      actor,
      pid,
      ['work.manage'],
      undefined,
      'field.publish',
      id,
      p,
      (s, k, f) =>
        this.tools.publishField(s.tx, s.a, s.ctx, id, rev, input, k, f),
      {
        key: raw,
        input: { rev, input },
        feature: 'task.field-version',
        replay: (s) => this.tools.field(s.tx, s.a, s.ctx, id, rev + 1),
      },
    );
  }
  deprecateField(actor: RequestActor, pid: string, id: string, rev: number) {
    return this.command(
      actor,
      pid,
      ['work.manage'],
      undefined,
      'field.deprecate',
      id,
      [],
      (s) => this.tools.deprecateField(s.tx, s.a, s.ctx, id, rev, s.now),
    );
  }
  values(actor: RequestActor, pid: string, tid: string) {
    return this.read(actor, pid, [], tid, (s) =>
      this.tools.values(s.tx, s.a, s.ctx, tid),
    );
  }
  async setValue(
    actor: RequestActor,
    pid: string,
    tid: string,
    id: string,
    rev: number,
    input: z.infer<typeof c.CustomFieldSetSchema>,
  ) {
    const people = input.useDefault
      ? await this.tools.peopleHint(this.db.client, pid, pid, id, input.version)
      : input.value &&
          typeof input.value === 'object' &&
          !Array.isArray(input.value) &&
          'accessId' in input.value
        ? [input.value.accessId]
        : [];
    return this.command(
      actor,
      pid,
      ['task.update'],
      tid,
      'field.value',
      tid,
      people,
      (s) => this.tools.setValue(s.tx, s.a, s.ctx, tid, id, rev, input),
    );
  }
  search(
    actor: RequestActor,
    pid: string,
    input: z.infer<typeof c.CustomFieldSearchSchema>,
  ) {
    const { after: _after, ...filter } = input;
    return this.paged(
      actor,
      pid,
      undefined,
      'field-search:' + hash(filter).slice(0, 24),
      input,
      (s, after) =>
        this.tools.search(s.tx, s.a, s.ctx, input, after, input.limit + 1),
    );
  }
  graph(actor: RequestActor, pid: string) {
    return this.read(actor, pid, [], undefined, (s) =>
      this.tools.graph(s.tx, s.a, s.ctx),
    );
  }
  dependency(
    actor: RequestActor,
    pid: string,
    input: z.infer<typeof c.DependencyInputSchema>,
  ) {
    return this.command(
      actor,
      pid,
      ['work.manage'],
      undefined,
      'dependency.create',
      input.id,
      [],
      (s) => this.tools.dependency(s.tx, s.a, s.ctx, input),
    );
  }
  async patchDependency(
    actor: RequestActor,
    pid: string,
    id: string,
    rev: number,
    lagMinutes: number,
  ) {
    return this.command(
      actor,
      pid,
      ['work.manage'],
      undefined,
      'dependency.update',
      id,
      [],
      async (s) => {
        const edge = (await this.tools.graph(s.tx, s.a, s.ctx)).edges.find(
          (e) => e.id === id,
        );
        if (!edge) throw new NotFoundException();
        return this.tools.dependency(
          s.tx,
          s.a,
          s.ctx,
          {
            id,
            predecessorId: edge.predecessorId,
            successorId: edge.successorId,
            kind: edge.kind,
            lagMinutes,
          },
          rev,
        );
      },
    );
  }
  retireDependency(actor: RequestActor, pid: string, id: string, rev: number) {
    return this.command(
      actor,
      pid,
      ['work.manage'],
      undefined,
      'dependency.retire',
      id,
      [],
      (s) => this.tools.retireDependency(s.tx, s.a, s.ctx, id, rev, s.now),
    );
  }
  preview(
    actor: RequestActor,
    pid: string,
    input: z.infer<typeof c.ReschedulePreviewInputSchema>,
    raw: string | undefined,
  ) {
    return this.command(
      actor,
      pid,
      ['work.manage', 'task.update'],
      undefined,
      'reschedule.preview',
      input.id,
      [],
      (s, k, f) => this.tools.preview(s.tx, s.a, s.ctx, input, k, f, s.now),
      {
        key: raw,
        input,
        feature: 'task.reschedule-preview',
        replay: (s) => this.tools.plan(s.tx, s.a, s.ctx, input.id),
      },
    );
  }
  plan(actor: RequestActor, pid: string, id: string) {
    return this.read(actor, pid, ['work.manage'], undefined, (s) =>
      this.tools.plan(s.tx, s.a, s.ctx, id),
    );
  }
  apply(
    actor: RequestActor,
    pid: string,
    id: string,
    rev: number,
    manifestHash: string,
  ) {
    return this.command(
      actor,
      pid,
      ['work.manage', 'task.update'],
      undefined,
      'reschedule.apply',
      id,
      [],
      (s) => this.tools.apply(s.tx, s.a, s.ctx, id, rev, manifestHash, s.now),
    );
  }
  history(
    actor: RequestActor,
    pid: string,
    tid: string,
    q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    return this.paged(actor, pid, tid, 'metadata:' + tid, q, (s, after) =>
      this.tools.history(s.tx, s.a, s.ctx, tid, after, q.limit + 1),
    );
  }
}
