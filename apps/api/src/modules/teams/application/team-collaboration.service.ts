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
  Prisma,
  TeamCheckinReply,
  TeamCheckinComment,
  TeamPresence,
  TeamSetting,
  TeamThanks,
  TeamThanksRecipient,
  TeamFeedbackNote,
  TeamFeedbackRequest,
} from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { SharedTasks } from '../../tasks/public/index.js';
import { SharedGoals } from '../../goals/public/index.js';
import { TeamProjects } from '../../projects/public/index.js';
import { wallInstant } from '../../calendar/public/index.js';
import { TeamInteractionContext } from './team-interaction.context.js';
import type { Interaction, Member } from './team-interaction.context.js';
import {
  addDays,
  CollaborationRuleError,
  checkinStatus,
  checkinWindow,
  presenceActive,
  validClearTime,
} from '../domain/collaboration.js';
type Page = z.infer<typeof c.ProjectPageQuerySchema>;
type SettingsPatch = z.infer<typeof c.TeamSettingsPatchSchema>;
const generalFields = ['color', 'shortName', 'defaultInviteRole'] as const;
const ref = (accessId: string, generation: number): Member => ({
  accessId,
  generation,
});
const same = (a: Member, b: Member) =>
  a.accessId === b.accessId && a.generation === b.generation;
const date = (v: string) => new Date(v + 'T00:00:00Z');
function rule<T>(work: () => T) {
  try {
    return work();
  } catch (error) {
    if (error instanceof CollaborationRuleError)
      throw new BadRequestException({ code: error.code });
    throw error;
  }
}
const settingsView = (id: string, r: TeamSetting | null) =>
  c.TeamSettingsSchema.parse({
    teamId: id,
    planningMode: r?.planningMode ?? 'WEEKLY',
    estimateUnit: r?.estimateUnit ?? null,
    weekStart: r?.weekStart ?? null,
    checkinsEnabled: r?.checkinsEnabled ?? null,
    statusEnabled: r?.statusEnabled ?? null,
    color: r?.color ?? null,
    shortName: r?.shortName ?? null,
    defaultInviteRole: r?.defaultInviteRole ?? null,
    checkinSchedule: !r?.checkinCadence
      ? null
      : r.checkinCadence === 'WEEKLY'
        ? {
            cadence: 'WEEKLY',
            opensDay: r.checkinOpensDay,
            opensTime: r.checkinOpensTime,
            closesDay: r.checkinClosesDay,
            closesTime: r.checkinClosesTime,
            timezone: r.checkinTimezone,
          }
        : {
            cadence: 'DAILY',
            opensTime: r.checkinOpensTime,
            closesTime: r.checkinClosesTime,
            timezone: r.checkinTimezone,
          },
    revision: r?.revision ?? 1,
    updatedAt: r?.updatedAt.toISOString() ?? null,
  });
const presenceView = (member: Member, r: TeamPresence | null, now: Date) => {
  const active = r && presenceActive(r, now);
  return c.TeamPresenceSchema.parse({
    member,
    status: active ? r.status : null,
    note: active ? r.note : '',
    clearAfter: active ? r.clearAfter : 'NEVER',
    until: active ? (r.until?.toISOString() ?? null) : null,
    revision: r?.revision ?? 1,
    updatedAt: r?.updatedAt.toISOString() ?? null,
  });
};
const commentView = (r: TeamCheckinComment) =>
  c.TeamCheckinCommentSchema.parse({
    id: r.id,
    replyId: r.replyId,
    author: ref(r.accessId, r.generation),
    body: r.body,
    createdAt: r.createdAt.toISOString(),
  });
const replyView = (
  r: TeamCheckinReply,
  comments: TeamCheckinComment[],
  mine: boolean,
) =>
  c.TeamCheckinReplySchema.parse({
    id: r.id,
    period: r.period.toISOString().slice(0, 10),
    member: ref(r.accessId, r.generation),
    state: r.state,
    did: r.did,
    next: r.next,
    blocked: r.blocked,
    late: mine ? r.late : null,
    sentAt: r.sentAt.toISOString(),
    revision: r.revision,
    comments: comments.filter((x) => x.replyId === r.id).map(commentView),
  });
