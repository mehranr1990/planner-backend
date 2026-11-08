import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '../../../generated/prisma/client.js';
import { Prisma as P } from '../../../generated/prisma/client.js';
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
import { ProjectsService } from './projects.service.js';
import { appendProjectActivity } from './project-activity.js';
import type { TaskToolContext } from '../../tasks/public/index.js';
export const executionHash = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function executionKey(raw: string | undefined) {
  if (!raw || !/^[!-~]{1,128}$/.test(raw)) throw new BadRequestException();
  return executionHash(raw);
}
export type ExecutionContext = TaskToolContext & {
  tx: Prisma.TransactionClient;
  a: SharedAuthority;
  pid: string;
  now: Date;
  didWrite: boolean;
  begin: () => Promise<void>;
  grow: (feature: SharedFeatureKey, count?: number) => Promise<void>;
  member: (
    accessId: string,
    generation: number,
    caps?: SharedRequest['capability'][],
  ) => Promise<{ accessId: string; generation: number; actorId: string }>;
};
export const projectWhere = (
  s: Pick<ExecutionContext, 'spaceId' | 'scopeId' | 'pid'>,
) => ({
  spaceId: s.spaceId,
  scopeId: s.scopeId,
  projectId: s.pid,
});
export type ExecutionTarget = string | { kind: 'GOAL' | 'PROJECT'; id: string };
export function matchRevision(actual: number, expected: number) {
  if (actual !== expected)
    throw new ConflictException({ code: 'STALE_REVISION' });
}
@Injectable()
export class ProjectExecutionContext {
  constructor(
    @Inject(SharedKernel) readonly kernel: SharedKernel,
    @Inject(CollaborationService)
    private readonly collaboration: CollaborationService,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
  ) {}
  private requests(
    pid: string,
    caps: SharedRequest['capability'][],
    tid?: ExecutionTarget,
    archived = false,
  ) {
    return [...new Set([...caps, 'task.read' as const])].map((capability) => ({
      spaceId: pid,
      scopeId: pid,
      capability,
      allowArchived: archived,
      ...(tid &&
      !['work.manage', 'workflow.transition', 'workflow.publish'].includes(
        capability,
      )
        ? {
            resource:
              typeof tid === 'string'
                ? { kind: 'TASK' as const, id: tid }
                : tid,
          }
        : {}),
    }));
  }
  private context(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    actor: RequestActor,
    pid: string,
    now: Date,
    lockedUsers: string[],
    begin: () => Promise<void>,
    grow: ExecutionContext['grow'],
  ): ExecutionContext {
    const s: ExecutionContext = {
      tx,
      a,
      actor,
      pid,
      spaceId: a.space(tx, pid),
      scopeId: pid,
      lockedUsers,
      now,
      didWrite: false,
      begin: async () => {
        await begin();
        s.didWrite = true;
      },
      grow,
      member: async (id, generation, caps = ['task.read']) => {
        const user = await this.kernel.memberUserInTransaction(tx, pid, id);
        if (!user || !lockedUsers.includes(user)) throw new NotFoundException();
        return this.kernel.toolParticipant(tx, pid, id, generation, user, caps);
      },
    };
    return s;
  }
  async linked(s: ExecutionContext, taskId: ExecutionTarget) {
    if (typeof taskId !== 'string') {
      if (taskId.kind === 'PROJECT') {
        if (taskId.id !== s.pid) throw new NotFoundException();
        return;
      }
      if (
        !(await s.tx.projectGoal.findFirst({
          where: { ...projectWhere(s), goalId: taskId.id },
        }))
      )
        throw new NotFoundException();
      return;
    }
    if (
      !(await s.tx.projectTask.findFirst({
        where: { ...projectWhere(s), taskId },
      }))
    )
      throw new NotFoundException();
  }
  async read<T>(
    actor: RequestActor,
    pid: string,
    caps: SharedRequest['capability'][],
    taskId: ExecutionTarget | undefined,
    work: (s: ExecutionContext) => Promise<T>,
    optionalCaps: SharedRequest['capability'][] = [],
  ) {
    await this.projects.hint(pid);
    return this.kernel.run(
      actor,
      { spaceIds: [pid], userIds: [] },
      this.requests(pid, caps, taskId, true),
      async (tx, a) => {
        const now = (
            await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() now`
          )[0]!.now,
          s = this.context(
            tx,
            a,
            actor,
            pid,
            now,
            [],
            async () => {
              throw new ForbiddenException();
            },
            async () => {
              throw new ForbiddenException();
            },
          );
        if (taskId) await this.linked(s, taskId);
        return work(s);
      },
      undefined,
      optionalCaps.length ? this.requests(pid, optionalCaps, taskId, true) : [],
    );
  }
  async write<T>(
    actor: RequestActor,
    pid: string,
    caps: SharedRequest['capability'][],
    taskId: ExecutionTarget | undefined,
    action: string,
    target: string,
    accessIds: string[],
    work: (s: ExecutionContext) => Promise<T>,
    feature?: SharedFeatureKey,
  ) {
    await this.projects.hint(pid);
    const requests = this.requests(pid, caps, taskId),
      hints = await Promise.all(
        [...new Set(accessIds)].map((id) =>
          this.kernel.memberUserHint(pid, id),
        ),
      ),
      users = [
        ...hints.filter((id): id is string => Boolean(id)),
        ...(await this.kernel.resourceLockHints(actor, requests)),
      ];
    return this.collaboration.signed(
      actor,
      pid,
      users,
      action,
      target,
      async (tx, now, locked, begin) => {
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
              locked,
            ),
          );
        const a = new SharedAuthority(tx, entries, pid),
          usage = new Map<SharedFeatureKey, number>();
        let audit: string | undefined;
        const s = this.context(
          tx,
          a,
          actor,
          pid,
          now,
          locked,
          async () => {
            audit ??= await begin();
          },
          async (f, count = 1) => {
            await this.kernel.featureBatchGrowth(
              tx,
              pid,
              f,
              (usage.get(f) ?? 0) + count,
            );
            usage.set(f, (usage.get(f) ?? 0) + count);
          },
        );
        try {
          if (taskId) await this.linked(s, taskId);
          const result = await work(s);
          if (audit) {
            if (
              !['file.', 'comment.', 'document.', 'export.', 'transfer.'].some(
                (prefix) => action.startsWith(prefix),
              ) &&
              !action.includes('.preview') &&
              !action.includes('.plan.')
            ) {
              await appendProjectActivity(
                tx,
                pid,
                entries[0]!.actorId,
                action,
                target,
                typeof taskId === 'string'
                  ? { kind: 'TASK', id: taskId }
                  : taskId,
              );
            }
            if (feature) usage.set(feature, (usage.get(feature) ?? 0) + 1);
            await this.kernel.offerBatchEffect(
              tx,
              actor,
              pid,
              entries[0]!.actorId,
              action,
              target,
              audit,
              [...usage].map(([feature, delta]) => ({ feature, delta })),
            );
          }
          return result;
        } catch (error) {
          if (error instanceof P.PrismaClientKnownRequestError) {
            if (error.code === 'P2002') throw new ConflictException();
            if (error.code === 'P2003') throw new BadRequestException();
            if (error.code === 'P2025') throw new NotFoundException();
          }
          throw error;
        } finally {
          a.close();
        }
      },
    );
  }
  page<T extends { id: string }>(
    s: ExecutionContext,
    kind: string,
    query: { limit: number; after?: string | undefined },
    rows: (after: string | undefined) => Promise<T[]>,
    target?: ExecutionTarget,
  ) {
    const request = this.requests(s.pid, [], target, true)[0]!,
      b = this.kernel.scopeCursor(s.tx, s.a, request, kind),
      after = this.kernel.cursorPosition(
        b.context,
        b.stamp,
        s.actor.userId,
        query.after,
      );
    return rows(after).then((items) =>
      this.kernel.cursorPage(b.context, b.stamp, s.actor.userId, {
        items: items.slice(0, query.limit),
        nextCursor:
          items.length > query.limit ? items[query.limit - 1]!.id : null,
      }),
    );
  }
}
