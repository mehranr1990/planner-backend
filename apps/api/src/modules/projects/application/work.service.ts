import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type {
  Prisma,
  TaskAssignment as Row,
} from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import {
  SharedKernel,
  SharedAuthority,
  SpacesService,
  CollaborationService,
} from '../../spaces/public/index.js';
import type { SharedRequest } from '../../spaces/public/index.js';
import { SharedTasks } from '../../tasks/public/index.js';
import { SharedGoals } from '../../goals/public/index.js';
import { SharedScheduling } from '../../calendar/public/index.js';
import { SharedWorkNotifications } from '../../notifications/public/index.js';
import { ProjectsService } from './projects.service.js';
import { appendProjectActivity } from './project-activity.js';
import {
  respondToAssignment,
  endAssignment,
} from '../domain/task-assignment.js';
import type { TaskAssignment } from '../domain/task-assignment.js';
const hash = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
const key = (s: string | undefined) => {
  if (!s || !/^[!-~]{1,128}$/.test(s)) throw new BadRequestException();
  return hash(s);
};
const view = (r: Row) =>
  c.TaskAssignmentSchema.strip().parse({
    ...r,
    createdAt: r.createdAt.toISOString(),
    respondedAt: r.respondedAt?.toISOString() ?? null,
    endedAt: r.endedAt?.toISOString() ?? null,
  });