const requestView = (r: TeamFeedbackRequest, answered: boolean) =>
  c.TeamFeedbackRequestSchema.parse({
    id: r.id,
    requester: ref(r.requesterAccessId, r.requesterGeneration),
    asked: ref(r.askedAccessId, r.askedGeneration),
    about: r.about,
    question: r.question,
    status: answered || r.answeredAt ? 'ANSWERED' : 'OPEN',
    createdAt: r.createdAt.toISOString(),
  });
const noteView = (r: TeamFeedbackNote) =>
  c.TeamFeedbackNoteSchema.parse({
    id: r.id,
    author: ref(r.authorAccessId, r.authorGeneration),
    recipient: ref(r.recipientAccessId, r.recipientGeneration),
    about: r.about,
    body: r.body,
    requestId: r.requestId,
    createdAt: r.createdAt.toISOString(),
  });
@Injectable()
export class TeamCollaborationService {
  constructor(
    @Inject(TeamInteractionContext) private readonly op: TeamInteractionContext,
    @Inject(SharedTasks) private readonly tasks: SharedTasks,
    @Inject(SharedGoals) private readonly goals: SharedGoals,
    @Inject(TeamProjects) private readonly projects: TeamProjects,
  ) {}
  private me(s: Interaction): Member {
    const a = this.op.access(s);
    return ref(a.accessId, a.generation);
  }
  private admin(s: Interaction) {
    return ['OWNER', 'ADMIN'].includes(this.op.access(s).role ?? '');
  }
  private async mine(s: Interaction, m: Member) {
    return this.op.kernel.audienceMatches(s.tx, s.a, s.id, m);
  }
  private settingsRow(s: Interaction) {
    return s.tx.teamSetting.findUnique({
      where: { spaceId_scopeId: this.op.scope(s) },
    });
  }
  private async members(s: Interaction) {
    return (await this.op.kernel.currentMemberships(s.tx, s.a, s.id)).filter(
      (m) => m.state === 'ACTIVE',
    );
  }
  /** Recipients must be current, verified Team members other than the caller. */
  private async other(s: Interaction, m: Member) {
    if (same(m, this.me(s)))
      throw new ConflictException({ code: 'SELF_NOT_ALLOWED' });
    await this.op.member(s, m);
  }

  // Settings ---------------------------------------------------------------
  settings(actor: RequestActor, id: string) {
    return this.op.read(actor, id, async (s) =>
      settingsView(id, await this.settingsRow(s)),
    );
  }
  async patchSettings(
    actor: RequestActor,
    id: string,
    revision: number,
    input: SettingsPatch,
  ) {
    const body = c.TeamSettingsPatchSchema.parse(input),
      general = generalFields.some((f) => body[f] !== undefined),
      planning = Object.keys(body).some(
        (k) => !(generalFields as readonly string[]).includes(k),
      );
    return this.op.write(
      actor,
      id,
      general ? 'settings.manage' : 'work.manage',
      [],
      'team.settings.update',
      id,
      async (s) => {
        if (general && planning)
          await this.op.member(s, this.me(s), ['work.manage']);
        const before = await this.settingsRow(s);
        this.op.match(before?.revision ?? 1, revision);
        if (
          body.planningMode === 'WEEKLY' &&
          (await s.tx.teamPlan.count({
            where: { ...this.op.scope(s), kind: 'SPRINT', state: 'ACTIVE' },
          }))
        )
          throw new ConflictException({ code: 'ACTIVE_SPRINT' });
        const { checkinSchedule, ...rest } = body,
          weekly =
            checkinSchedule?.cadence === 'WEEKLY' ? checkinSchedule : null,
          data = {
            ...(Object.fromEntries(
              Object.entries(rest).filter(([, v]) => v !== undefined),
            ) as Record<string, string | number | boolean | null>),
            ...(checkinSchedule !== undefined
              ? {
                  checkinCadence: checkinSchedule?.cadence ?? null,
                  checkinOpensDay: weekly?.opensDay ?? null,
                  checkinOpensTime: checkinSchedule?.opensTime ?? null,
                  checkinClosesDay: weekly?.closesDay ?? null,
                  checkinClosesTime: checkinSchedule?.closesTime ?? null,
                  checkinTimezone: checkinSchedule?.timezone ?? null,
                }
              : {}),
            updatedAt: s.now,
          };
        if (checkinSchedule)
          rule(() =>
            checkinWindow(
              wallInstant,
              addDays('2030-01-06', weekly?.opensDay ?? 0),
              checkinSchedule,
            ),
          );
        await s.begin();
        const row = before
          ? await s.tx.teamSetting.update({
              where: { id: before.id },
              data: { ...data, revision: { increment: 1 } },
            })
          : await s.tx.teamSetting.create({
              data: { id: randomUUID(), ...this.op.scope(s), ...data },
            });
        return settingsView(id, row);
      },
    );
  }
  private async enabled(
    s: Interaction,
    field: 'statusEnabled' | 'checkinsEnabled',
  ) {
    const row = await this.settingsRow(s);
    return row?.[field] === true ? row : null;
  }

