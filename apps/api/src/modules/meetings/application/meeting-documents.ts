import {
  Inject,
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type { MeetingVersion } from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { CaptureTasks, SharedTasks } from '../../tasks/public/index.js';
import {
  MeetingKernel,
  meetingRevision,
  meetingManages,
  type MeetingOperation as Op,
} from './meeting-kernel.js';
import { MeetingsService } from './meetings.service.js';
import { MeetingFiles } from './meeting-files.js';
type Page = z.infer<typeof c.MeetingPageQuerySchema>;
@Injectable()
export class MeetingDocuments {
  constructor(
    @Inject(MeetingKernel) readonly op: MeetingKernel,
    @Inject(MeetingsService) private readonly meetings: MeetingsService,
    @Inject(MeetingFiles) private readonly files: MeetingFiles,
    @Inject(CaptureTasks) private readonly personalTasks: CaptureTasks,
    @Inject(SharedTasks) private readonly tasks: SharedTasks,
  ) {}
  private async privateReader(s: Op, v: MeetingVersion) {
    const me = await this.op.member(s);
    if (s.proof?.role === 'VIEWER') return false;
    return (
      (await this.op.canOrganize(s)) ||
      (v.authorMemberId === me.id && v.authorGeneration === me.generation) ||
      (v.reviewerMemberId === me.id &&
        v.reviewerGeneration === me.generation) ||
      !!(await s.tx.meetingDraftContributor.findFirst({
        where: { versionId: v.id, memberId: me.id, generation: me.generation },
      }))
    );
  }
  async visible(s: Op, v: MeetingVersion) {
    return v.state === 'FINAL' || (await this.privateReader(s, v));
  }
  async row(s: Op, id: string) {
    const v = await s.tx.meetingVersion.findFirst({
      where: { id, meetingId: s.meeting.id },
    });
    if (!v || !(await this.visible(s, v))) throw new NotFoundException();
    return v;
  }
  private async dto(s: Op, v: MeetingVersion) {
    const decisions = await s.tx.meetingDecision.findMany({
        where: { versionId: v.id },
        orderBy: { position: 'asc' },
        take: 50,
      }),
      actions = await s.tx.meetingAction.findMany({
        where: { versionId: v.id },
        orderBy: { position: 'asc' },
        take: 100,
      }),
      attachments = await s.tx.meetingVersionAttachment.findMany({
        where: { versionId: v.id },
        orderBy: { attachmentId: 'asc' },
        take: 20,
      }),
      contributors = await s.tx.meetingDraftContributor.findMany({
        where: { versionId: v.id },
        orderBy: { memberId: 'asc' },
        take: 50,
      });
    const review = v.approvedReviewId
      ? await s.tx.meetingReview.findUnique({
          where: { id: v.approvedReviewId },
        })
      : await s.tx.meetingReview.findFirst({
          where: { versionId: v.id },
          orderBy: { createdAt: 'desc' },
        });
    const privateRead = await this.privateReader(s, v);
    return c.MeetingVersionSchema.parse({
      id: v.id,
      meetingId: v.meetingId,
      number: v.number,
      parentId: v.parentId,
      authorMemberId: v.authorMemberId,
      reviewerMemberId: privateRead ? v.reviewerMemberId : null,
      minutes: v.minutes,
      agenda: v.agenda,
      state: v.state,
      revision: v.revision,
      selfFinalized: v.selfFinalized,
      createdAt: v.createdAt.toISOString(),
      finalizedAt: v.finalizedAt?.toISOString() ?? null,
      decisions: decisions.map((x) => ({
        id: x.id,
        text: x.text,
        proposedByMemberId: x.proposedByMemberId,
      })),
      actions: actions.map((x) => ({
        id: x.id,
        title: x.title,
        description: x.description,
        assigneeMemberId: x.assigneeMemberId,
        dueDate: x.dueDate?.toISOString().slice(0, 10) ?? null,
      })),
      attachments: attachments.map((x) => x.attachmentId),
      contributors: privateRead ? contributors.map((x) => x.memberId) : [],
      review:
        review && privateRead
          ? { id: review.id, decision: review.decision, reason: review.reason }
          : null,
    });
  }
  get(actor: RequestActor, id: string, versionId: string) {
    return this.op.operation(actor, id, 'meeting.version.read', async (s) =>
      this.dto(s, await this.row(s, versionId)),
    );
  }
  list(actor: RequestActor, id: string, q: Page) {
    return this.op.operation(actor, id, 'meeting.versions', async (s) => {
      const me = await this.op.member(s),
        organizer = await this.op.canOrganize(s),
        stamp = await this.op.stamp(s),
        context = 'meeting-versions:' + id,
        after = this.op.after(actor, context, stamp, q.cursor);
      const rows = await s.tx.meetingVersion.findMany({
          where: {
            meetingId: id,
            ...(s.proof?.role === 'VIEWER'
              ? { state: 'FINAL' }
              : !organizer
                ? {
                    OR: [
                      { state: 'FINAL' },
                      {
                        authorMemberId: me.id,
                        authorGeneration: me.generation,
                      },
                      {
                        reviewerMemberId: me.id,
                        reviewerGeneration: me.generation,
                      },
                      {
                        MeetingDraftContributor_version: {
                          some: { memberId: me.id, generation: me.generation },
                        },
                      },
                    ],
                  }
                : {}),
            ...(after ? { id: { gt: after } } : {}),
          },
          orderBy: { id: 'asc' },
          take: q.limit + 1,
        }),
        items = [];
      for (const v of rows) items.push(await this.dto(s, v));
      return c.MeetingVersionPageSchema.parse(
        this.op.page(actor, context, stamp, items, q.limit),
      );
    });
  }
  create(
    actor: RequestActor,
    id: string,
    input: z.infer<typeof c.MeetingVersionCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.MeetingVersionCreateSchema.parse(input);
    return this.op.operation(actor, id, 'meeting.version.create', async (s) => {
      const me = await this.op.writer(s);
      await this.meetings.active(s);
      const organizer = await this.op.canOrganize(s),
        named = [
          ...body.decisions.map((v) => v.proposedByMemberId),
          ...body.actions.map((v) => v.assigneeMemberId),
        ].filter((v): v is string => !!v);
      if (
        (body.reviewerMemberId ||
          [...body.contributors, ...named].some((v) => v !== me.id)) &&
        !organizer
      )
        throw new ForbiddenException();
      const result = await this.op.once(
        s,
        key,
        body,
        'meeting.version.create',
        async () => {
          if (body.parentId) await this.row(s, body.parentId);
          const last = await s.tx.meetingVersion.findFirst({
            where: { meetingId: id },
            orderBy: { number: 'desc' },
          });
          if ((last?.number ?? 0) >= 1000) throw new PayloadTooLargeException();
          let reviewer: null | Awaited<ReturnType<MeetingKernel['other']>> =
            null;
          if (body.reviewerMemberId) {
            reviewer = await this.op.other(s, body.reviewerMemberId);
            if (
              reviewer.member.id === me.id ||
              reviewer.proof.role === 'VIEWER'
            )
              throw new ForbiddenException();
          }
          await s.tx.meetingVersion.create({
            data: {
              id: body.id,
              meetingId: id,
              number: (last?.number ?? 0) + 1,
              parentId: body.parentId ?? null,
              authorMemberId: me.id,
              authorGeneration: me.generation,
              reviewerMemberId: reviewer?.member.id ?? null,
              reviewerGeneration: reviewer?.member.generation ?? null,
              minutes: body.minutes,
              agenda: await s.tx.meetingAgendaEntry.findMany({
                where: { meetingId: id, state: 'ACCEPTED' },
                select: { id: true, text: true },
                orderBy: { id: 'asc' },
                take: 1000,
              }),
            },
          });
          for (const memberId of body.contributors) {
            const contributor = await this.op.other(s, memberId);
            if (contributor.proof.role === 'VIEWER')
              throw new ForbiddenException();
            await s.tx.meetingDraftContributor.create({
              data: {
                meetingId: id,
                versionId: body.id,
                memberId,
                generation: contributor.member.generation,
              },
            });
          }
          const generations = new Map([[me.id, me.generation]]);
          for (const memberId of new Set(named))
            if (!generations.has(memberId))
              generations.set(
                memberId,
                (await this.op.other(s, memberId)).member.generation,
              );
          for (const [position, decision] of body.decisions.entries())
            await s.tx.meetingDecision.create({
              data: {
                ...decision,
                proposedByMemberId: decision.proposedByMemberId ?? null,
                proposedByGeneration: decision.proposedByMemberId
                  ? generations.get(decision.proposedByMemberId)!
                  : null,
                meetingId: id,
                versionId: body.id,
                position,
              },
            });
          for (const [position, action] of body.actions.entries())
            await s.tx.meetingAction.create({
              data: {
                ...action,
                assigneeMemberId: action.assigneeMemberId ?? null,
                assigneeGeneration: action.assigneeMemberId
                  ? generations.get(action.assigneeMemberId)!
                  : null,
                dueDate: action.dueDate
                  ? new Date(action.dueDate + 'T00:00:00.000Z')
                  : null,
                meetingId: id,
                versionId: body.id,
                position,
              },
            });
          await this.files.attachMeetingVersion(s, body.id, body.attachments);
          return body.id;
        },
        'meeting.version',
      );
      return this.dto(s, await this.row(s, result));
    });
  }
  reviewer(
    actor: RequestActor,
    id: string,
    versionId: string,
    memberId: string,
    expected: number | undefined,
    key: string | undefined,
  ) {
    return this.op.operation(
      actor,
      id,
      'meeting.version.reviewer',
      async (s) => {
        await this.op.organizer(s);
        await this.meetings.active(s);
        await this.op.once(
          s,
          key,
          { versionId, memberId, expected },
          'meeting.version.reviewer',
          async () => {
            const v = await this.row(s, versionId);
            meetingRevision(expected, v.revision);
            if (v.state !== 'DRAFT') throw new ConflictException();
            const target = await this.op.other(s, memberId);
            if (target.proof.role === 'VIEWER' || memberId === v.authorMemberId)
              throw new ForbiddenException();
            await s.tx.meetingVersion.update({
              where: { id: versionId },
              data: {
                reviewerMemberId: memberId,
                reviewerGeneration: target.member.generation,
                revision: { increment: 1 },
              },
            });
            return versionId;
          },
        );
        return this.dto(s, await this.row(s, versionId));
      },
    );
  }
  submit(
    actor: RequestActor,
    id: string,
    versionId: string,
    expected: number | undefined,
    key: string | undefined,
  ) {
    return this.op.operation(actor, id, 'meeting.version.submit', async (s) => {
      const me = await this.op.writer(s);
      await this.meetings.active(s);
      const v = await this.row(s, versionId);
      if (v.authorMemberId !== me.id || v.authorGeneration !== me.generation)
        throw new ForbiddenException();
      await this.op.once(
        s,
        key,
        { versionId, expected },
        'meeting.version.submit',
        async () => {
          meetingRevision(expected, v.revision);
          if (
            v.state !== 'DRAFT' ||
            !v.reviewerMemberId ||
            !v.reviewerGeneration
          )
            throw new ConflictException({ code: 'REVIEWER_REQUIRED' });
          const reviewer = await this.op.other(
            s,
            v.reviewerMemberId,
            v.reviewerGeneration,
          );
          if (reviewer.proof.role === 'VIEWER' || reviewer.member.id === me.id)
            throw new ForbiddenException();
          await s.tx.meetingVersion.update({
            where: { id: versionId },
            data: { state: 'IN_REVIEW', revision: { increment: 1 } },
          });
          return versionId;
        },
      );
      return this.dto(s, await this.row(s, versionId));
    });
  }
  review(
    actor: RequestActor,
    id: string,
    versionId: string,
    input: z.infer<typeof c.MeetingReviewInputSchema>,
    expected: number | undefined,
    key: string | undefined,
  ) {
    const body = c.MeetingReviewInputSchema.parse(input);
    return this.op.operation(actor, id, 'meeting.version.review', async (s) => {
      const me = await this.op.writer(s);
      await this.meetings.active(s);
      const v = await this.row(s, versionId);
      if (
        v.reviewerMemberId !== me.id ||
        v.reviewerGeneration !== me.generation ||
        v.authorMemberId === me.id
      )
        throw new ForbiddenException();
      await this.op.once(
        s,
        key,
        { versionId, body, expected },
        'meeting.version.review',
        async () => {
          meetingRevision(expected, v.revision);
          if (v.state !== 'IN_REVIEW') throw new ConflictException();
          const author = await this.op.other(
            s,
            v.authorMemberId,
            v.authorGeneration,
          );
          if (author.proof.role === 'VIEWER') throw new ForbiddenException();
          const r = await s.tx.meetingReview.create({
            data: {
              id: randomUUID(),
              meetingId: id,
              versionId,
              memberId: me.id,
              generation: me.generation,
              decision: body.decision,
              reason: body.reason,
            },
          });
          await s.tx.meetingVersion.update({
            where: { id: versionId },
            data: {
              state: body.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
              approvedReviewId: body.decision === 'APPROVE' ? r.id : null,
              revision: { increment: 1 },
            },
          });
          return versionId;
        },
      );
      return this.dto(s, await this.row(s, versionId));
    });
  }
  finalize(
    actor: RequestActor,
    id: string,
    versionId: string,
    expected: number | undefined,
    key: string | undefined,
  ) {
    return this.op.operation(
      actor,
      id,
      'meeting.version.finalize',
      async (s) => {
        const me = await this.op.organizer(s);
        await this.meetings.active(s);
        await this.op.once(
          s,
          key,
          { versionId, expected },
          'meeting.version.finalize',
          async () => {
            const v = await this.row(s, versionId);
            meetingRevision(expected, v.revision);
            const solo =
              s.kind === 'INDEPENDENT' &&
              me.id === v.authorMemberId &&
              me.generation === v.authorGeneration &&
              !(await s.tx.meetingAdmission.findFirst({
                where: { meetingId: id, memberId: { not: me.id } },
              }));
            if (!solo) {
              if (
                v.state !== 'APPROVED' ||
                !v.approvedReviewId ||
                !v.reviewerMemberId ||
                !v.reviewerGeneration
              )
                throw new ConflictException({ code: 'APPROVAL_REQUIRED' });
              const author = await this.op.other(
                  s,
                  v.authorMemberId,
                  v.authorGeneration,
                ),
                reviewer = await this.op.other(
                  s,
                  v.reviewerMemberId,
                  v.reviewerGeneration,
                ),
                review = await s.tx.meetingReview.findUniqueOrThrow({
                  where: { id: v.approvedReviewId },
                });
              if (
                author.proof.role === 'VIEWER' ||
                reviewer.proof.role === 'VIEWER' ||
                review.decision !== 'APPROVE' ||
                review.versionId !== v.id ||
                review.memberId !== reviewer.member.id ||
                review.generation !== reviewer.member.generation ||
                author.member.id === reviewer.member.id
              )
                throw new ForbiddenException();
            } else if (v.state !== 'DRAFT') throw new ConflictException();
            await this.files.validateMeetingVersion(s, versionId);
            await s.tx.meetingVersion.update({
              where: { id: versionId },
              data: {
                state: 'FINAL',
                selfFinalized: solo,
                finalizedAt: s.now,
                revision: { increment: 1 },
              },
            });
            return versionId;
          },
        );
        return this.dto(s, await this.row(s, versionId));
      },
    );
  }
  withdraw(
    actor: RequestActor,
    id: string,
    versionId: string,
    expected: number | undefined,
    key: string | undefined,
  ) {
    return this.op.operation(
      actor,
      id,
      'meeting.version.withdraw',
      async (s) => {
        const me = await this.op.writer(s);
        await this.meetings.active(s);
        const v = await this.row(s, versionId);
        if (
          !(
            v.authorMemberId === me.id && v.authorGeneration === me.generation
          ) &&
          !(await this.op.canOrganize(s))
        )
          throw new ForbiddenException();
        await this.op.once(
          s,
          key,
          { versionId, expected },
          'meeting.version.withdraw',
          async () => {
            meetingRevision(expected, v.revision);
            if (!['IN_REVIEW', 'APPROVED'].includes(v.state))
              throw new ConflictException();
            await s.tx.meetingVersion.update({
              where: { id: versionId },
              data: {
                state: 'DRAFT',
                approvedReviewId: null,
                revision: { increment: 1 },
              },
            });
            return versionId;
          },
        );
        return this.dto(s, await this.row(s, versionId));
      },
    );
  }
  private async action(s: Op, actionId: string) {
    const action = await s.tx.meetingAction.findFirst({
      where: { id: actionId, meetingId: s.meeting.id },
      include: { version: true },
    });
    if (!action || action.version.state !== 'FINAL')
      throw new NotFoundException();
    return action;
  }
  release(
    actor: RequestActor,
    id: string,
    actionId: string,
    active: boolean,
    expected: number | undefined,
    key: string | undefined,
  ) {
    return this.op.operation(actor, id, 'meeting.action.release', async (s) => {
      const me = await this.op.organizer(s);
      await this.action(s, actionId);
      await this.meetings.active(s);
      if (s.kind === 'INDEPENDENT')
        throw new ConflictException({ code: 'PERSONAL_CONVERSION_ONLY' });
      await this.op.once(
        s,
        key,
        { actionId, active, expected },
        'meeting.action.release',
        async () => {
          const old = await s.tx.meetingActionRelease.findUnique({
            where: { actionId },
          });
          meetingRevision(expected, old?.revision ?? 1);
          if (old)
            await s.tx.meetingActionRelease.update({
              where: { id: old.id },
              data: {
                active,
                memberId: me.id,
                generation: me.generation,
                revision: { increment: 1 },
              },
            });
          else
            await s.tx.meetingActionRelease.create({
              data: {
                id: randomUUID(),
                meetingId: id,
                actionId,
                memberId: me.id,
                generation: me.generation,
                active,
                revision: 2,
              },
            });
          return actionId;
        },
      );
      const row = await s.tx.meetingActionRelease.findUniqueOrThrow({
        where: { actionId },
      });
      return c.MeetingActionReleaseResultSchema.parse({
        actionId,
        active: row.active,
        revision: row.revision,
      });
    });
  }
  releaseState(actor: RequestActor, id: string, actionId: string) {
    return this.op.operation(
      actor,
      id,
      'meeting.action.release.read',
      async (s) => {
        await this.action(s, actionId);
        const row = await s.tx.meetingActionRelease.findUnique({
          where: { actionId },
        });
        return c.MeetingActionReleaseResultSchema.parse({
          actionId,
          active: row?.active ?? false,
          revision: row?.revision ?? 1,
        });
      },
    );
  }
  private async taskDto(
    s: Op,
    link: Awaited<ReturnType<MeetingDocuments['linkRow']>>,
    personalScope?: Awaited<
      ReturnType<MeetingKernel['spaces']['authorizePersonal']>
    >,
  ) {
    let task: { id: string; revision: number; title: string } | null = null;
    if (link.taskId && link.taskSpaceId) {
      try {
        if (link.personal) {
          const me = await this.op.member(s);
          if (link.memberId !== me.id) throw new NotFoundException();
          const scope =
            personalScope ?? (await this.op.spaces.authorizePersonal(s.actor));
          if (scope.spaceId !== link.taskSpaceId) throw new NotFoundException();
          task = await this.personalTasks.read(s.tx, scope, link.taskId);
        } else
          task = await this.op.withAuthority(s, [], async (a) => {
            const value = await this.tasks.read(
              s.tx,
              a,
              s.scopeId,
              link.taskId!,
            );
            return {
              id: value.id,
              revision: value.revision,
              title: value.title,
            };
          });
      } catch (error) {
        if (!(
          error instanceof NotFoundException ||
          error instanceof ForbiddenException
        ))
          throw error;
      }
    }
    return c.MeetingTaskLinkSchema.parse({
      id: link.id,
      actionId: link.actionId,
      personal: link.personal,
      task,
    });
  }
  private linkRow(s: Op, linkId: string) {
    return s.tx.meetingTaskLink.findFirstOrThrow({
      where: { id: linkId, meetingId: s.meeting.id },
    });
  }
  async convert(
    actor: RequestActor,
    id: string,
    actionId: string,
    input: z.infer<typeof c.MeetingTaskCommandSchema>,
    key: string | undefined,
  ) {
    const body = c.MeetingTaskCommandSchema.parse(input),
      scope = await this.op.spaces.authorizePersonal(actor);
    return this.op.operation(actor, id, 'meeting.action.task', async (s) => {
      const me = await this.op.writer(s),
        action = await this.action(s, actionId),
        personal = s.kind === 'INDEPENDENT';
      if (!personal) {
        const release = await s.tx.meetingActionRelease.findUnique({
          where: { actionId },
        });
        if (!release?.active)
          throw new ForbiddenException({ code: 'ACTION_RELEASE_REQUIRED' });
        const releaser = await this.op.other(
          s,
          release.memberId,
          release.generation,
        );
        if (
          releaser.member.role !== 'ORGANIZER' ||
          !meetingManages(s.kind, releaser.proof.role)
        )
          throw new ForbiddenException();
        await this.op.proof(s, actor.userId, 'task.create');
      } else await scope.fence(s.tx);
      const old = await s.tx.meetingTaskLink.findFirst({
        where: {
          actionId,
          ...(personal
            ? { memberId: me.id, personal: true }
            : { personal: false }),
        },
      });
      const linkId = await this.op.once(
        s,
        key,
        { actionId, body },
        'meeting.action.task',
        async () => {
          if (old) {
            if (body.taskId && old.taskId !== body.taskId)
              throw new ConflictException({
                code: 'ACTION_TASK_ALREADY_LINKED',
              });
            return old.id;
          }
          let taskId = body.taskId;
          if (personal) {
            if (taskId) await this.personalTasks.read(s.tx, scope, taskId);
            else
              taskId = (
                await this.personalTasks.create(s.tx, scope, {
                  title: action.title,
                  description: action.description
                    ? {
                        format: 'MARKDOWN',
                        version: 1,
                        content: action.description,
                      }
                    : null,
                })
              ).id;
          } else {
            if (taskId) {
              const location = await this.tasks.location(
                s.tx,
                taskId,
                s.spaceId,
              );
              if (location.scopeId !== s.scopeId) throw new NotFoundException();
              await this.op.withAuthority(s, [], (a) =>
                this.tasks.read(s.tx, a, s.scopeId, taskId!),
              );
            } else
              taskId = (
                await this.op.withAuthority(s, ['task.create'], (a) =>
                  this.tasks.create(s.tx, a, s.scopeId, {
                    id: randomUUID(),
                    title: action.title,
                    description: action.description,
                    priority: 'NONE',
                  }),
                )
              ).id;
          }
          const row = await s.tx.meetingTaskLink.create({
            data: {
              id: randomUUID(),
              meetingId: id,
              actionId,
              memberId: me.id,
              generation: me.generation,
              personal,
              taskId,
              taskSpaceId: personal ? scope.spaceId : s.spaceId,
              taskScopeId: personal ? null : s.scopeId,
            },
          });
          return row.id;
        },
        !personal && !old && !body.taskId ? 'task.shared' : undefined,
      );
      const result = await this.taskDto(
        s,
        await this.linkRow(s, linkId),
        scope,
      );
      await this.meetings.active(s);
      return result;
    });
  }
  links(actor: RequestActor, id: string, actionId: string, q: Page) {
    return this.op.operation(
      actor,
      id,
      'meeting.action.tasks.read',
      async (s) => {
        const me = await this.op.member(s);
        await this.action(s, actionId);
        const stamp = await this.op.stamp(s),
          context = 'meeting-task-links:' + actionId,
          after = this.op.after(actor, context, stamp, q.cursor),
          rows = await s.tx.meetingTaskLink.findMany({
            where: {
              actionId,
              meetingId: id,
              OR: [{ personal: false }, { personal: true, memberId: me.id }],
              ...(after ? { id: { gt: after } } : {}),
            },
            orderBy: { id: 'asc' },
            take: q.limit + 1,
          }),
          items = [];
        for (const row of rows) items.push(await this.taskDto(s, row));
        return c.MeetingTaskLinkPageSchema.parse(
          this.op.page(actor, context, stamp, items, q.limit),
        );
      },
    );
  }
}