const page = <T extends { id: string }>(rows: T[], limit: number) => ({
  items: rows.slice(0, limit),
  nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
});
function rule<T>(work: () => T) {
  try {
    return work();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('INVALID_'))
      throw new BadRequestException();
    throw new ConflictException();
  }
}
@Injectable()
export class WorkService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(CollaborationService)
    private readonly collaboration: CollaborationService,
    @Inject(SpacesService) private readonly spaces: SpacesService,
    @Inject(SharedTasks) private readonly tasks: SharedTasks,
    @Inject(SharedGoals) private readonly goals: SharedGoals,
    @Inject(SharedScheduling) private readonly scheduling: SharedScheduling,
    @Inject(SharedWorkNotifications)
    private readonly notifications: SharedWorkNotifications,
  ) {}
  private request(
    spaceId: string,
    capability: SharedRequest['capability'],
    archived = false,
  ): SharedRequest {
    return { spaceId, scopeId: spaceId, capability, allowArchived: archived };
  }
  private async source(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    pid: string,
    taskId: string,
  ) {
    const link = await tx.projectTask.findFirst({
      where: { projectId: pid, taskId },
    });
    if (!link) throw new NotFoundException();
    return this.tasks.read(tx, a, link.spaceId, taskId);
  }
  private async row(
    tx: Prisma.TransactionClient,
    pid: string,
    taskId: string,
    id: string,
  ) {
    const row = await tx.taskAssignment.findFirst({
      where: { id, projectId: pid, taskId, spaceId: pid, scopeId: pid },
    });
    if (!row) throw new NotFoundException();
    return row;
  }
  private async command<T>(
    actor: RequestActor,
    pid: string,
    cap: SharedRequest['capability'],
    users: string[],
    action: string,
    target: string,
    work: (
      tx: Prisma.TransactionClient,
      a: SharedAuthority,
      now: Date,
      begin: () => Promise<string>,
    ) => Promise<T>,
  ) {
    const project = await this.projects.hint(pid);
    return this.collaboration.signed(
      actor,
      project.spaceId,
      users,
      action,
      target,
      async (tx, now, locked, begin) => {
        const request = this.request(project.spaceId, cap);
        const access = await this.kernel.participantAuthority(
          tx,
          actor,
          actor.userId,
          request,
          locked,
        );
        const read = await this.kernel.participantAuthority(
          tx,
          actor,
          actor.userId,
          this.request(project.spaceId, 'task.read'),
          locked,
        );
        const authority = new SharedAuthority(tx, [access, read]);
        try {
          let changed = false;
          const result = await work(tx, authority, now, async () => {
            const id = await begin();
            changed = true;
            return id;
          });
          if (changed) {
            const assignment = await tx.taskAssignment.findFirst({
              where: { id: target, projectId: pid },
            });
            const taskId = assignment?.taskId ?? target;
            await appendProjectActivity(
              tx,
              pid,
              access.actorId,
              action,
              target,
              { kind: 'TASK', id: taskId },
            );
          }
          return result;
        } finally {
          authority.close();
        }
      },
    );
  }
  async create(
    actor: RequestActor,
    pid: string,
    taskId: string,
    sourceRevision: number,
    input: z.infer<typeof c.TaskAssignmentCreateSchema>,
    rawKey: string | undefined,
    replaces?: { id: string; revision: number },
  ) {
    const creationKey = key(rawKey),
      fingerprint = hash({
        pid,
        taskId,
        sourceRevision,
        input,
        replaces: replaces ?? null,
      });
    const recipientUser = await this.kernel.memberUserHint(
      pid,
      input.recipientAccessId,
    );
    return this.command(
      actor,
      pid,
      'assignment.assign',
      recipientUser ? [recipientUser] : [],
      replaces ? 'assignment.reassign' : 'assignment.create',
      input.id,
      async (tx, a, now, begin) => {
        const access = a.require(tx, pid, 'assignment.assign');
        const source = await this.source(tx, a, pid, taskId);
        const previous = await tx.taskAssignment.findFirst({
          where: {
            issuerAccessId: access.accessId,
            issuerGeneration: access.generation,
            creationKey,
          },
        });
        if (previous) {
          if (previous.id !== input.id || previous.fingerprint !== fingerprint)
            throw new ConflictException();
          return view(previous);
        }
        if (source.revision !== sourceRevision) throw new ConflictException();
        const recipient = await this.kernel.assignmentRecipient(
          tx,
          pid,
          input.recipientAccessId,
          input.recipientGeneration,
          recipientUser,
        );
        if (
          (await tx.taskAssignment.count({
            where: { spaceId: pid, taskId, endedAt: null },
          })) >= 100
        )
          throw new BadRequestException({ code: 'ASSIGNMENT_SAFETY_LIMIT' });
        if (await tx.taskAssignment.findUnique({ where: { id: input.id } }))
          throw new ConflictException();
        let old: Row | null = null;
        if (replaces) {
          old = await this.row(tx, pid, taskId, replaces.id);
          if (old.kind !== input.kind || old.revision !== replaces.revision)
            throw new ConflictException();
        }
        const current = await tx.taskAssignment.findFirst({
          where: {
            spaceId: pid,
            taskId,
            endedAt: null,
            OR: [
              { recipientAccessId: input.recipientAccessId },
              ...(input.kind === 'PRIMARY' ? [{ kind: 'PRIMARY' }] : []),
            ],
          },
        });
        if (current?.id !== old?.id && current) throw new ConflictException();
        await this.kernel.featureGrowth(tx, pid, 'task.assignment');
        const auditId = await begin();
        if (old && !old.endedAt) {
          const ended = rule(() =>
            endAssignment(
              old as TaskAssignment,
              old!.revision,
              'REASSIGNED',
              now,
            ),
          );
          await tx.taskAssignment.update({
            where: { id: old.id },
            data: {
              endedAt: ended.endedAt,
              endReason: ended.endReason,
              revision: ended.revision,
            },
          });
          const oldActor = await this.kernel.localActor(
            tx,
            pid,
            old.recipientAccessId,
          );
          if (oldActor)
            await this.notifications.append(tx, a, {
              spaceId: pid,
              assignmentId: old.id,
              recipientActorId: oldActor,
              kind: 'REASSIGNED',
              assignmentRevision: ended.revision,
            });
        }
        const created = await tx.taskAssignment.create({
          data: {
            ...input,
            spaceId: pid,
            scopeId: pid,
            projectId: pid,
            taskId,
            createdByActorId: access.actorId,
            issuerAccessId: access.accessId,
            issuerGeneration: access.generation,
            creationKey,
            fingerprint,
            selectedTaskRevision: source.revision,
            createdAt: now,
          },
        });
        await this.notifications.append(tx, a, {
          spaceId: pid,
          assignmentId: created.id,
          recipientActorId: recipient.actorId,
          kind: 'ASSIGNED',
          assignmentRevision: 1,
        });
        await this.kernel.offerEffect(
          tx,
          actor,
          pid,
          access.actorId,
          replaces ? 'assignment.reassign' : 'assignment.create',
          created.id,
          auditId,
          { actorId: access.actorId, feature: 'task.assignment', delta: 1 },
        );
        return view(created);
      },
    );
  }
  async reassign(
    actor: RequestActor,
    pid: string,
    taskId: string,
    id: string,
    revision: number,
    input: z.infer<typeof c.TaskAssignmentReassignSchema>,
    rawKey: string | undefined,
  ) {
    const hint = await this.db.client.taskAssignment.findFirst({
      where: { id, projectId: pid, taskId },
    });
    if (!hint) throw new NotFoundException();
    return this.create(
      actor,
      pid,
      taskId,
      input.sourceRevision,
      {
        id: input.id,
        recipientAccessId: input.recipientAccessId,
        recipientGeneration: input.recipientGeneration,
        kind: hint.kind as 'PRIMARY' | 'CONTRIBUTOR',
      },
      rawKey,
      { id, revision },
    );
  }
  async get(actor: RequestActor, pid: string, taskId: string, id: string) {
    await this.projects.hint(pid);
    return this.kernel.run(
      actor,
      { userIds: [], spaceIds: [pid] },
      [this.request(pid, 'task.read', true)],
      async (tx, a) => {
        const source = await this.source(tx, a, pid, taskId),
          row = await this.row(tx, pid, taskId, id),
          access = a.require(tx, pid, 'task.read');
        if (
          row.recipientAccessId !== access.accessId ||
          row.recipientGeneration !== access.generation
        ) {
          // A current assignment administrator may inspect its source-scoped history.
          const manager = await this.kernel.assignmentManager(tx, a, pid);
          if (!manager) throw new NotFoundException();
        }
        return {
          assignment: view(row),
          preview: {
            id: source.id,
            spaceId: source.spaceId,
            title: source.title,
            revision: source.revision,
          },
        };
      },
    );
  }
  async list(
    actor: RequestActor,
    pid: string,
    taskId: string,
    q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    await this.projects.hint(pid);
    const r = this.request(pid, 'assignment.assign');
    return this.kernel.run(
      actor,
      { userIds: [], spaceIds: [pid] },
      [r, this.request(pid, 'task.read')],
      async (tx, a) => {
        await this.source(tx, a, pid, taskId);
        const b = this.kernel.scopeCursor(tx, a, r, 'assignments:' + taskId),
          after = this.kernel.cursorPosition(
            b.context,
            b.stamp,
            actor.userId,
            q.after,
          );
        const rows = await tx.taskAssignment.findMany({
          where: {
            projectId: pid,
            taskId,
            ...(after ? { id: { gt: after } } : {}),
          },
          orderBy: { id: 'asc' },
          take: q.limit + 1,
        });
        return this.kernel.cursorPage(
          b.context,
          b.stamp,
          actor.userId,
          page(rows.map(view), q.limit),
        );
      },
    );
  }
  async respond(
    actor: RequestActor,
    pid: string,
    taskId: string,
    id: string,
    revision: number,
    response:
      { decision: 'ACCEPTED' } | { decision: 'DECLINED'; reason: string },
  ) {
    const cap =
        response.decision === 'ACCEPTED'
          ? 'assignment.accept'
          : 'assignment.decline',
      action =
        response.decision === 'ACCEPTED'
          ? 'assignment.accept'
          : 'assignment.decline';
    return this.command(
      actor,
      pid,
      cap,
      [],
      action,
      id,
      async (tx, a, now, begin) => {
        await this.source(tx, a, pid, taskId);
        const before = await this.row(tx, pid, taskId, id),
          access = a.require(tx, pid, cap);
        if (
          before.recipientAccessId !== access.accessId ||
          before.recipientGeneration !== access.generation
        )
          throw new NotFoundException();
        if (
          before.decision === response.decision &&
          (!before.endedAt || before.endReason === 'DECLINED')
        ) {
          if (
            response.decision === 'DECLINED' &&
            before.declineReason !== response.reason.trim()
          )
            throw new ConflictException();
          return view(before);
        }
        const result = rule(() =>
          respondToAssignment(
            before as TaskAssignment,
            {
              spaceId: pid,
              scopeId: pid,
              accessId: access.accessId,
              generation: access.generation,
            },
            revision,
            response,
            now,
          ),
        );
        const auditId = await begin();
        const row = await tx.taskAssignment.update({
          where: { id },
          data: {
            decision: result.decision,
            respondedAt: result.respondedAt,
            declineReason: result.declineReason,
            endedAt: result.endedAt,
            endReason: result.endReason,
            revision: result.revision,
          },
        });
        await this.notifications.append(tx, a, {
          spaceId: pid,
          assignmentId: id,
          recipientActorId: before.createdByActorId,
          assignmentRevision: row.revision,
          kind: response.decision,
        });
        await this.kernel.offerEffect(
          tx,
          actor,
          pid,
          access.actorId,
          action,
          id,
          auditId,
        );
        return view(row);
      },
    );
  }
  async revoke(
    actor: RequestActor,
    pid: string,
    taskId: string,
    id: string,
    revision: number,
  ) {
    return this.command(
      actor,
      pid,
      'assignment.assign',
      [],
      'assignment.revoke',
      id,
      async (tx, a, now, begin) => {
        await this.source(tx, a, pid, taskId);
        const row = await this.row(tx, pid, taskId, id),
          access = a.require(tx, pid, 'assignment.assign');
        if (row.endReason === 'REVOKED') return view(row);
        const ended = rule(() =>
          endAssignment(row as TaskAssignment, revision, 'REVOKED', now),
        );
        const auditId = await begin();
        const updated = await tx.taskAssignment.update({
          where: { id },
          data: {
            endedAt: ended.endedAt,
            endReason: ended.endReason,
            revision: ended.revision,
          },
        });
        // A retained local actor reference is enough for the durable inbox event.
        const recipientActor = await this.kernel.localActor(
          tx,
          pid,
          row.recipientAccessId,
        );
        if (recipientActor)
          await this.notifications.append(tx, a, {
            spaceId: pid,
            assignmentId: id,
            recipientActorId: recipientActor,
            assignmentRevision: updated.revision,
            kind: 'REVOKED',
          });
        await this.kernel.offerEffect(
          tx,
          actor,
          pid,
          access.actorId,
          'assignment.revoke',
          id,
          auditId,
        );
        return view(updated);
      },
    );
  }
  async policy(actor: RequestActor, pid: string) {
    await this.projects.hint(pid);
    return this.kernel.run(
      actor,
      { userIds: [], spaceIds: [pid] },
      [this.request(pid, 'task.read')],
      (tx, a) => this.kernel.assignmentPolicy(tx, a, pid),
    );
  }
  async schedule(
    actor: RequestActor,
    pid: string,
    taskId: string,
    input?: {
      revision: number;
      value: z.infer<typeof c.SharedTaskScheduleInputSchema>;
    },
  ) {
    await this.projects.hint(pid);
    const r = this.request(pid, input ? 'task.update' : 'task.read', !input);
    r.resource = { kind: 'TASK', id: taskId };
    const read: SharedRequest = {
      spaceId: pid,
      scopeId: pid,
      capability: 'task.read',
      resource: { kind: 'TASK', id: taskId },
      allowArchived: !input,
    };
    return this.kernel.run(
      actor,
      { userIds: [], spaceIds: [pid] },
      input ? [r, read] : [r],
      async (tx, a) => {
        if (
          !(await tx.projectTask.findFirst({
            where: { taskId, projectId: pid },
          }))
        )
          throw new NotFoundException();
        const value = await this.tasks.schedule(tx, a, pid, taskId, input);
        if (input)
          await this.kernel.offerEffect(
            tx,
            actor,
            pid,
            a.require(tx, pid, 'task.update', { kind: 'TASK', id: taskId })
              .actorId,
            'task.schedule',
            taskId,
            randomUUID(),
          );
        if (input)
          await appendProjectActivity(
            tx,
            pid,
            a.require(tx, pid, 'task.update', { kind: 'TASK', id: taskId })
              .actorId,
            'task.schedule',
            taskId,
            { kind: 'TASK', id: taskId },
          );
        return value;
      },
    );
  }
  private async projection<T>(
    actor: RequestActor,
    kind: string,
    q: object & { after?: string | undefined },
    goals: boolean,
    work: (
      tx: Prisma.TransactionClient,
      a: SharedAuthority,
      hints: Awaited<ReturnType<SharedKernel['workHints']>>,
      after: string | undefined,
    ) => Promise<{ items: T[]; nextCursor: string | null }>,
  ) {
    const hints = await this.kernel.workHints(actor, goals),
      { after: _cursor, ...filter } = q,
      context = 'work:' + kind + ':' + hash(filter).slice(0, 24);
    const after = this.kernel.cursorPosition(
      context,
      hints.stamp,
      actor.userId,
      q.after,
    );
    if (!hints.requests.length)
      return this.kernel.personalWork(actor, async () => ({
        items: [] as T[],
        nextCursor: null,
      }));
    return this.kernel.run(
      actor,
      { userIds: [], spaceIds: hints.spaceIds },
      hints.requests,
      async (tx, a) => {
        for (const r of hints.requests) {
          const access = a.require(tx, r.spaceId, r.capability, r.resource),
            member = hints.members.find((m) => m.id === r.spaceId),
            resource = hints.resources.find(
              (s) => s.spaceId === r.spaceId && s.id === r.resource?.id,
            );
          if (
            String(access.authorizationVersion) !==
              (member?.version ?? resource?.version) ||
            (member && access.generation !== member.generation)
          )
            throw new ConflictException({ code: 'CURSOR_AUTHORITY_CHANGED' });
        }
        return this.kernel.cursorPage(
          context,
          hints.stamp,
          actor.userId,
          await work(tx, a, hints, after),
        );
      },
    );
  }
  private ownAssignments(
    tx: Prisma.TransactionClient,
    hints: Awaited<ReturnType<SharedKernel['workHints']>>,
    decision?: string,
    projectId?: string,
  ) {
    return tx.taskAssignment.findMany({
      where: {
        OR: hints.members.map((m) => ({
          spaceId: m.id,
          recipientAccessId: m.accessId,
          recipientGeneration: m.generation,
        })),
        ...(decision ? { decision, endedAt: null } : {}),
        ...(projectId ? { projectId } : {}),
      },
      orderBy: { taskId: 'asc' },
    });
  }
  async pending(
    actor: RequestActor,
    q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    return this.projection(
      actor,
      'pending',
      q,
      false,
      async (tx, a, h, after) => {
        const rows = await this.ownAssignments(tx, h, 'PENDING'),
          items = [];
        for (const row of rows
          .filter((r) => !after || r.id > after)
          .sort((x, y) => x.id.localeCompare(y.id))) {
          try {
            const source = await this.source(tx, a, row.projectId, row.taskId);
            items.push({
              id: row.id,
              assignment: view(row),
              preview: {
                id: source.id,
                spaceId: source.spaceId,
                title: source.title,
                revision: source.revision,
              },
            });
          } catch (e) {
            if (!(e instanceof NotFoundException)) throw e;
          }
          if (items.length > q.limit) break;
        }
        const result = page(items, q.limit);
        return {
          items: result.items.map(({ id: _id, ...v }) => v),
          nextCursor: result.nextCursor,
        };
      },
    );
  }
  async taskProjection(
    actor: RequestActor,
    q: z.infer<typeof c.WorkTaskQuerySchema>,
  ) {
    return this.projection(
      actor,
      'tasks',
      q,
      false,
      async (tx, a, h, after) => {
        const rows = await this.ownAssignments(tx, h, 'ACCEPTED', q.projectId),
          byTask = new Map(rows.map((r) => [r.taskId, r]));
        const sources = await this.tasks.project(
          tx,
          a,
          [...byTask.values()].map((r) => ({
            spaceId: r.spaceId,
            id: r.taskId,
          })),
          {
            limit: q.limit + 1,
            ...(after ? { after } : {}),
            ...(q.status ? { status: q.status } : {}),
          },
        );
        return page(
          sources.map((s) => ({
            id: s.task.id,
            projectId: byTask.get(s.task.id)!.projectId,
            ...s,
            assignment: view(byTask.get(s.task.id)!),
          })),
          q.limit,
        );
      },
    );
  }
  async goalProjection(
    actor: RequestActor,
    q: z.infer<typeof c.WorkGoalQuerySchema>,
  ) {
    return this.projection(actor, 'goals', q, true, async (tx, a, h, after) => {
      const links = await tx.projectGoal.findMany({
        where: {
          OR: [
            { spaceId: { in: h.ids } },
            ...h.resources.map((r) => ({ spaceId: r.spaceId, goalId: r.id })),
          ],
          ...(q.projectId ? { projectId: q.projectId } : {}),
        },
      });
      const byId = new Map(links.map((l) => [l.goalId, l])),
        goals = await this.goals.project(
          tx,
          a,
          links.map((l) => ({ spaceId: l.spaceId, id: l.goalId })),
          {
            limit: q.limit + 1,
            ...(after ? { after } : {}),
            ...(q.status ? { status: q.status } : {}),
          },
        );
      return page(
        goals.map((goal) => ({
          id: goal.id,
          projectId: byId.get(goal.id)!.projectId,
          goal,
        })),
        q.limit,
      );
    });
  }
  async overlays(
    actor: RequestActor,
    q: z.infer<typeof c.WorkOverlayQuerySchema>,
  ) {
    return this.projection(
      actor,
      'overlays',
      q,
      false,
      async (tx, a, h, after) => {
        const assignments = (
          await this.ownAssignments(tx, h, 'ACCEPTED')
        ).filter((r) => !q.projectIds || q.projectIds.includes(r.projectId));
        const byId = new Map(assignments.map((r) => [r.taskId, r]));
        const sources = await this.tasks.project(
          tx,
          a,
          assignments.map((r) => ({ spaceId: r.spaceId, id: r.taskId })),
          {
            limit: q.limit + 1,
            ...(after ? { after } : {}),
            range: { from: q.from, to: q.to, timezone: q.timezone },
          },
        );
        const items = [];
        const format = new Intl.DateTimeFormat('en-CA', {
          timeZone: q.timezone,
          calendar: 'iso8601',
          numberingSystem: 'latn',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        });
        for (const s of sources) {
          const instant = s.schedule.plannedStartAt ?? s.schedule.dueAt;
          const parts = instant
            ? Object.fromEntries(
                format
                  .formatToParts(new Date(instant))
                  .map((p) => [p.type, p.value]),
              )
            : null;
          const date = instant
            ? `${parts!.year}-${parts!.month}-${parts!.day}`
            : s.schedule.scheduledDate;
          if (!date || date < q.from || date >= q.to) continue;
          items.push({
            id: s.task.id,
            projectId: byId.get(s.task.id)!.projectId,
            spaceId: s.task.spaceId,
            sourceRevision: s.task.revision,
            title: s.task.title,
            kind: instant ? ('TIMED' as const) : ('ALL_DAY' as const),
            date,
            startAt: instant,
            endAt: instant ? s.schedule.dueAt : null,
          });
          if (items.length > q.limit) break;
        }
        return page(items, q.limit);
      },
    );
  }
  async inbox(
    actor: RequestActor,
    q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    return this.projection(
      actor,
      'notifications',
      q,
      false,
      async (tx, a, h, after) => {
        const assignments = await tx.taskAssignment.findMany({
            where: { spaceId: { in: h.ids } },
          }),
          visible = [];
        for (const row of assignments) {
          try {
            await this.source(tx, a, row.projectId, row.taskId);
            visible.push(row.id);
          } catch (e) {
            if (!(e instanceof NotFoundException)) throw e;
          }
        }
        return page(
          await this.notifications.list(
            tx,
            a,
            h.ids,
            visible,
            after,
            q.limit + 1,
          ),
          q.limit,
        );
      },
    );
  }
  async markNotification(
    actor: RequestActor,
    pid: string,
    id: string,
    revision: number,
  ) {
    return this.kernel.run(
      actor,
      { userIds: [], spaceIds: [pid] },
      [this.request(pid, 'task.read')],
      async (tx, a) => {
        const notice = await this.notifications.read(tx, a, pid, id, revision);
        const row = await tx.taskAssignment.findFirst({
          where: { id: notice.assignmentId, spaceId: pid },
        });
        if (!row) throw new NotFoundException();
        await this.source(tx, a, row.projectId, row.taskId);
        return notice;
      },
    );
  }
  async block(
    actor: RequestActor,
    id: string,
    change?: {
      revision: number;
      value: z.infer<typeof c.SharedTaskBlockInputSchema> | null;
    },
  ) {
    const scope = await this.spaces.authorizePersonal(actor);
    if (change?.value) {
      const input = change.value,
        r: SharedRequest = {
          spaceId: input.spaceId,
          scopeId: input.spaceId,
          capability: 'task.read',
          resource: { kind: 'TASK', id: input.taskId },
        };
      return this.kernel.run(
        actor,
        { userIds: [], spaceIds: [input.spaceId] },
        [r],
        async (tx, a) => {
          const source = await this.tasks.read(
            tx,
            a,
            input.spaceId,
            input.taskId,
          );
          if (source.revision !== input.sourceRevision)
            throw new ConflictException();
          const row = await this.scheduling.change(
            tx,
            scope,
            id,
            change.revision,
            input,
          );
          return { ...row, source, availability: 'AVAILABLE' as const };
        },
      );
    }
    const row = await this.kernel.personalWork(actor, (tx) =>
      change
        ? this.scheduling.change(tx, scope, id, change.revision, null)
        : this.scheduling.read(tx, scope, id),
    );
    if (!row.link)
      return { ...row, source: null, availability: 'UNLINKED' as const };
    try {
      const r: SharedRequest = {
        spaceId: row.link.spaceId,
        scopeId: row.link.spaceId,
        capability: 'task.read',
        resource: { kind: 'TASK', id: row.link.taskId },
        allowArchived: true,
      };
      const source = await this.kernel.run(
        actor,
        { userIds: [], spaceIds: [r.spaceId] },
        [r],
        (tx, a) => this.tasks.read(tx, a, r.spaceId, row.link!.taskId),
      );
      return { ...row, source, availability: 'AVAILABLE' as const };
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      )
        return { ...row, source: null, availability: 'UNAVAILABLE' as const };
      throw error;
    }
  }
}