  // Presence (manual status only; nothing is inferred) ---------------------
  presence(actor: RequestActor, id: string, q: Page) {
    return this.op.read(actor, id, async (s) => {
      if (!(await this.enabled(s, 'statusEnabled')))
        return { items: [], nextCursor: null };
      const current = await this.members(s),
        live = new Set(current.map((m) => m.id + ':' + m.generation));
      return this.op
        .page(s, 'team-presence', q, (after) =>
          s.tx.teamPresence
            .findMany({
              where: {
                ...this.op.scope(s),
                status: { not: null },
                OR: [{ until: null }, { until: { gt: s.now } }],
                accessId: { in: current.map((m) => m.id) },
                ...(after ? { id: { gt: after } } : {}),
              },
              orderBy: { id: 'asc' },
              take: q.limit + 1,
            })
            .then((rows) =>
              rows
                .filter((r) => live.has(r.accessId + ':' + r.generation))
                .map((r) => ({
                  ...presenceView(ref(r.accessId, r.generation), r, s.now),
                  id: r.id,
                })),
            ),
        )
        .then((page) => ({
          ...page,
          items: page.items.map(({ id: _id, ...rest }) =>
            c.TeamPresenceSchema.parse(rest),
          ),
        }));
    });
  }
  myPresence(actor: RequestActor, id: string) {
    return this.op.read(actor, id, async (s) => {
      const me = this.me(s);
      return presenceView(
        me,
        await s.tx.teamPresence.findUnique({
          where: {
            spaceId_accessId_generation: {
              spaceId: this.op.scope(s).spaceId,
              ...me,
            },
          },
        }),
        s.now,
      );
    });
  }
  setPresence(
    actor: RequestActor,
    id: string,
    revision: number,
    input: z.infer<typeof c.TeamPresenceInputSchema>,
  ) {
    const body = c.TeamPresenceInputSchema.parse(input);
    return this.op.write(
      actor,
      id,
      'task.create',
      [],
      'team.presence.set',
      id,
      async (s) => {
        if (!(await this.enabled(s, 'statusEnabled')))
          throw new ConflictException({ code: 'STATUS_DISABLED' });
        const until = body.until ? new Date(body.until) : null;
        if (body.status && !validClearTime(body.clearAfter, until, s.now))
          throw new BadRequestException({ code: 'INVALID_CLEAR_TIME' });
        const me = this.me(s),
          key = { spaceId: this.op.scope(s).spaceId, ...me },
          before = await s.tx.teamPresence.findUnique({
            where: { spaceId_accessId_generation: key },
          });
        this.op.match(before?.revision ?? 1, revision);
        await s.begin();
        const data = {
          status: body.status,
          note: body.note,
          clearAfter: body.clearAfter,
          until,
          updatedAt: s.now,
        };
        const row = before
          ? await s.tx.teamPresence.update({
              where: { id: before.id },
              data: { ...data, revision: { increment: 1 } },
            })
          : await s.tx.teamPresence.create({
              data: {
                id: randomUUID(),
                ...this.op.scope(s),
                ...me,
                ...data,
              },
            });
        return presenceView(me, row, s.now);
      },
    );
  }

