import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type {
  TeamKeyResult,
  TeamTaskAssignment,
  TeamTimeOff,
} from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { SharedTasks, SharedTaskWork } from '../../tasks/public/index.js';
import {
  SharedGoals,
  goalProgress,
  keyResultProgress,
  periodProgress,
} from '../../goals/public/index.js';
import { wallInstant } from '../../calendar/public/index.js';
import { TeamInteractionContext } from './team-interaction.context.js';
import type { Interaction, Member } from './team-interaction.context.js';
import {
  addDays,
  boardState,
  checkinStatus,
  checkinWindow,
  weekdayOf,
} from '../domain/collaboration.js';
import type { CheckinSchedule, TaskStatus } from '../domain/collaboration.js';
type Page = z.infer<typeof c.ProjectPageQuerySchema>;
const ref = (accessId: string, generation: number): Member => ({
  accessId,
  generation,
});
const same = (a: Member, b: Member) =>
  a.accessId === b.accessId && a.generation === b.generation;
const date = (v: string) => new Date(v + 'T00:00:00Z');
const day = (d: Date) => d.toISOString().slice(0, 10);
const open = ['PENDING', 'ACCEPTED'];
const localDay = (now: Date, timezone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
@Injectable()
export class TeamOperationsService {
  constructor(
    @Inject(TeamInteractionContext) private readonly op: TeamInteractionContext,
    @Inject(SharedTasks) private readonly tasks: SharedTasks,
    @Inject(SharedTaskWork) private readonly work: SharedTaskWork,
    @Inject(SharedGoals) private readonly goals: SharedGoals,
  ) {}
  private me(s: Interaction): Member {
    const a = this.op.access(s);
    return ref(a.accessId, a.generation);
  }
  /** `work.manage` under the Team's current capability policy. */
  private manager(s: Interaction) {
    return this.op.eligible(s, this.me(s), 'WORK');
  }
  private async current(s: Interaction) {
    return (await this.op.kernel.currentMemberships(s.tx, s.a, s.id)).filter(
      (m) => m.state === 'ACTIVE',
    );
  }
  private async actorMember(s: Interaction, actorId: string) {
    const row = await s.tx.contextAccess.findFirst({
      where: { ...this.op.scope(s), actorId },
    });
    return row ? ref(row.id, row.generation) : null;
  }
  private async notify(
    s: Interaction,
    recipients: Member[],
    kind: z.infer<typeof c.TeamNotificationSchema>['kind'],
    subjectId: string,
    dedupeKey: string,
  ) {
    if (!recipients.length) return 0;
    return (
      await s.tx.teamNotification.createMany({
        data: recipients.map((m) => ({
          id: randomUUID(),
          ...this.op.scope(s),
          recipientAccessId: m.accessId,
          recipientGeneration: m.generation,
          kind,
          subjectId,
          dedupeKey,
        })),
        skipDuplicates: true,
      })
    ).count;
  }
  /** Current Team Task rows for projections; deleted or unreadable Tasks are skipped. */
  private async workTasks(s: Interaction, ids: string[]) {
    if (ids.length > 500) throw new PayloadTooLargeException();
    const result = new Map<
      string,
      z.infer<typeof c.TeamMyWorkSchema>['pending'][number]['task']
    >();
    const overlays = new Map(
      (
        await s.tx.teamTaskState.findMany({
          where: { spaceId: this.op.scope(s).spaceId, taskId: { in: ids } },
        })
      ).map((o) => [o.taskId, o]),
    );
    for (const taskId of [...new Set(ids)]) {
      let task;
      try {
        task = await this.tasks.read(s.tx, s.a, s.id, taskId);
      } catch (error) {
        if (error instanceof NotFoundException) continue;
        throw error;
      }
      const [m] = await this.work.metrics(s.tx, s.a, s.id, [taskId]);
      result.set(taskId, {
        sourceId: taskId,
        title: task.title,
        status: task.status as TaskStatus,
        boardState: boardState(task.status as TaskStatus, overlays.get(taskId)),
        dueAt: m!.dueAt,
        scheduledDate: m!.scheduledDate,
        estimatedMinutes: m!.estimatedMinutes,
      });
    }
    return result;
  }

  // Assignments -------------------------------------------------------------
  private assignmentView(r: TeamTaskAssignment, me: Member, manager: boolean) {
    const mine = same(ref(r.assigneeAccessId, r.assigneeGeneration), me),
      issued = same(ref(r.issuerAccessId, r.issuerGeneration), me),
      live = open.includes(r.state);
    return c.TeamAssignmentSchema.parse({
      id: r.id,
      taskId: r.taskId,
      assignee: ref(r.assigneeAccessId, r.assigneeGeneration),
      issuer: ref(r.issuerAccessId, r.issuerGeneration),
      state: r.state,
      declineReason: mine || issued || manager ? r.declineReason : null,
      endReason: r.endReason,
      revision: r.revision,
      createdAt: r.createdAt.toISOString(),
      respondedAt: r.respondedAt?.toISOString() ?? null,
      endedAt: r.endedAt?.toISOString() ?? null,
      can: {
        accept: mine && r.state === 'PENDING',
        decline: mine && r.state === 'PENDING',
        remove: live && (manager || (mine && issued)),
        reassign: live && manager,
        remind: live && !mine && (manager || issued),
      },
    });
  }
  private async assignmentRow(s: Interaction, assignmentId: string) {
    const row = await s.tx.teamTaskAssignment.findFirst({
      where: { id: assignmentId, ...this.op.scope(s) },
    });
    if (!row) throw new NotFoundException();
    return row;
  }
  private event(
    s: Interaction,
    assignmentId: string,
    action: z.infer<typeof c.TeamAssignmentEventSchema>['action'],
  ) {
    return s.tx.teamTaskAssignmentEvent.create({
      data: {
        id: randomUUID(),
        ...this.op.scope(s),
        assignmentId,
        action,
        actorId: this.op.access(s).actorId,
      },
    });
  }
  private async insertAssignment(
    s: Interaction,
    id: string,
    taskId: string,
    assignee: Member,
  ) {
    const me = this.me(s),
      self = same(assignee, me);
    if (
      await s.tx.teamTaskAssignment.findFirst({
        where: {
          spaceId: this.op.scope(s).spaceId,
          taskId,
          assigneeAccessId: assignee.accessId,
          state: { in: open },
        },
      })
    )
      throw new ConflictException({ code: 'ALREADY_ASSIGNED' });
    const row = await s.tx.teamTaskAssignment.create({
      data: {
        id,
        ...this.op.scope(s),
        taskId,
        assigneeAccessId: assignee.accessId,
        assigneeGeneration: assignee.generation,
        issuerAccessId: me.accessId,
        issuerGeneration: me.generation,
        state: self ? 'ACCEPTED' : 'PENDING',
        respondedAt: self ? s.now : null,
      },
    });
    await this.event(s, row.id, 'ASSIGNED');
    if (!self)
      await this.notify(
        s,
        [assignee],
        'ASSIGNMENT',
        row.id,
        'assignment:' + id,
      );
    return row;
  }
  private async assignable(s: Interaction, taskId: string, assignee: Member) {
    const manager = await this.manager(s);
    if (!same(assignee, this.me(s)) && !manager) throw new ForbiddenException();
    await this.op.member(s, assignee, ['task.update']);
    const task = await this.tasks.read(s.tx, s.a, s.id, taskId);
    if (task.status === 'DONE' || task.status === 'CANCELED')
      throw new ConflictException({ code: 'TASK_CLOSED' });
    return manager;
  }
  assignments(
    actor: RequestActor,
    id: string,
    q: z.infer<typeof c.TeamAssignmentQuerySchema>,
  ) {
    return this.op.read(actor, id, async (s) => {
      const me = this.me(s),
        manager = await this.manager(s);
      return this.op.page(
        s,
        'team-assignments:' + (q.taskId ?? '') + ':' + (q.open ?? ''),
        q,
        async (after) =>
          (
            await s.tx.teamTaskAssignment.findMany({
              where: {
                ...this.op.scope(s),
                ...(q.taskId ? { taskId: q.taskId } : {}),
                ...(q.open === 'true'
                  ? { state: { in: open } }
                  : q.open === 'false'
                    ? { state: { notIn: open } }
                    : {}),
                ...(after ? { id: { gt: after } } : {}),
              },
              orderBy: { id: 'asc' },
              take: q.limit + 1,
            })
          ).map((r) => this.assignmentView(r, me, manager)),
      );
    });
  }
  assign(
    actor: RequestActor,
    id: string,
    sourceId: string,
    input: z.infer<typeof c.TeamAssignmentCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.TeamAssignmentCreateSchema.parse(input);
    return this.op.write(
      actor,
      id,
      'task.create',
      [body.assignee],
      'team.assignment.create',
      body.id,
      async (s) => {
        const manager = await this.assignable(s, sourceId, body.assignee);
        await this.op.once(
          s,
          'team.assignment.create',
          key,
          { ...body, sourceId },
          async () => {
            await s.begin();
            return this.insertAssignment(s, body.id, sourceId, body.assignee);
          },
        );
        const row = await this.assignmentRow(s, body.id);
        if (row.taskId !== sourceId) throw new ConflictException();
        return this.assignmentView(row, this.me(s), manager);
      },
    );
  }
  respond(
    actor: RequestActor,
    id: string,
    assignmentId: string,
    revision: number,
    action: 'accept' | 'decline' | 'remove',
    input?: z.infer<typeof c.TeamAssignmentDeclineSchema>,
  ) {
    const body =
      action === 'decline' ? c.TeamAssignmentDeclineSchema.parse(input) : null;
    return this.op.write(
      actor,
      id,
      'task.read',
      [],
      'team.assignment.' + action,
      assignmentId,
      async (s) => {
        const row = await this.assignmentRow(s, assignmentId),
          me = this.me(s),
          manager = await this.manager(s),
          mine = same(ref(row.assigneeAccessId, row.assigneeGeneration), me),
          issued = same(ref(row.issuerAccessId, row.issuerGeneration), me);
        this.op.match(row.revision, revision);
        if (action === 'remove') {
          if (!open.includes(row.state))
            throw new ConflictException({ code: 'ASSIGNMENT_CLOSED' });
          if (!manager && !(mine && issued)) throw new ForbiddenException();
        } else {
          if (!mine) throw new ForbiddenException();
          if (row.state !== 'PENDING')
            throw new ConflictException({ code: 'ASSIGNMENT_CLOSED' });
        }
        await s.begin();
        const updated = await s.tx.teamTaskAssignment.update({
          where: { id: row.id, revision: row.revision },
          data:
            action === 'remove'
              ? {
                  state: 'REMOVED',
                  endedAt: s.now,
                  endReason: 'REMOVED',
                  endedByActorId: this.op.access(s).actorId,
                  revision: { increment: 1 },
                }
              : {
                  state: action === 'accept' ? 'ACCEPTED' : 'DECLINED',
                  respondedAt: s.now,
                  declineReason: body?.reason ?? null,
                  revision: { increment: 1 },
                },
        });
        await this.event(
          s,
          row.id,
          action === 'accept'
            ? 'ACCEPTED'
            : action === 'decline'
              ? 'DECLINED'
              : 'REMOVED',
        );
        return this.assignmentView(updated, me, manager);
      },
    );
  }
  reassign(
    actor: RequestActor,
    id: string,
    assignmentId: string,
    revision: number,
    input: z.infer<typeof c.TeamAssignmentReassignSchema>,
  ) {
    const body = c.TeamAssignmentReassignSchema.parse(input);
    return this.op.write(
      actor,
      id,
      'work.manage',
      [body.assignee],
      'team.assignment.reassign',
      assignmentId,
      async (s) => {
        const me = this.me(s);
        const previous = await this.assignmentRow(s, assignmentId);
        const replay = await s.tx.teamTaskAssignment.findFirst({
          where: { id: body.id, ...this.op.scope(s) },
        });
        if (replay) {
          if (
            previous.endReason !== 'REASSIGNED' ||
            replay.taskId !== previous.taskId ||
            !same(
              ref(replay.assigneeAccessId, replay.assigneeGeneration),
              body.assignee,
            )
          )
            throw new ConflictException();
          return c.TeamAssignmentReassignResultSchema.parse({
            previous: this.assignmentView(previous, me, true),
            current: this.assignmentView(replay, me, true),
          });
        }
        this.op.match(previous.revision, revision);
        if (!open.includes(previous.state))
          throw new ConflictException({ code: 'ASSIGNMENT_CLOSED' });
        if (body.assignee.accessId === previous.assigneeAccessId)
          throw new ConflictException({ code: 'SAME_ASSIGNEE' });
        await this.assignable(s, previous.taskId, body.assignee);
        await s.begin();
        const ended = await s.tx.teamTaskAssignment.update({
          where: { id: previous.id, revision: previous.revision },
          data: {
            state: 'REMOVED',
            endedAt: s.now,
            endReason: 'REASSIGNED',
            endedByActorId: this.op.access(s).actorId,
            revision: { increment: 1 },
          },
        });
        await this.event(s, previous.id, 'REASSIGNED');
        const current = await this.insertAssignment(
          s,
          body.id,
          previous.taskId,
          body.assignee,
        );
        return c.TeamAssignmentReassignResultSchema.parse({
          previous: this.assignmentView(ended, me, true),
          current: this.assignmentView(current, me, true),
        });
      },
    );
  }
  remind(actor: RequestActor, id: string, assignmentId: string) {
    return this.op.write(
      actor,
      id,
      'task.read',
      [],
      'team.assignment.remind',
      assignmentId,
      async (s) => {
        const row = await this.assignmentRow(s, assignmentId),
          me = this.me(s),
          assignee = ref(row.assigneeAccessId, row.assigneeGeneration);
        if (
          (!same(ref(row.issuerAccessId, row.issuerGeneration), me) &&
            !(await this.manager(s))) ||
          same(assignee, me)
        )
          throw new ForbiddenException();
        if (!open.includes(row.state))
          throw new ConflictException({ code: 'ASSIGNMENT_CLOSED' });
        if (
          !(await this.current(s)).some((m) =>
            same(ref(m.id, m.generation), assignee),
          )
        )
          throw new ConflictException({ code: 'MEMBER_NOT_CURRENT' });
        await s.begin();
        const delivered = await this.notify(
          s,
          [assignee],
          'ASSIGNMENT_REMINDER',
          row.id,
          'assignment-reminder:' + row.id + ':' + day(s.now),
        );
        if (delivered) await this.event(s, row.id, 'REMINDED');
        return c.TeamRemindResultSchema.parse({ delivered });
      },
    );
  }
  assignmentHistory(
    actor: RequestActor,
    id: string,
    assignmentId: string,
    q: Page,
  ) {
    return this.op.read(actor, id, async (s) => {
      await this.assignmentRow(s, assignmentId);
      return this.op.page(
        s,
        'team-assignment-history:' + assignmentId,
        q,
        async (after) => {
          const rows = await s.tx.teamTaskAssignmentEvent.findMany({
            where: {
              ...this.op.scope(s),
              assignmentId,
              ...(after ? { id: { gt: after } } : {}),
            },
            orderBy: { id: 'asc' },
            take: q.limit + 1,
          });
          return Promise.all(
            rows.map(async (r) =>
              c.TeamAssignmentEventSchema.parse({
                id: r.id,
                action: r.action,
                by: await this.actorMember(s, r.actorId),
                createdAt: r.createdAt.toISOString(),
              }),
            ),
          );
        },
      );
    });
  }
  myWork(actor: RequestActor, id: string) {
    return this.op.read(actor, id, async (s) => {
      const me = this.me(s),
        manager = await this.manager(s);
      const rows = await s.tx.teamTaskAssignment.findMany({
        where: {
          ...this.op.scope(s),
          assigneeAccessId: me.accessId,
          assigneeGeneration: me.generation,
          state: { in: open },
        },
        orderBy: { id: 'asc' },
        take: 501,
      });
      if (rows.length > 500) throw new PayloadTooLargeException();
      const tasks = await this.workTasks(
        s,
        rows.map((r) => r.taskId),
      );
      const item = (r: TeamTaskAssignment) =>
        tasks.has(r.taskId)
          ? [
              {
                assignment: this.assignmentView(r, me, manager),
                task: tasks.get(r.taskId)!,
              },
            ]
          : [];
      return c.TeamMyWorkSchema.parse({
        member: me,
        pending: rows.filter((r) => r.state === 'PENDING').flatMap(item),
        accepted: rows.filter((r) => r.state === 'ACCEPTED').flatMap(item),
      });
    });
  }
  nowWorking(actor: RequestActor, id: string) {
    return this.op.read(actor, id, async (s) => {
      const members = await this.current(s);
      const rows = await s.tx.teamTaskAssignment.findMany({
        where: {
          ...this.op.scope(s),
          state: 'ACCEPTED',
          OR: members.map((m) => ({
            assigneeAccessId: m.id,
            assigneeGeneration: m.generation,
          })),
        },
        orderBy: { id: 'asc' },
        take: 501,
      });
      if (rows.length > 500) throw new PayloadTooLargeException();
      const tasks = await this.workTasks(
        s,
        rows.map((r) => r.taskId),
      );
      const items = [];
      for (const m of members) {
        const working = rows
          .filter(
            (r) =>
              r.assigneeAccessId === m.id &&
              r.assigneeGeneration === m.generation &&
              tasks.get(r.taskId)?.boardState === 'IN_PROGRESS',
          )
          .map((r) => ({
            sourceId: r.taskId,
            title: tasks.get(r.taskId)!.title,
          }));
        if (working.length)
          items.push({ member: ref(m.id, m.generation), tasks: working });
      }
      return c.TeamNowWorkingSchema.parse({ items });
    });
  }
  removalPreview(actor: RequestActor, id: string, accessId: string) {
    return this.op.read(actor, id, async (s) => {
      if (!(await this.manager(s))) throw new ForbiddenException();
      const target = (
        await this.op.kernel.currentMemberships(s.tx, s.a, id)
      ).find((m) => m.id === accessId);
      if (!target) throw new NotFoundException();
      const member = ref(target.id, target.generation),
        today = date(day(s.now));
      const assignments = await s.tx.teamTaskAssignment.findMany({
        where: {
          ...this.op.scope(s),
          assigneeAccessId: member.accessId,
          assigneeGeneration: member.generation,
          state: { in: open },
        },
        take: 5001,
      });
      if (assignments.length > 5000) throw new PayloadTooLargeException();
      const accepted = assignments.filter((r) => r.state === 'ACCEPTED');
      const tasks = accepted.length
        ? await this.workTasks(
            s,
            accepted.slice(0, 500).map((r) => r.taskId),
          )
        : new Map();
      const timeOff = {
        ...this.op.scope(s),
        accessId,
        generation: target.generation,
      };
      return c.TeamRemovalPreviewSchema.parse({
        member,
        openAssignments: assignments.length,
        pendingAssignments: assignments.length - accepted.length,
        inProgressAssignedTasks: [...tasks.values()].filter(
          (t) => t.status === 'IN_PROGRESS',
        ).length,
        pendingTimeOff: await s.tx.teamTimeOff.count({
          where: { ...timeOff, state: 'PENDING' },
        }),
        upcomingApprovedTimeOff: await s.tx.teamTimeOff.count({
          where: { ...timeOff, state: 'APPROVED', endDate: { gte: today } },
        }),
        futureCapacityDays: await s.tx.teamCapacityDay.count({
          where: {
            spaceId: this.op.scope(s).spaceId,
            scopeId: id,
            accessId,
            generation: target.generation,
            date: { gte: today },
          },
        }),
      });
    });
  }

  // Story points --------------------------------------------------------------
  private pointsView(
    taskId: string,
    r: { points: number | null; revision: number; updatedAt: Date } | null,
  ) {
    return c.TeamTaskPointsSchema.parse({
      taskId,
      points: r?.points ?? null,
      revision: r?.revision ?? 1,
      updatedAt: r?.updatedAt.toISOString() ?? null,
    });
  }
  setPoints(
    actor: RequestActor,
    id: string,
    sourceId: string,
    revision: number,
    input: z.infer<typeof c.TeamTaskPointsInputSchema>,
  ) {
    const body = c.TeamTaskPointsInputSchema.parse(input);
    return this.op.write(
      actor,
      id,
      'task.update',
      [],
      'team.task.points',
      sourceId,
      async (s) => {
        await this.tasks.read(s.tx, s.a, id, sourceId);
        const scope = this.op.scope(s),
          before = await s.tx.teamTaskPoints.findUnique({
            where: {
              spaceId_taskId: { spaceId: scope.spaceId, taskId: sourceId },
            },
          });
        this.op.match(before?.revision ?? 1, revision);
        await s.begin();
        const actorId = this.op.access(s).actorId;
        const row = before
          ? await s.tx.teamTaskPoints.update({
              where: { id: before.id, revision: before.revision },
              data: {
                points: body.points,
                updatedByActorId: actorId,
                updatedAt: s.now,
                revision: { increment: 1 },
              },
            })
          : await s.tx.teamTaskPoints.create({
              data: {
                id: randomUUID(),
                ...scope,
                taskId: sourceId,
                points: body.points,
                updatedByActorId: actorId,
                updatedAt: s.now,
              },
            });
        return this.pointsView(sourceId, row);
      },
    );
  }
  points(actor: RequestActor, id: string, q: Page) {
    return this.op
      .read(actor, id, (s) =>
        this.op.page(s, 'team-task-points', q, async (after) =>
          (
            await s.tx.teamTaskPoints.findMany({
              where: {
                ...this.op.scope(s),
                ...(after ? { id: { gt: after } } : {}),
              },
              orderBy: { id: 'asc' },
              take: q.limit + 1,
            })
          ).map((r) => ({ ...this.pointsView(r.taskId, r), id: r.id })),
        ),
      )
      .then((page) => ({
        ...page,
        items: page.items.map(({ id: _id, ...rest }) => rest),
      }));
  }
  planPoints(actor: RequestActor, id: string, planId: string) {
    return this.op.read(actor, id, async (s) => {
      const scope = this.op.scope(s),
        plan = await s.tx.teamPlan.findFirst({
          where: { id: planId, ...scope },
        });
      if (!plan) throw new NotFoundException();
      const items = await s.tx.teamWorkItem.findMany({
        where: { ...scope, planId, sourceScopeId: id, taskId: { not: null } },
        select: { taskId: true },
        take: 501,
      });
      if (items.length > 500) throw new PayloadTooLargeException();
      const tasks = await this.workTasks(
        s,
        items.map((i) => i.taskId!),
      );
      const points = new Map(
        (
          await s.tx.teamTaskPoints.findMany({
            where: {
              spaceId: scope.spaceId,
              taskId: { in: [...tasks.keys()] },
            },
          })
        ).map((p) => [p.taskId, p.points]),
      );
      let planned = 0,
        completed = 0,
        unestimated = 0;
      for (const [taskId, task] of tasks) {
        const value = points.get(taskId);
        if (value === undefined || value === null) unestimated++;
        else {
          planned += value;
          if (task.status === 'DONE') completed += value;
        }
      }
      return c.TeamPlanPointsSchema.parse({
        planId,
        kind: plan.kind,
        plannedPoints: planned,
        completedPoints: completed,
        plannedTasks: tasks.size,
        unestimatedTasks: unestimated,
      });
    });
  }

  // Time off ----------------------------------------------------------------
  private timeOffView(r: TeamTimeOff, me: Member, manager: boolean, now: Date) {
    const mine = same(ref(r.accessId, r.generation), me),
      privileged = mine || manager;
    return c.TeamTimeOffSchema.parse({
      id: r.id,
      member: ref(r.accessId, r.generation),
      startDate: day(r.startDate),
      endDate: day(r.endDate),
      minutesPerDay: r.minutesPerDay,
      reason: privileged ? r.reason : null,
      state: r.state,
      decisionNote: privileged ? r.decisionNote : null,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      revision: r.revision,
      createdAt: r.createdAt.toISOString(),
      can: {
        decide: manager && !mine && r.state === 'PENDING',
        cancel:
          mine &&
          (r.state === 'PENDING' ||
            (r.state === 'APPROVED' && r.endDate >= date(day(now)))),
      },
    });
  }
  private async timeOffRow(s: Interaction, timeOffId: string) {
    const row = await s.tx.teamTimeOff.findFirst({
      where: { id: timeOffId, ...this.op.scope(s) },
    });
    if (!row) throw new NotFoundException();
    return row;
  }
  private timeOffEvent(
    s: Interaction,
    timeOffId: string,
    action: z.infer<typeof c.TeamTimeOffEventSchema>['action'],
  ) {
    return s.tx.teamTimeOffEvent.create({
      data: {
        id: randomUUID(),
        ...this.op.scope(s),
        timeOffId,
        action,
        actorId: this.op.access(s).actorId,
      },
    });
  }
  /** Viewers see only their own entries; other roles see the Team calendar of absences. */
  private async visibleTimeOff(s: Interaction) {
    const viewer = this.op.access(s).role === 'VIEWER',
      me = this.me(s);
    return {
      ...this.op.scope(s),
      ...(viewer ? { accessId: me.accessId, generation: me.generation } : {}),
    };
  }
  timeOff(
    actor: RequestActor,
    id: string,
    q: z.infer<typeof c.TeamTimeOffQuerySchema>,
  ) {
    return this.op.read(actor, id, async (s) => {
      const me = this.me(s),
        manager = await this.manager(s),
        where = await this.visibleTimeOff(s);
      return this.op.page(
        s,
        'team-time-off:' + (q.state ?? ''),
        q,
        async (after) =>
          (
            await s.tx.teamTimeOff.findMany({
              where: {
                ...where,
                ...(q.state ? { state: q.state } : {}),
                ...(after ? { id: { gt: after } } : {}),
              },
              orderBy: { id: 'asc' },
              take: q.limit + 1,
            })
          ).map((r) => this.timeOffView(r, me, manager, s.now)),
      );
    });
  }
  requestTimeOff(
    actor: RequestActor,
    id: string,
    input: z.infer<typeof c.TeamTimeOffCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.TeamTimeOffCreateSchema.parse(input);
    if (
      (date(body.endDate).getTime() - date(body.startDate).getTime()) /
        86400000 >
      366
    )
      throw new BadRequestException();
    return this.op.write(
      actor,
      id,
      'task.create',
      [],
      'team.timeoff.create',
      body.id,
      async (s) => {
        const me = this.me(s);
        await this.op.once(s, 'team.timeoff.create', key, body, async () => {
          if (
            await s.tx.teamTimeOff.findFirst({
              where: {
                ...this.op.scope(s),
                accessId: me.accessId,
                generation: me.generation,
                state: { in: ['PENDING', 'APPROVED'] },
                startDate: { lte: date(body.endDate) },
                endDate: { gte: date(body.startDate) },
              },
            })
          )
            throw new ConflictException({ code: 'TIME_OFF_OVERLAP' });
          await s.begin();
          const row = await s.tx.teamTimeOff.create({
            data: {
              id: body.id,
              ...this.op.scope(s),
              accessId: me.accessId,
              generation: me.generation,
              startDate: date(body.startDate),
              endDate: date(body.endDate),
              minutesPerDay: body.minutesPerDay,
              reason: body.reason,
              state: 'PENDING',
              updatedAt: s.now,
            },
          });
          await this.timeOffEvent(s, row.id, 'SUBMITTED');
          return row;
        });
        const row = await this.timeOffRow(s, body.id);
        if (!same(ref(row.accessId, row.generation), me))
          throw new ConflictException();
        return this.timeOffView(row, me, await this.manager(s), s.now);
      },
    );
  }
  decideTimeOff(
    actor: RequestActor,
    id: string,
    timeOffId: string,
    revision: number,
    input: z.infer<typeof c.TeamTimeOffDecisionSchema>,
  ) {
    const body = c.TeamTimeOffDecisionSchema.parse(input);
    return this.op.write(
      actor,
      id,
      'work.manage',
      [],
      'team.timeoff.decision',
      timeOffId,
      async (s) => {
        const row = await this.timeOffRow(s, timeOffId),
          me = this.me(s),
          requester = ref(row.accessId, row.generation);
        this.op.match(row.revision, revision);
        if (same(requester, me))
          throw new ForbiddenException({ code: 'SELF_DECISION_FORBIDDEN' });
        if (row.state !== 'PENDING')
          throw new ConflictException({ code: 'TIME_OFF_CLOSED' });
        if (
          !(await this.current(s)).some((m) =>
            same(ref(m.id, m.generation), requester),
          )
        )
          throw new ConflictException({ code: 'MEMBER_NOT_CURRENT' });
        await s.begin();
        const updated = await s.tx.teamTimeOff.update({
          where: { id: row.id, revision: row.revision },
          data: {
            state: body.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
            decisionNote: body.note,
            decidedByActorId: this.op.access(s).actorId,
            decidedAt: s.now,
            updatedAt: s.now,
            revision: { increment: 1 },
          },
        });
        await this.timeOffEvent(
          s,
          row.id,
          body.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        );
        await this.notify(
          s,
          [requester],
          'TIME_OFF_DECIDED',
          row.id,
          'time-off:' + row.id,
        );
        return this.timeOffView(updated, me, true, s.now);
      },
    );
  }
  cancelTimeOff(
    actor: RequestActor,
    id: string,
    timeOffId: string,
    revision: number,
  ) {
    return this.op.write(
      actor,
      id,
      'task.read',
      [],
      'team.timeoff.cancel',
      timeOffId,
      async (s) => {
        const row = await this.timeOffRow(s, timeOffId),
          me = this.me(s);
        this.op.match(row.revision, revision);
        if (!same(ref(row.accessId, row.generation), me))
          throw new ForbiddenException();
        if (!(
          row.state === 'PENDING' ||
          (row.state === 'APPROVED' && row.endDate >= date(day(s.now)))
        ))
          throw new ConflictException({ code: 'TIME_OFF_CLOSED' });
        await s.begin();
        const updated = await s.tx.teamTimeOff.update({
          where: { id: row.id, revision: row.revision },
          data: {
            state: 'CANCELED',
            updatedAt: s.now,
            revision: { increment: 1 },
          },
        });
        await this.timeOffEvent(s, row.id, 'CANCELED');
        return this.timeOffView(updated, me, await this.manager(s), s.now);
      },
    );
  }
  timeOffHistory(actor: RequestActor, id: string, timeOffId: string, q: Page) {
    return this.op.read(actor, id, async (s) => {
      const row = await this.timeOffRow(s, timeOffId),
        where = await this.visibleTimeOff(s);
      if (
        'accessId' in where &&
        (where.accessId !== row.accessId || where.generation !== row.generation)
      )
        throw new NotFoundException();
      return this.op.page(
        s,
        'team-time-off-history:' + timeOffId,
        q,
        async (after) => {
          const rows = await s.tx.teamTimeOffEvent.findMany({
            where: {
              ...this.op.scope(s),
              timeOffId,
              ...(after ? { id: { gt: after } } : {}),
            },
            orderBy: { id: 'asc' },
            take: q.limit + 1,
          });
          return Promise.all(
            rows.map(async (r) =>
              c.TeamTimeOffEventSchema.parse({
                id: r.id,
                action: r.action,
                by: await this.actorMember(s, r.actorId),
                createdAt: r.createdAt.toISOString(),
              }),
            ),
          );
        },
      );
    });
  }

  // Key results ---------------------------------------------------------------
  private async currentValues(
    s: Interaction,
    goalId: string,
    rows: TeamKeyResult[],
  ) {
    const values = new Map<string, string | null>();
    let done: number | undefined;
    for (const r of rows) {
      if (r.source === 'TASKS') {
        if (done === undefined) {
          const ids = await this.goals.linkedTaskIds(s.tx, s.a, s.id, goalId);
          if (ids.length > 500) throw new PayloadTooLargeException();
          done = [...(await this.workTasks(s, ids)).values()].filter(
            (t) => t.status === 'DONE',
          ).length;
        }
        values.set(r.id, String(done));
      } else {
        const latest = await s.tx.teamKeyResultCheckin.findFirst({
          where: { spaceId: r.spaceId, keyResultId: r.id },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        values.set(r.id, latest ? latest.value.toString() : null);
      }
    }
    return values;
  }
  private keyResultView(r: TeamKeyResult, current: string | null) {
    return c.TeamKeyResultSchema.parse({
      id: r.id,
      goalId: r.goalId,
      title: r.title,
      unit: r.unit,
      source: r.source,
      startValue: r.startValue.toString(),
      targetValue: r.targetValue.toString(),
      currentValue: current === null ? null : String(Number(current)),
      progress: keyResultProgress(
        r.startValue.toString(),
        r.targetValue.toString(),
        current,
      ),
      archived: r.archivedAt !== null,
      revision: r.revision,
      updatedAt: r.updatedAt.toISOString(),
    });
  }
  private async keyResultRow(
    s: Interaction,
    goalId: string,
    keyResultId: string,
  ) {
    const row = await s.tx.teamKeyResult.findFirst({
      where: { id: keyResultId, goalId, ...this.op.scope(s) },
    });
    if (!row) throw new NotFoundException();
    return row;
  }
  keyResults(actor: RequestActor, id: string, goalId: string) {
    return this.op.read(actor, id, async (s) => {
      await this.goals.read(s.tx, s.a, id, goalId);
      const period = await this.goals.period(s.tx, s.a, id, goalId);
      const rows = await s.tx.teamKeyResult.findMany({
        where: { ...this.op.scope(s), goalId },
        orderBy: { id: 'asc' },
        take: 51,
      });
      if (rows.length > 50) throw new PayloadTooLargeException();
      const values = await this.currentValues(s, goalId, rows),
        items = rows.map((r) =>
          this.keyResultView(r, values.get(r.id) ?? null),
        ),
        progress = goalProgress(
          items.filter((i) => !i.archived).map((i) => i.progress),
        ),
        expected =
          period.startDate && period.targetDate
            ? periodProgress(
                period.startDate,
                period.targetDate,
                localDay(s.now, period.timezone),
              )
            : null;
      return c.TeamGoalKeyResultsSchema.parse({
        goalId,
        startDate: period.startDate,
        targetDate: period.targetDate,
        progress,
        expectedProgress: expected,
        pace:
          progress === null || expected === null
            ? null
            : progress >= expected
              ? 'ON_TRACK'
              : 'BEHIND',
        items,
      });
    });
  }
  setGoalPeriod(
    actor: RequestActor,
    id: string,
    goalId: string,
    revision: number,
    input: z.infer<typeof c.TeamGoalPeriodInputSchema>,
  ) {
    const body = c.TeamGoalPeriodInputSchema.parse(input);
    return this.op.write(
      actor,
      id,
      'goal.manage',
      [],
      'team.goal.period',
      goalId,
      async (s) => {
        await s.begin();
        const goal = await this.goals.setPeriod(
          s.tx,
          s.a,
          id,
          goalId,
          revision,
          body,
        );
        return c.TeamGoalPeriodSchema.parse({
          goalId,
          startDate: body.startDate,
          targetDate: body.targetDate,
          revision: goal.revision,
        });
      },
    );
  }
  createKeyResult(
    actor: RequestActor,
    id: string,
    goalId: string,
    input: z.infer<typeof c.TeamKeyResultCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.TeamKeyResultCreateSchema.parse(input);
    return this.op.write(
      actor,
      id,
      'work.manage',
      [],
      'team.keyresult.create',
      body.id,
      async (s) => {
        await this.goals.read(s.tx, s.a, id, goalId);
        await this.op.once(
          s,
          'team.keyresult.create',
          key,
          { ...body, goalId },
          async () => {
            if (
              (await s.tx.teamKeyResult.count({
                where: { ...this.op.scope(s), goalId },
              })) >= 50
            )
              throw new ConflictException({ code: 'KEY_RESULT_LIMIT' });
            await s.begin();
            return s.tx.teamKeyResult.create({
              data: {
                id: body.id,
                ...this.op.scope(s),
                goalId,
                title: body.title,
                unit: body.unit,
                source: body.source,
                startValue: body.startValue,
                targetValue: body.targetValue,
                createdByActorId: this.op.access(s).actorId,
                updatedAt: s.now,
              },
            });
          },
        );
        const row = await this.keyResultRow(s, goalId, body.id);
        return this.keyResultView(
          row,
          (await this.currentValues(s, goalId, [row])).get(row.id) ?? null,
        );
      },
    );
  }
  patchKeyResult(
    actor: RequestActor,
    id: string,
    goalId: string,
    keyResultId: string,
    revision: number,
    input: z.infer<typeof c.TeamKeyResultPatchSchema>,
  ) {
    const body = c.TeamKeyResultPatchSchema.parse(input);
    return this.op.write(
      actor,
      id,
      'work.manage',
      [],
      'team.keyresult.update',
      keyResultId,
      async (s) => {
        const row = await this.keyResultRow(s, goalId, keyResultId);
        this.op.match(row.revision, revision);
        const target = body.targetValue ?? row.targetValue.toString();
        if (
          Number(target) === Number(row.startValue) ||
          (row.source === 'TASKS' && Number(target) <= 0)
        )
          throw new BadRequestException();
        await s.begin();
        const updated = await s.tx.teamKeyResult.update({
          where: { id: row.id, revision: row.revision },
          data: {
            ...(body.title !== undefined ? { title: body.title } : {}),
            ...(body.unit !== undefined ? { unit: body.unit } : {}),
            ...(body.targetValue !== undefined
              ? { targetValue: body.targetValue }
              : {}),
            ...(body.archived !== undefined
              ? { archivedAt: body.archived ? (row.archivedAt ?? s.now) : null }
              : {}),
            updatedAt: s.now,
            revision: { increment: 1 },
          },
        });
        return this.keyResultView(
          updated,
          (await this.currentValues(s, goalId, [updated])).get(updated.id) ??
            null,
        );
      },
    );
  }
  recordKeyResult(
    actor: RequestActor,
    id: string,
    goalId: string,
    keyResultId: string,
    input: z.infer<typeof c.TeamKeyResultCheckinCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.TeamKeyResultCheckinCreateSchema.parse(input);
    return this.op.write(
      actor,
      id,
      'task.update',
      [],
      'team.keyresult.checkin',
      body.id,
      async (s) => {
        const row = await this.keyResultRow(s, goalId, keyResultId);
        if (row.source !== 'MANUAL' || row.archivedAt)
          throw new ConflictException({ code: 'KEY_RESULT_NOT_RECORDABLE' });
        await this.op.once(
          s,
          'team.keyresult.checkin',
          key,
          { ...body, keyResultId },
          async () => {
            await s.begin();
            return s.tx.teamKeyResultCheckin.create({
              data: {
                id: body.id,
                ...this.op.scope(s),
                keyResultId,
                value: body.value,
                note: body.note,
                actorId: this.op.access(s).actorId,
              },
            });
          },
        );
        const checkin = await s.tx.teamKeyResultCheckin.findFirst({
          where: { id: body.id, ...this.op.scope(s), keyResultId },
        });
        if (!checkin) throw new NotFoundException();
        return c.TeamKeyResultCheckinSchema.parse({
          id: checkin.id,
          keyResultId,
          value: String(Number(checkin.value.toString())),
          note: checkin.note,
          by: await this.actorMember(s, checkin.actorId),
          createdAt: checkin.createdAt.toISOString(),
        });
      },
    );
  }
  keyResultCheckins(
    actor: RequestActor,
    id: string,
    goalId: string,
    keyResultId: string,
    q: Page,
  ) {
    return this.op.read(actor, id, async (s) => {
      await this.keyResultRow(s, goalId, keyResultId);
      return this.op.page(
        s,
        'team-kr-checkins:' + keyResultId,
        q,
        async (after) => {
          const rows = await s.tx.teamKeyResultCheckin.findMany({
            where: {
              ...this.op.scope(s),
              keyResultId,
              ...(after ? { id: { gt: after } } : {}),
            },
            orderBy: { id: 'asc' },
            take: q.limit + 1,
          });
          return Promise.all(
            rows.map(async (r) =>
              c.TeamKeyResultCheckinSchema.parse({
                id: r.id,
                keyResultId,
                value: String(Number(r.value.toString())),
                note: r.note,
                by: await this.actorMember(s, r.actorId),
                createdAt: r.createdAt.toISOString(),
              }),
            ),
          );
        },
      );
    });
  }

  // Member profiles (job title) -------------------------------------------------
  memberProfiles(actor: RequestActor, id: string, q: Page) {
    return this.op.read(actor, id, async (s) => {
      const members = await this.current(s),
        profiles = new Map(
          (
            await s.tx.teamMemberProfile.findMany({
              where: {
                ...this.op.scope(s),
                OR: members.map((m) => ({
                  accessId: m.id,
                  generation: m.generation,
                })),
              },
            })
          ).map((p) => [p.accessId + ':' + p.generation, p]),
        );
      return this.op
        .page(s, 'team-member-profiles', q, async (after) =>
          members
            .filter((m) => !after || m.id > after)
            .slice(0, q.limit + 1)
            .map((m) => {
              const p = profiles.get(m.id + ':' + m.generation);
              return {
                id: m.id,
                member: ref(m.id, m.generation),
                jobTitle: p?.jobTitle ?? null,
                revision: p?.revision ?? 1,
              };
            }),
        )
        .then((page) => ({
          ...page,
          items: page.items.map(({ id: _id, ...rest }) =>
            c.TeamMemberProfileSchema.parse(rest),
          ),
        }));
    });
  }
  setMemberProfile(
    actor: RequestActor,
    id: string,
    accessId: string,
    revision: number,
    input: z.infer<typeof c.TeamMemberProfileInputSchema>,
  ) {
    const body = c.TeamMemberProfileInputSchema.parse(input),
      target = ref(accessId, body.generation);
    return this.op.write(
      actor,
      id,
      'task.read',
      [target],
      'team.memberprofile.update',
      accessId,
      async (s) => {
        if (
          !same(target, this.me(s)) &&
          !(await this.op.eligible(s, this.me(s), true))
        )
          throw new ForbiddenException();
        await this.op.member(s, target);
        const scope = this.op.scope(s),
          before = await s.tx.teamMemberProfile.findUnique({
            where: {
              spaceId_accessId_generation: {
                spaceId: scope.spaceId,
                accessId,
                generation: body.generation,
              },
            },
          });
        this.op.match(before?.revision ?? 1, revision);
        await s.begin();
        const row = before
          ? await s.tx.teamMemberProfile.update({
              where: { id: before.id, revision: before.revision },
              data: {
                jobTitle: body.jobTitle,
                updatedAt: s.now,
                revision: { increment: 1 },
              },
            })
          : await s.tx.teamMemberProfile.create({
              data: {
                id: randomUUID(),
                ...scope,
                accessId,
                generation: body.generation,
                jobTitle: body.jobTitle,
                updatedAt: s.now,
              },
            });
        return c.TeamMemberProfileSchema.parse({
          member: target,
          jobTitle: row.jobTitle,
          revision: row.revision,
        });
      },
    );
  }

  // Notifications and reminders -------------------------------------------------
  private schedule(
    r: {
      checkinCadence: string | null;
      checkinOpensDay: number | null;
      checkinOpensTime: string | null;
      checkinClosesDay: number | null;
      checkinClosesTime: string | null;
      checkinTimezone: string | null;
    } | null,
  ): CheckinSchedule | null {
    if (!r?.checkinCadence) return null;
    return r.checkinCadence === 'WEEKLY'
      ? {
          cadence: 'WEEKLY',
          opensDay: r.checkinOpensDay!,
          opensTime: r.checkinOpensTime!,
          closesDay: r.checkinClosesDay!,
          closesTime: r.checkinClosesTime!,
          timezone: r.checkinTimezone!,
        }
      : {
          cadence: 'DAILY',
          opensTime: r.checkinOpensTime!,
          closesTime: r.checkinClosesTime!,
          timezone: r.checkinTimezone!,
        };
  }
  /** Members who still owe a reply for the period (Viewers never reply). */
  private async missing(s: Interaction, period: string) {
    const replies = new Set(
      (
        await s.tx.teamCheckinReply.findMany({
          where: { ...this.op.scope(s), period: date(period) },
          select: { accessId: true, generation: true },
        })
      ).map((r) => r.accessId + ':' + r.generation),
    );
    return (await this.current(s))
      .filter(
        (m) =>
          m.memberRole !== 'VIEWER' && !replies.has(m.id + ':' + m.generation),
      )
      .map((m) => ref(m.id, m.generation));
  }
  /** Manager-configured scheduled check-in reminders, materialized idempotently when the recipient reads. */
  private async dueReminders(s: Interaction) {
    const settings = await s.tx.teamSetting.findUnique({
      where: { spaceId_scopeId: this.op.scope(s) },
    });
    const schedule = this.schedule(settings);
    if (
      !settings?.checkinsEnabled ||
      !settings.checkinReminderMinutes ||
      !schedule ||
      this.op.access(s).role === 'VIEWER'
    )
      return;
    const today = localDay(s.now, schedule.timezone);
    const periods =
      schedule.cadence === 'DAILY'
        ? [addDays(today, -1), today]
        : [0, 1, 2, 3, 4, 5, 6, 7]
            .map((n) => addDays(today, -n))
            .filter((d) => weekdayOf(d) === schedule.opensDay)
            .slice(0, 1);
    const me = this.me(s);
    for (const period of periods) {
      const w = checkinWindow(wallInstant, period, schedule);
      if (
        checkinStatus(w, s.now) !== 'OPEN' ||
        s.now.getTime() <
          w.closesAt.getTime() - settings.checkinReminderMinutes * 60000 ||
        !(await this.missing(s, period)).some((m) => same(m, me))
      )
        continue;
      await this.notify(s, [me], 'CHECKIN_REMINDER', s.id, 'checkin:' + period);
    }
  }
  notifications(actor: RequestActor, id: string, q: Page) {
    return this.op.write(
      actor,
      id,
      'task.read',
      [],
      'team.notifications.read',
      id,
      async (s) => {
        await this.dueReminders(s);
        const me = this.me(s);
        return this.op.page(s, 'team-notifications', q, async (after) =>
          (
            await s.tx.teamNotification.findMany({
              where: {
                ...this.op.scope(s),
                recipientAccessId: me.accessId,
                recipientGeneration: me.generation,
                ...(after ? { id: { gt: after } } : {}),
              },
              orderBy: { id: 'asc' },
              take: q.limit + 1,
            })
          ).map((r) =>
            c.TeamNotificationSchema.parse({
              id: r.id,
              kind: r.kind,
              subjectId: r.subjectId,
              createdAt: r.createdAt.toISOString(),
              readAt: r.readAt?.toISOString() ?? null,
            }),
          ),
        );
      },
    );
  }
  readNotification(actor: RequestActor, id: string, notificationId: string) {
    return this.op.write(
      actor,
      id,
      'task.read',
      [],
      'team.notification.read',
      notificationId,
      async (s) => {
        const me = this.me(s);
        const row = await s.tx.teamNotification.findFirst({
          where: {
            id: notificationId,
            ...this.op.scope(s),
            recipientAccessId: me.accessId,
            recipientGeneration: me.generation,
          },
        });
        if (!row) throw new NotFoundException();
        const updated = row.readAt
          ? row
          : await s.tx.teamNotification.update({
              where: { id: row.id },
              data: { readAt: s.now },
            });
        return c.TeamNotificationSchema.parse({
          id: updated.id,
          kind: updated.kind,
          subjectId: updated.subjectId,
          createdAt: updated.createdAt.toISOString(),
          readAt: updated.readAt?.toISOString() ?? null,
        });
      },
    );
  }
  reminderSettings(actor: RequestActor, id: string) {
    return this.op.read(actor, id, async (s) => {
      const row = await s.tx.teamSetting.findUnique({
        where: { spaceId_scopeId: this.op.scope(s) },
      });
      return c.TeamReminderSettingsSchema.parse({
        teamId: id,
        checkinReminderMinutes: row?.checkinReminderMinutes ?? null,
        revision: row?.revision ?? 1,
      });
    });
  }
  setReminderSettings(
    actor: RequestActor,
    id: string,
    revision: number,
    input: z.infer<typeof c.TeamReminderSettingsInputSchema>,
  ) {
    const body = c.TeamReminderSettingsInputSchema.parse(input);
    return this.op.write(
      actor,
      id,
      'work.manage',
      [],
      'team.settings.update',
      id,
      async (s) => {
        const before = await s.tx.teamSetting.findUnique({
          where: { spaceId_scopeId: this.op.scope(s) },
        });
        this.op.match(before?.revision ?? 1, revision);
        await s.begin();
        const row = before
          ? await s.tx.teamSetting.update({
              where: { id: before.id },
              data: {
                checkinReminderMinutes: body.checkinReminderMinutes,
                updatedAt: s.now,
                revision: { increment: 1 },
              },
            })
          : await s.tx.teamSetting.create({
              data: {
                id: randomUUID(),
                ...this.op.scope(s),
                checkinReminderMinutes: body.checkinReminderMinutes,
                updatedAt: s.now,
              },
            });
        return c.TeamReminderSettingsSchema.parse({
          teamId: id,
          checkinReminderMinutes: row.checkinReminderMinutes,
          revision: row.revision,
        });
      },
    );
  }
  remindCheckin(actor: RequestActor, id: string, period: string) {
    return this.op.write(
      actor,
      id,
      'work.manage',
      [],
      'team.checkin.remind',
      id,
      async (s) => {
        const settings = await s.tx.teamSetting.findUnique({
          where: { spaceId_scopeId: this.op.scope(s) },
        });
        const schedule = this.schedule(settings);
        if (!settings?.checkinsEnabled || !schedule)
          throw new ConflictException({ code: 'CHECKINS_DISABLED' });
        let w;
        try {
          w = checkinWindow(wallInstant, period, schedule);
        } catch {
          throw new BadRequestException({ code: 'PERIOD_NOT_ON_OPENING_DAY' });
        }
        const status = checkinStatus(w, s.now);
        if (status !== 'OPEN' && status !== 'LATE')
          throw new ConflictException({ code: 'CHECKIN_NOT_OPEN' });
        const recipients = (await this.missing(s, period)).filter(
          (m) => !same(m, this.me(s)),
        );
        await s.begin();
        return c.TeamRemindResultSchema.parse({
          delivered: await this.notify(
            s,
            recipients,
            'CHECKIN_REMINDER',
            id,
            'checkin:' + period,
          ),
        });
      },
    );
  }
}