  // Check-ins (three work questions; no mood or scores) --------------------
  private async week(s: Interaction, week: string) {
    const row = await this.enabled(s, 'checkinsEnabled');
    if (!row?.checkinTimezone)
      throw new ConflictException({ code: 'CHECKINS_DISABLED' });
    const schedule = settingsView(s.id, row).checkinSchedule!,
      w = rule(() => checkinWindow(wallInstant, week, schedule));
    return { schedule, w, status: checkinStatus(w, s.now) };
  }
  checkinWeek(actor: RequestActor, id: string, week: string) {
    return this.op.read(actor, id, async (s) => {
      const { schedule, w, status } = await this.week(s, week);
      const replies = await s.tx.teamCheckinReply.findMany({
          where: { ...this.op.scope(s), period: date(week) },
          orderBy: { sentAt: 'desc' },
          take: 2001,
        }),
        comments = await s.tx.teamCheckinComment.findMany({
          where: {
            spaceId: this.op.scope(s).spaceId,
            replyId: { in: replies.map((r) => r.id) },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 10001,
        });
      if (replies.length > 2000 || comments.length > 10000)
        throw new PayloadTooLargeException();
      const audience = await this.op.kernel.historicalAudience(s.tx, s.a, id),
        isMine = (r: TeamCheckinReply) =>
          audience.some((m) => same(m, ref(r.accessId, r.generation))),
        mine = replies.find(isMine) ?? null,
        responded = new Set(
          replies.map((r) => r.accessId + ':' + r.generation),
        ),
        statusOn = await this.enabled(s, 'statusEnabled'),
        off = statusOn
          ? new Set(
              (
                await s.tx.teamPresence.findMany({
                  where: { ...this.op.scope(s), status: 'OFFLINE' },
                })
              )
                .filter((r) => presenceActive(r, s.now))
                .map((r) => r.accessId + ':' + r.generation),
            )
          : new Set<string>(),
        notYet = (await this.members(s))
          .filter(
            (m) =>
              m.memberRole !== 'VIEWER' &&
              !responded.has(m.id + ':' + m.generation),
          )
          .map((m) => ({
            member: ref(m.id, m.generation),
            offline: off.has(m.id + ':' + m.generation),
          })),
        contributor = this.op.access(s).role !== 'VIEWER';
      return c.TeamCheckinWeekSchema.parse({
        teamId: id,
        period: week,
        status,
        opensAt: w.opensAt.toISOString(),
        closesAt: w.closesAt.toISOString(),
        lateUntil: w.lateUntil.toISOString(),
        schedule,
        replies: replies
          .filter((r) => r.state === 'SENT' && r !== mine)
          .map((r) => replyView(r, comments, false)),
        mine: {
          state: mine?.state ?? 'MISSING',
          reply: mine ? replyView(mine, comments, true) : null,
        },
        notYet,
        can: {
          reply:
            contributor && (status === 'OPEN' || (status === 'LATE' && !mine)),
          comment: contributor && (status === 'OPEN' || status === 'LATE'),
        },
      });
    });
  }
  reply(
    actor: RequestActor,
    id: string,
    week: string,
    revision: number,
    input: z.infer<typeof c.TeamCheckinReplyInputSchema>,
  ) {
    const body = c.TeamCheckinReplyInputSchema.parse(input);
    return this.op.write(
      actor,
      id,
      'task.create',
      [],
      'team.checkin.reply',
      id,
      async (s) => {
        const { status } = await this.week(s, week),
          me = this.me(s),
          before = await s.tx.teamCheckinReply.findUnique({
            where: {
              spaceId_scopeId_period_accessId_generation: {
                ...this.op.scope(s),
                period: date(week),
                ...me,
              },
            },
          });
        if (!(status === 'OPEN' || (status === 'LATE' && !before)))
          throw new ConflictException({ code: 'CHECKIN_CLOSED' });
        this.op.match(before?.revision ?? 1, revision);
        await s.begin();
        const data =
          body.kind === 'SKIP'
            ? { state: 'SKIPPED', did: null, next: null, blocked: null }
            : {
                state: 'SENT',
                did: body.did,
                next: body.next,
                blocked: body.blocked,
              };
        const row = before
          ? await s.tx.teamCheckinReply.update({
              where: { id: before.id },
              data: { ...data, sentAt: s.now, revision: { increment: 1 } },
            })
          : await s.tx.teamCheckinReply.create({
              data: {
                id: randomUUID(),
                ...this.op.scope(s),
                period: date(week),
                ...me,
                ...data,
                late: status === 'LATE',
                sentAt: s.now,
              },
            });
        const comments = await s.tx.teamCheckinComment.findMany({
          where: { spaceId: row.spaceId, replyId: row.id },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        return replyView(row, comments, true);
      },
    );
  }
  comment(
    actor: RequestActor,
    id: string,
    week: string,
    replyId: string,
    input: z.infer<typeof c.TeamCheckinCommentInputSchema>,
    key: string | undefined,
  ) {
    const body = c.TeamCheckinCommentInputSchema.parse(input);
    return this.op.write(
      actor,
      id,
      'task.create',
      [],
      'team.checkin.comment',
      body.id,
      async (s) => {
        const { status } = await this.week(s, week);
        if (status !== 'OPEN' && status !== 'LATE')
          throw new ConflictException({ code: 'CHECKIN_CLOSED' });
        const reply = await s.tx.teamCheckinReply.findFirst({
          where: {
            id: replyId,
            ...this.op.scope(s),
            period: date(week),
            state: 'SENT',
          },
        });
        if (!reply) throw new NotFoundException();
        await this.op.once(
          s,
          'team.checkin.comment',
          key,
          { week, replyId, body },
          async () => {
            if (
              (await s.tx.teamCheckinComment.count({
                where: { spaceId: reply.spaceId, replyId },
              })) >= 200
            )
              throw new PayloadTooLargeException();
            await s.begin();
            return s.tx.teamCheckinComment.create({
              data: {
                id: body.id,
                ...this.op.scope(s),
                replyId,
                ...this.me(s),
                body: body.body,
              },
            });
          },
        );
        const row = await s.tx.teamCheckinComment.findFirst({
          where: { id: body.id, ...this.op.scope(s), replyId },
        });
        if (!row) throw new NotFoundException();
        return commentView(row);
      },
    );
  }

  // Recognition (thanks) ---------------------------------------------------
  private async linkTitle(
    s: Interaction,
    link: { kind: string; id: string } | null,
  ) {
    if (!link) return null;
    try {
      return link.kind === 'TASK'
        ? (await this.tasks.read(s.tx, s.a, s.id, link.id)).title
        : (await this.goals.read(s.tx, s.a, s.id, link.id)).title;
    } catch (error) {
      if (error instanceof NotFoundException) return null;
      throw error;
    }
  }
  /** AN: the linked Project, only while linked to this Team and independently readable by the caller. */
  private async projectLink(s: Interaction, projectId: string) {
    const linked = await this.projects.linkedProject(s.tx, s.id, projectId);
    if (!linked) return null;
    try {
      await this.op.kernel.participantAuthority(
        s.tx,
        s.actor,
        s.actor.userId,
        {
          spaceId: linked.spaceId,
          scopeId: projectId,
          capability: 'task.read',
        },
        s.locked,
      );
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof ConflictException
      )
        return null;
      throw error;
    }
    return { projectId, title: linked.title };
  }
  private async thanksView(
    s: Interaction,
    r: TeamThanks,
    recipients: TeamThanksRecipient[],
  ) {
    const audience = await this.op.kernel.historicalAudience(s.tx, s.a, s.id),
      has = (m: Member) => audience.some((x) => same(x, m)),
      own = recipients.filter((x) => x.thanksId === r.id);
    return c.TeamThanksSchema.parse({
      id: r.id,
      author: ref(r.authorAccessId, r.authorGeneration),
      recipients: own.map((x) => ref(x.accessId, x.generation)),
      body: r.body,
      visibility: r.visibility,
      link:
        r.linkKind && r.linkId
          ? {
              kind: r.linkKind,
              id: r.linkId,
              title: await this.linkTitle(s, {
                kind: r.linkKind,
                id: r.linkId,
              }),
            }
          : null,
      project: r.projectId ? await this.projectLink(s, r.projectId) : null,
      hidden: own.some((x) => x.hidden),
      createdAt: r.createdAt.toISOString(),
      can: {
        delete: has(ref(r.authorAccessId, r.authorGeneration)),
        hide: own.some((x) => has(ref(x.accessId, x.generation))),
        remove: this.admin(s),
      },
    });
  }
  /** Team-visible and not hidden, or written/received by the caller. */
  private async thanksWhere(
    s: Interaction,
  ): Promise<Prisma.TeamThanksWhereInput> {
    const audience = await this.op.kernel.historicalAudience(s.tx, s.a, s.id);
    return {
      ...this.op.scope(s),
      removedAt: null,
      OR: [
        {
          visibility: 'TEAM',
          NOT: {
            id: {
              in: (
                await s.tx.teamThanksRecipient.findMany({
                  where: { spaceId: this.op.scope(s).spaceId, hidden: true },
                  select: { thanksId: true },
                  take: 10000,
                })
              ).map((r) => r.thanksId),
            },
          },
        },
        ...audience.map((m) => ({
          authorAccessId: m.accessId,
          authorGeneration: m.generation,
        })),
        {
          id: {
            in: (
              await s.tx.teamThanksRecipient.findMany({
                where: {
                  spaceId: this.op.scope(s).spaceId,
                  OR: audience.map((m) => ({
                    accessId: m.accessId,
                    generation: m.generation,
                  })),
                },
                select: { thanksId: true },
                take: 10000,
              })
            ).map((r) => r.thanksId),
          },
        },
      ],
    };
  }
  private async thanksRow(s: Interaction, thanksId: string) {
    const row = await s.tx.teamThanks.findFirst({
      where: { ...(await this.thanksWhere(s)), id: thanksId },
    });
    if (!row) throw new NotFoundException();
    return {
      row,
      recipients: await s.tx.teamThanksRecipient.findMany({
        where: { spaceId: row.spaceId, thanksId },
      }),
    };
  }
  thanks(actor: RequestActor, id: string, q: Page) {
    return this.op.read(actor, id, async (s) => {
      const where = await this.thanksWhere(s);
      return this.op.page(s, 'team-thanks', q, async (after) => {
        const rows = await s.tx.teamThanks.findMany({
            where: { ...where, ...(after ? { id: { gt: after } } : {}) },
            orderBy: { id: 'asc' },
            take: q.limit + 1,
          }),
          recipients = await s.tx.teamThanksRecipient.findMany({
            where: {
              spaceId: this.op.scope(s).spaceId,
              thanksId: { in: rows.map((r) => r.id) },
            },
          });
        return Promise.all(rows.map((r) => this.thanksView(s, r, recipients)));
      });
    });
  }
  give(
    actor: RequestActor,
    id: string,
    input: z.infer<typeof c.TeamThanksCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.TeamThanksCreateSchema.parse(input);
    return this.op.write(
      actor,
      id,
      'task.create',
      body.recipients,
      'team.thanks.create',
      body.id,
      async (s) => {
        for (const m of body.recipients) await this.other(s, m);
        if (body.link) {
          if (body.link.kind === 'TASK')
            await this.tasks.read(s.tx, s.a, id, body.link.id);
          else await this.goals.read(s.tx, s.a, id, body.link.id);
        }
        if (body.projectId && !(await this.projectLink(s, body.projectId)))
          throw new NotFoundException();
        await this.op.once(s, 'team.thanks.create', key, body, async () => {
          await s.begin();
          const row = await s.tx.teamThanks.create({
            data: {
              id: body.id,
              ...this.op.scope(s),
              authorAccessId: this.me(s).accessId,
              authorGeneration: this.me(s).generation,
              body: body.body,
              visibility: body.visibility,
              linkKind: body.link?.kind ?? null,
              linkId: body.link?.id ?? null,
              projectId: body.projectId ?? null,
            },
          });
          await s.tx.teamThanksRecipient.createMany({
            data: body.recipients.map((m) => ({
              id: randomUUID(),
              ...this.op.scope(s),
              thanksId: row.id,
              ...m,
            })),
          });
          return row;
        });
        const { row, recipients } = await this.thanksRow(s, body.id);
        return this.thanksView(s, row, recipients);
      },
    );
  }
  hide(actor: RequestActor, id: string, thanksId: string, hidden: boolean) {
    return this.op.write(
      actor,
      id,
      'task.read',
      [],
      'team.thanks.hide',
      thanksId,
      async (s) => {
        const { row, recipients } = await this.thanksRow(s, thanksId),
          audience = await this.op.kernel.historicalAudience(s.tx, s.a, id),
          mine = recipients.filter((x) =>
            audience.some((m) => same(m, ref(x.accessId, x.generation))),
          );
        if (!mine.length) throw new ForbiddenException();
        await s.begin();
        await s.tx.teamThanksRecipient.updateMany({
          where: { id: { in: mine.map((x) => x.id) } },
          data: { hidden },
        });
        const after = await this.thanksRow(s, thanksId).catch(() => null);
        return this.thanksView(
          s,
          after?.row ?? row,
          after?.recipients ??
            recipients.map((x) => (mine.includes(x) ? { ...x, hidden } : x)),
        );
      },
    );
  }
  remove(actor: RequestActor, id: string, thanksId: string) {
    return this.op.write(
      actor,
      id,
      'task.read',
      [],
      'team.thanks.remove',
      thanksId,
      async (s) => {
        const { row } = await this.thanksRow(s, thanksId);
        if (
          !(await this.mine(
            s,
            ref(row.authorAccessId, row.authorGeneration),
          )) &&
          !this.admin(s)
        )
          throw new ForbiddenException();
        await s.begin();
        await s.tx.teamThanks.update({
          where: { id: thanksId },
          data: {
            removedAt: s.now,
            removedByActorId: this.op.access(s).actorId,
          },
        });
        return { id: thanksId, removed: true as const };
      },
    );
  }

  // Private 1:1 feedback (writer and recipient only) -----------------------
  feedback(actor: RequestActor, id: string) {
    return this.op.read(actor, id, async (s) => {
      const audience = await this.op.kernel.historicalAudience(s.tx, s.a, id),
        scope = this.op.scope(s),
        as = (a: string, g: string) =>
          audience.map((m) => ({ [a]: m.accessId, [g]: m.generation })),
        take = 200;
      const [asked, requested, received, sent] = await Promise.all([
        s.tx.teamFeedbackRequest.findMany({
          where: {
            ...scope,
            answeredAt: null,
            OR: as('askedAccessId', 'askedGeneration'),
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take,
        }),
        s.tx.teamFeedbackRequest.findMany({
          where: {
            ...scope,
            OR: as('requesterAccessId', 'requesterGeneration'),
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take,
        }),
        s.tx.teamFeedbackNote.findMany({
          where: {
            ...scope,
            OR: as('recipientAccessId', 'recipientGeneration'),
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take,
        }),
        s.tx.teamFeedbackNote.findMany({
          where: { ...scope, OR: as('authorAccessId', 'authorGeneration') },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take,
        }),
      ]);
      return c.TeamFeedbackInboxSchema.parse({
        asked: asked.map((r) => requestView(r, false)),
        requested: requested.map((r) => requestView(r, false)),
        received: received.map(noteView),
        sent: sent.map(noteView),
      });
    });
  }
  requestFeedback(
    actor: RequestActor,
    id: string,
    input: z.infer<typeof c.TeamFeedbackRequestCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.TeamFeedbackRequestCreateSchema.parse(input);
    return this.op.write(
      actor,
      id,
      'task.create',
      [body.asked],
      'team.feedback.request',
      body.id,
      async (s) => {
        await this.other(s, body.asked);
        await this.op.once(s, 'team.feedback.request', key, body, async () => {
          await s.begin();
          const me = this.me(s);
          return s.tx.teamFeedbackRequest.create({
            data: {
              id: body.id,
              ...this.op.scope(s),
              requesterAccessId: me.accessId,
              requesterGeneration: me.generation,
              askedAccessId: body.asked.accessId,
              askedGeneration: body.asked.generation,
              about: body.about,
              question: body.question,
            },
          });
        });
        const row = await s.tx.teamFeedbackRequest.findFirst({
          where: { id: body.id, ...this.op.scope(s) },
        });
        if (
          !row ||
          !(await this.mine(
            s,
            ref(row.requesterAccessId, row.requesterGeneration),
          ))
        )
          throw new NotFoundException();
        return requestView(row, false);
      },
    );
  }
  writeFeedback(
    actor: RequestActor,
    id: string,
    input: z.infer<typeof c.TeamFeedbackNoteCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.TeamFeedbackNoteCreateSchema.parse(input);
    return this.op.write(
      actor,
      id,
      'task.create',
      [body.recipient],
      'team.feedback.write',
      body.id,
      async (s) => {
        await this.other(s, body.recipient);
        await this.op.once(s, 'team.feedback.write', key, body, async () => {
          const me = this.me(s);
          if (body.requestId) {
            const request = await s.tx.teamFeedbackRequest.findFirst({
              where: { id: body.requestId, ...this.op.scope(s) },
            });
            if (
              !request ||
              !(await this.mine(
                s,
                ref(request.askedAccessId, request.askedGeneration),
              ))
            )
              throw new NotFoundException();
            if (
              request.answeredAt ||
              !same(
                ref(request.requesterAccessId, request.requesterGeneration),
                body.recipient,
              )
            )
              throw new ConflictException({ code: 'REQUEST_NOT_OPEN' });
            await s.tx.teamFeedbackRequest.update({
              where: { id: request.id },
              data: { answeredAt: s.now },
            });
          }
          await s.begin();
          return s.tx.teamFeedbackNote.create({
            data: {
              id: body.id,
              ...this.op.scope(s),
              authorAccessId: me.accessId,
              authorGeneration: me.generation,
              recipientAccessId: body.recipient.accessId,
              recipientGeneration: body.recipient.generation,
              about: body.about,
              body: body.body,
              requestId: body.requestId,
            },
          });
        });
        const row = await s.tx.teamFeedbackNote.findFirst({
          where: { id: body.id, ...this.op.scope(s) },
        });
        if (
          !row ||
          !(await this.mine(s, ref(row.authorAccessId, row.authorGeneration)))
        )
          throw new NotFoundException();
        return noteView(row);
      },
    );
  }

  // Activity (current Team Task history; no inferred presence) -------------
  activity(actor: RequestActor, id: string, limit: number) {
    return this.op.read(actor, id, async (s) =>
      c.TeamActivityPageSchema.parse({
        items: (await this.tasks.changes(s.tx, s.a, id, limit)).map((r) => ({
          id: r.id,
          kind:
            r.kind === 'CREATED'
              ? 'CREATED'
              : r.kind === 'COMPLETED'
                ? 'COMPLETED'
                : 'MOVED',
          taskId: r.taskId,
          title: r.title,
          actorId: r.actorId,
          status: r.afterStatus,
          at: r.createdAt.toISOString(),
        })),
      }),
    );
  }
}
