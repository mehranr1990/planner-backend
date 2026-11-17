import {
  Injectable,
  Inject,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { SpacesService } from '../../spaces/public/index.js';
import { CaptureTasks } from '../../tasks/public/index.js';
import { PersonalCapacityCalendar } from '../../calendar/public/index.js';
import { socialHash, socialRevision } from './social-context.js';
import type { Tx } from './social-context.js';
import { ActivityRuntime } from './activity-runtime.js';
import type { ActivityRow } from './activity-runtime.js';
import {
  SocialActivitiesService,
  iso,
  participation,
  RECOVERY_MS,
} from './activities.service.js';
type Page = z.infer<typeof c.SocialPageQuerySchema>;
type ItemRow = Prisma.SocialActivityItemGetPayload<object>;
type NoticeRow = Prisma.SocialNoticeGetPayload<object>;
export function localDate(at: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}
const DAY = 86400000;
@Injectable()
export class SocialPlanningService {
  constructor(
    @Inject(ActivityRuntime) private readonly rt: ActivityRuntime,
    @Inject(SocialActivitiesService)
    private readonly activities: SocialActivitiesService,
    @Inject(SpacesService) private readonly spaces: SpacesService,
    @Inject(CaptureTasks) private readonly tasks: CaptureTasks,
    @Inject(PersonalCapacityCalendar)
    private readonly calendar: PersonalCapacityCalendar,
  ) {}
  private within(
    act: ActivityRow,
    startsAt: Date | null,
    endsAt: Date | null,
    kind: string,
  ) {
    if (kind === 'ITINERARY' && !startsAt)
      throw new UnprocessableEntityException({
        code: 'ITINERARY_TIME_REQUIRED',
      });
    if (endsAt && (!startsAt || endsAt < startsAt))
      throw new UnprocessableEntityException({ code: 'SCHEDULE_INVALID' });
    if (
      kind !== 'CHECKLIST' &&
      ((startsAt && (startsAt < act.startsAt || startsAt > act.endsAt)) ||
        (endsAt && endsAt > act.endsAt))
    )
      throw new UnprocessableEntityException({
        code: 'OUTSIDE_ACTIVITY_SCHEDULE',
      });
  }
  itemView(act: ActivityRow, r: ItemRow) {
    const day = r.startsAt ? localDate(r.startsAt, act.timezone) : null;
    return c.SocialActivityItemSchema.parse({
      id: r.id,
      activityId: r.activityId,
      kind: r.kind,
      title: r.title,
      notes: r.notes,
      location: r.location,
      startsAt: iso(r.startsAt),
      endsAt: iso(r.endsAt),
      localDate: day,
      dayIndex: day
        ? Math.round(
            (Date.parse(day) -
              Date.parse(localDate(act.startsAt, act.timezone))) /
              DAY,
          )
        : null,
      position: r.position,
      done: r.done,
      assigneeParticipantId: r.assigneeParticipantId,
      createdByParticipantId: r.createdByParticipantId,
      revision: r.revision,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    });
  }
  private async assignee(
    tx: Tx,
    activityId: string,
    id: string | null | undefined,
  ) {
    if (!id) return;
    const p = await tx.socialActivityParticipant.findFirst({
      where: { id, activityId, state: 'ACTIVE' },
    });
    if (!p)
      throw new UnprocessableEntityException({ code: 'ASSIGNEE_INVALID' });
  }
  async items(actor: RequestActor, id: string, q: Page) {
    const h = await this.rt.hint(id);
    return this.rt.run(actor, h.groupId, [], async (tx, now, locked) => {
      const { act, a } = await this.activities.enter(
        tx,
        actor,
        id,
        now,
        locked,
      );
      this.activities.require(a);
      const rows = await tx.socialActivityItem.findMany({
        where: { activityId: id, deletedAt: null },
        orderBy: { id: 'asc' },
      });
      return this.rt.context.page(
        actor,
        'social.activity.items:' + id,
        socialHash([
          a.participant?.generation,
          rows.map((r) => [r.id, r.revision]),
        ]),
        q,
        rows.map((r) => this.itemView(act, r)),
      );
    });
  }
  async createItem(
    actor: RequestActor,
    id: string,
    body: z.infer<typeof c.SocialActivityItemCreateSchema>,
    key: string | undefined,
  ) {
    const h = await this.rt.hint(id);
    return this.rt.run(actor, h.groupId, [], async (tx, now, locked) => {
      const { act, a } = await this.activities.enter(
        tx,
        actor,
        id,
        now,
        locked,
      );
      this.activities.require(a, body.kind !== 'CHECKLIST');
      if (!a.active)
        throw new ForbiddenException({
          code: 'ACTIVITY_PARTICIPATION_REQUIRED',
        });
      return this.rt.once(
        tx,
        actor,
        'social.activity.item.create',
        key,
        { id, body },
        now,
        async () => {
          this.activities.open(act, now);
          if (
            await tx.socialActivityItem.findUnique({ where: { id: body.id } })
          )
            throw new ConflictException({ code: 'ITEM_EXISTS' });
          const count = await tx.socialActivityItem.count({
            where: { activityId: id },
          });
          if (count >= 500) throw new PayloadTooLargeException();
          const startsAt = body.startsAt ? new Date(body.startsAt) : null,
            endsAt = body.endsAt ? new Date(body.endsAt) : null;
          this.within(act, startsAt, endsAt, body.kind);
          if (body.kind !== 'CHECKLIST' && body.assigneeParticipantId)
            throw new UnprocessableEntityException({
              code: 'ASSIGNEE_INVALID',
            });
          await this.assignee(tx, id, body.assigneeParticipantId);
          const last = await tx.socialActivityItem.findFirst({
            where: { activityId: id },
            orderBy: { position: 'desc' },
            select: { position: true },
          });
          const row = await tx.socialActivityItem.create({
            data: {
              id: body.id,
              activityId: id,
              kind: body.kind,
              title: body.title,
              notes: body.notes ?? null,
              location: body.location ?? null,
              startsAt,
              endsAt,
              position: (last?.position ?? 0) + 1,
              assigneeParticipantId: body.assigneeParticipantId ?? null,
              createdByParticipantId: a.participant!.id,
            },
          });
          await this.rt.record(
            tx,
            actor,
            { activityId: id },
            'social.activity.item.create',
            row.id,
          );
          return { resultId: row.id, value: this.itemView(act, row) };
        },
      );
    });
  }
  async changeItem(
    actor: RequestActor,
    id: string,
    itemId: string,
    body: z.infer<typeof c.SocialActivityItemPatchSchema> | null,
    revision: number,
    key: string | undefined,
  ) {
    const h = await this.rt.hint(id);
    return this.rt.run(actor, h.groupId, [], async (tx, now, locked) => {
      const { act, a } = await this.activities.enter(
        tx,
        actor,
        id,
        now,
        locked,
      );
      this.activities.require(a);
      return this.rt.once(
        tx,
        actor,
        body ? 'social.activity.item.update' : 'social.activity.item.delete',
        key,
        { id, itemId, body, revision },
        now,
        async () => {
          const row = await tx.socialActivityItem.findFirst({
            where: { id: itemId, activityId: id, deletedAt: null },
          });
          if (!row) throw new NotFoundException();
          socialRevision(revision, row.revision);
          this.activities.open(act, now);
          const mine =
            !!a.participant &&
            a.active &&
            [row.createdByParticipantId, row.assigneeParticipantId].includes(
              a.participant.id,
            );
          const onlyDone =
            !!body && Object.keys(body).length === 1 && body.done !== undefined;
          const allowed =
            a.manage ||
            (row.kind === 'CHECKLIST' &&
              (body
                ? mine || (onlyDone && a.active)
                : mine && row.createdByParticipantId === a.participant!.id));
          if (!allowed)
            throw new ForbiddenException({
              code: 'ACTIVITY_PERMISSION_REQUIRED',
            });
          if (!body) {
            // ADR 0060 decision B: recoverable for 30 days, then disposed on next access.
            const deleted = await tx.socialActivityItem.update({
              where: { id: itemId },
              data: {
                deletedAt: now,
                recoverUntil: new Date(now.getTime() + RECOVERY_MS),
                revision: { increment: 1 },
                updatedAt: now,
              },
            });
            await this.rt.record(
              tx,
              actor,
              { activityId: id },
              'social.activity.item.delete',
              itemId,
            );
            return { resultId: itemId, value: this.itemView(act, deleted) };
          }
          if (body.done !== undefined && row.kind !== 'CHECKLIST')
            throw new UnprocessableEntityException({
              code: 'ITEM_KIND_INVALID',
            });
          if (body.assigneeParticipantId && row.kind !== 'CHECKLIST')
            throw new UnprocessableEntityException({
              code: 'ASSIGNEE_INVALID',
            });
          const startsAt =
              body.startsAt === undefined
                ? row.startsAt
                : body.startsAt
                  ? new Date(body.startsAt)
                  : null,
            endsAt =
              body.endsAt === undefined
                ? row.endsAt
                : body.endsAt
                  ? new Date(body.endsAt)
                  : null;
          this.within(act, startsAt, endsAt, row.kind);
          await this.assignee(tx, id, body.assigneeParticipantId);
          const changed = await tx.socialActivityItem.update({
            where: { id: itemId },
            data: {
              ...(body.title !== undefined ? { title: body.title } : {}),
              ...(body.notes !== undefined ? { notes: body.notes } : {}),
              ...(body.location !== undefined
                ? { location: body.location }
                : {}),
              ...(body.done !== undefined ? { done: body.done } : {}),
              ...(body.assigneeParticipantId !== undefined
                ? { assigneeParticipantId: body.assigneeParticipantId }
                : {}),
              startsAt,
              endsAt,
              revision: { increment: 1 },
              updatedAt: now,
            },
          });
          await this.rt.record(
            tx,
            actor,
            { activityId: id },
            'social.activity.item.update',
            itemId,
          );
          return { resultId: itemId, value: this.itemView(act, changed) };
        },
      );
    });
  }
  /** Explicit, idempotent creation of the caller's own Personal Task; no shared Task copy. */
  async task(
    actor: RequestActor,
    id: string,
    itemId: string,
    key: string | undefined,
  ) {
    const h = await this.rt.hint(id);
    const scope = await this.spaces.authorizePersonal(actor);
    return this.rt.run(actor, h.groupId, [], async (tx, now, locked) => {
      const { a } = await this.activities.enter(tx, actor, id, now, locked);
      if (!a.active) throw new NotFoundException();
      return this.rt.once(
        tx,
        actor,
        'social.activity.item.task',
        key,
        { id, itemId },
        now,
        async () => {
          const row = await tx.socialActivityItem.findFirst({
            where: {
              id: itemId,
              activityId: id,
              kind: 'CHECKLIST',
              deletedAt: null,
            },
          });
          if (!row) throw new NotFoundException();
          const prior = await tx.socialActivityTaskLink.findUnique({
            where: {
              itemId_participantId: {
                itemId,
                participantId: a.participant!.id,
              },
            },
          });
          if (prior && prior.taskSpaceId === scope.spaceId)
            return {
              resultId: prior.taskId,
              value: { itemId, taskId: prior.taskId, created: false },
            };
          await scope.fence(tx);
          const task = await this.tasks.create(tx, scope, { title: row.title });
          await tx.socialActivityTaskLink.upsert({
            where: {
              itemId_participantId: {
                itemId,
                participantId: a.participant!.id,
              },
            },
            create: {
              itemId,
              activityId: id,
              participantId: a.participant!.id,
              taskSpaceId: scope.spaceId,
              taskId: task.id,
            },
            update: { taskSpaceId: scope.spaceId, taskId: task.id },
          });
          return {
            resultId: task.id,
            value: { itemId, taskId: task.id, created: true },
          };
        },
      );
    });
  }
  private async pollView(tx: Tx, pollId: string, participantId: string | null) {
    const poll = await tx.socialActivityPoll.findUniqueOrThrow({
      where: { id: pollId },
      include: { options: { orderBy: { position: 'asc' } } },
    });
    const votes = await tx.socialActivityPollVote.groupBy({
      by: ['optionId'],
      where: { pollId },
      _count: { _all: true },
    });
    const mine = participantId
      ? await tx.socialActivityPollVote.findMany({
          where: { pollId, participantId },
          select: { optionId: true },
        })
      : [];
    // Aggregate counts only: voter identities are never exposed.
    return c.SocialActivityPollSchema.parse({
      id: poll.id,
      activityId: poll.activityId,
      kind: poll.kind,
      question: poll.question,
      multiple: poll.multiple,
      state: poll.state,
      chosenOptionId: poll.chosenOptionId,
      revision: poll.revision,
      createdAt: poll.createdAt.toISOString(),
      closedAt: iso(poll.closedAt),
      options: poll.options.map((o) => ({
        id: o.id,
        label: o.label,
        startsAt: iso(o.startsAt),
        endsAt: iso(o.endsAt),
        votes: votes.find((v) => v.optionId === o.id)?._count._all ?? 0,
      })),
      myOptionIds: mine.map((m) => m.optionId).sort(),
    });
  }
  async polls(actor: RequestActor, id: string, q: Page) {
    const h = await this.rt.hint(id);
    return this.rt.run(actor, h.groupId, [], async (tx, now, locked) => {
      const { a } = await this.activities.enter(tx, actor, id, now, locked);
      this.activities.require(a);
      const rows = await tx.socialActivityPoll.findMany({
        where: { activityId: id },
        orderBy: { id: 'asc' },
        select: { id: true },
      });
      const me = a.active ? a.participant!.id : null;
      const items = await Promise.all(
        rows.map((r) => this.pollView(tx, r.id, me)),
      );
      return this.rt.context.page(
        actor,
        'social.activity.polls:' + id,
        socialHash(items),
        q,
        items,
      );
    });
  }
  async createPoll(
    actor: RequestActor,
    id: string,
    body: z.infer<typeof c.SocialActivityPollCreateSchema>,
    key: string | undefined,
  ) {
    const h = await this.rt.hint(id);
    return this.rt.run(actor, h.groupId, [], async (tx, now, locked) => {
      const { act, a } = await this.activities.enter(
        tx,
        actor,
        id,
        now,
        locked,
      );
      this.activities.require(a, true);
      return this.rt.once(
        tx,
        actor,
        'social.activity.poll.create',
        key,
        { id, body },
        now,
        async () => {
          this.activities.open(act, now);
          if (
            await tx.socialActivityPoll.findUnique({ where: { id: body.id } })
          )
            throw new ConflictException({ code: 'POLL_EXISTS' });
          if (
            (await tx.socialActivityPoll.count({
              where: { activityId: id },
            })) >= 50
          )
            throw new PayloadTooLargeException();
          await tx.socialActivityPoll.create({
            data: {
              id: body.id,
              activityId: id,
              kind: body.kind,
              question: body.question,
              multiple: body.multiple,
              options: {
                create: body.options.map((o, i) => ({
                  id: o.id,
                  position: i + 1,
                  label: o.label,
                  startsAt: o.startsAt ? new Date(o.startsAt) : null,
                  endsAt: o.endsAt ? new Date(o.endsAt) : null,
                })),
              },
            },
          });
          await this.rt.record(
            tx,
            actor,
            { activityId: id },
            'social.activity.poll.create',
            body.id,
          );
          return {
            resultId: body.id,
            value: await this.pollView(
              tx,
              body.id,
              a.active ? a.participant!.id : null,
            ),
          };
        },
      );
    });
  }
  private async poll(tx: Tx, activityId: string, pollId: string) {
    await tx.$queryRaw`SELECT id FROM "SocialActivityPoll" WHERE id=${pollId}::uuid FOR UPDATE`;
    const poll = await tx.socialActivityPoll.findFirst({
      where: { id: pollId, activityId },
      include: { options: true },
    });
    if (!poll) throw new NotFoundException();
    return poll;
  }
  async vote(
    actor: RequestActor,
    id: string,
    pollId: string,
    body: z.infer<typeof c.SocialActivityVoteSchema>,
    key: string | undefined,
  ) {
    const h = await this.rt.hint(id);
    return this.rt.run(actor, h.groupId, [], async (tx, now, locked) => {
      const { act, a } = await this.activities.enter(
        tx,
        actor,
        id,
        now,
        locked,
      );
      if (!a.active) throw new NotFoundException();
      return this.rt.once(
        tx,
        actor,
        'social.activity.poll.vote',
        key,
        { id, pollId, body },
        now,
        async () => {
          const poll = await this.poll(tx, id, pollId);
          this.activities.open(act, now);
          if (poll.state !== 'OPEN')
            throw new ConflictException({ code: 'POLL_CLOSED' });
          const chosen = [...new Set(body.optionIds)];
          if (
            (!poll.multiple && chosen.length > 1) ||
            chosen.some((o) => !poll.options.some((p) => p.id === o))
          )
            throw new UnprocessableEntityException({
              code: 'POLL_OPTION_INVALID',
            });
          const participantId = a.participant!.id;
          await tx.socialActivityPollVote.deleteMany({
            where: { pollId, participantId },
          });
          if (chosen.length)
            await tx.socialActivityPollVote.createMany({
              data: chosen.map((optionId) => ({
                activityId: id,
                pollId,
                optionId,
                participantId,
              })),
            });
          return {
            resultId: pollId,
            value: await this.pollView(tx, pollId, participantId),
          };
        },
      );
    });
  }
  async closePoll(
    actor: RequestActor,
    id: string,
    pollId: string,
    body: z.infer<typeof c.SocialActivityPollCloseSchema>,
    revision: number,
    key: string | undefined,
  ) {
    const h = await this.rt.hint(id);
    return this.rt.run(actor, h.groupId, [], async (tx, now, locked) => {
      const { act, a } = await this.activities.enter(
        tx,
        actor,
        id,
        now,
        locked,
      );
      this.activities.require(a, true);
      return this.rt.once(
        tx,
        actor,
        'social.activity.poll.close',
        key,
        { id, pollId, body, revision },
        now,
        async () => {
          const poll = await this.poll(tx, id, pollId);
          socialRevision(revision, poll.revision);
          if (poll.state !== 'OPEN')
            throw new ConflictException({ code: 'POLL_CLOSED' });
          const option = body.chosenOptionId
            ? poll.options.find((o) => o.id === body.chosenOptionId)
            : null;
          if (body.chosenOptionId && !option)
            throw new UnprocessableEntityException({
              code: 'POLL_OPTION_INVALID',
            });
          await tx.socialActivityPoll.update({
            where: { id: pollId },
            data: {
              state: 'CLOSED',
              closedAt: now,
              chosenOptionId: option?.id ?? null,
              revision: { increment: 1 },
            },
          });
          // A chosen scheduling option becomes the Activity schedule under the same lock.
          if (poll.kind === 'SCHEDULE' && option?.startsAt && option.endsAt) {
            this.activities.open(act, now);
            await this.activities.assertItemsWithin(
              tx,
              id,
              option.startsAt,
              option.endsAt,
            );
            const updated = await tx.socialActivity.update({
              where: { id },
              data: {
                startsAt: option.startsAt,
                endsAt: option.endsAt,
                revision: { increment: 1 },
                updatedAt: now,
              },
            });
            const rows = await tx.socialActivityParticipant.findMany({
              where: { activityId: id, state: 'ACTIVE' },
              select: { userId: true },
            });
            await this.rt.notify(
              tx,
              rows.map((r) => (r.userId === actor.userId ? null : r.userId)),
              {
                activityId: id,
                kind: 'ACTIVITY_UPDATED',
                resourceId: id,
                dedupe: `${id}:${updated.revision}`,
              },
            );
          }
          await this.rt.record(
            tx,
            actor,
            { activityId: id },
            'social.activity.poll.close',
            pollId,
          );
          return {
            resultId: pollId,
            value: await this.pollView(
              tx,
              pollId,
              a.active ? a.participant!.id : null,
            ),
          };
        },
      );
    });
  }
  /**
   * Consent-based Free/Busy: the participant's own Calendar owner computes
   * busy-only intervals inside the Activity window; titles never leave Calendar.
   */
  async shareBusy(actor: RequestActor, id: string, key: string | undefined) {
    const h = await this.rt.hint(id);
    const scope = await this.spaces.authorizePersonal(actor);
    const snapshot = await this.rt.db.client.socialActivity.findUniqueOrThrow({
      where: { id },
    });
    const from = localDate(snapshot.startsAt, snapshot.timezone),
      to = localDate(
        new Date(snapshot.endsAt.getTime() + DAY),
        snapshot.timezone,
      );
    let raw: { start: number; end: number }[];
    try {
      raw = await this.calendar.busy(scope, from, to, snapshot.timezone);
    } catch (e) {
      if (e instanceof NotFoundException || e instanceof ForbiddenException)
        throw e;
      throw new UnprocessableEntityException({
        code: 'BUSY_RANGE_UNAVAILABLE',
      });
    }
    const start = snapshot.startsAt.getTime(),
      end = snapshot.endsAt.getTime();
    const intervals = raw
      .map((r) => ({
        start: Math.max(r.start, start),
        end: Math.min(r.end, end),
      }))
      .filter((r) => r.end > r.start)
      .sort((x, y) => x.start - y.start || x.end - y.end)
      .slice(0, 1000)
      .map((r) => ({
        start: new Date(r.start).toISOString(),
        end: new Date(r.end).toISOString(),
      }));
    return this.rt.run(actor, h.groupId, [], async (tx, now, locked) => {
      const { act, a } = await this.activities.enter(
        tx,
        actor,
        id,
        now,
        locked,
      );
      if (!a.active) throw new NotFoundException();
      if (
        act.startsAt.getTime() !== start ||
        act.endsAt.getTime() !== end ||
        act.timezone !== snapshot.timezone
      )
        throw new ConflictException({ code: 'ACTIVITY_CHANGED_RETRY' });
      return this.rt.once(
        tx,
        actor,
        'social.activity.busy.share',
        key,
        { id },
        now,
        async () => {
          this.activities.open(act, now);
          const row = await tx.socialActivityBusy.upsert({
            where: { participantId: a.participant!.id },
            create: {
              participantId: a.participant!.id,
              activityId: id,
              intervals,
              capturedAt: now,
            },
            update: { intervals, capturedAt: now },
          });
          return {
            resultId: row.participantId,
            value: c.SocialActivityBusyShareSchema.parse({
              participantId: row.participantId,
              capturedAt: row.capturedAt.toISOString(),
              intervals,
            }),
          };
        },
      );
    });
  }
  async revokeBusy(actor: RequestActor, id: string, key: string | undefined) {
    const h = await this.rt.hint(id);
    return this.rt.run(actor, h.groupId, [], async (tx, now, locked) => {
      const { a } = await this.activities.enter(tx, actor, id, now, locked);
      if (!a.participant) throw new NotFoundException();
      return this.rt.once(
        tx,
        actor,
        'social.activity.busy.revoke',
        key,
        { id },
        now,
        async () => {
          await tx.socialActivityBusy.deleteMany({
            where: { participantId: a.participant!.id },
          });
          return {
            resultId: a.participant!.id,
            value: participation(
              await tx.socialActivityParticipant.findUniqueOrThrow({
                where: { id: a.participant!.id },
              }),
            )!,
          };
        },
      );
    });
  }
  async busy(actor: RequestActor, id: string) {
    const h = await this.rt.hint(id);
    return this.rt.run(actor, h.groupId, [], async (tx, now, locked) => {
      const { act, a } = await this.activities.enter(
        tx,
        actor,
        id,
        now,
        locked,
      );
      this.activities.require(a);
      const eligible = new Map(
        (await this.rt.eligible(tx, act)).map((p) => [p.id, p]),
      );
      const rows = await tx.socialActivityBusy.findMany({
        where: { activityId: id },
        orderBy: { participantId: 'asc' },
      });
      const items = [];
      for (const r of rows) {
        const p = eligible.get(r.participantId);
        if (!p) continue;
        items.push({
          participantId: r.participantId,
          displayName: await this.rt.displayName(tx, p.userId),
          capturedAt: r.capturedAt.toISOString(),
          intervals: r.intervals,
        });
      }
      return c.SocialActivityBusySchema.parse({ items });
    });
  }
  async notices(actor: RequestActor, q: Page) {
    this.rt.kernel.assertEnabled();
    return this.rt.run(actor, null, [], async (tx, now) => {
      // Reminders are materialized from authoritative PostgreSQL state when due.
      const due = await tx.socialActivityParticipant.findMany({
        where: {
          userId: actor.userId,
          state: 'ACTIVE',
          reminderMinutes: { not: null },
          activity: { state: 'PLANNED', startsAt: { gt: now } },
        },
        include: { activity: { select: { startsAt: true } } },
        take: 1000,
      });
      for (const p of due)
        if (
          p.activity.startsAt.getTime() - p.reminderMinutes! * 60000 <=
          now.getTime()
        )
          await this.rt.notify(tx, [actor.userId], {
            activityId: p.activityId,
            kind: 'ACTIVITY_REMINDER',
            resourceId: p.activityId,
            dedupe: `${p.activityId}:${p.activity.startsAt.toISOString()}:${p.reminderMinutes}`,
          });
      const rows = await tx.socialNotice.findMany({
        where: { userId: actor.userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 1000,
      });
      rows.sort((x, y) => x.id.localeCompare(y.id));
      return this.rt.context.page(
        actor,
        'social.notices',
        socialHash(rows.map((r) => [r.id, r.readAt])),
        q,
        rows.map((r) => this.noticeView(r)),
      );
    });
  }
  private noticeView(r: NoticeRow) {
    return c.SocialNoticeSchema.parse({
      id: r.id,
      kind: r.kind,
      activityId: r.activityId,
      groupId: r.groupId,
      resourceId: r.resourceId,
      createdAt: r.createdAt.toISOString(),
      readAt: iso(r.readAt),
    });
  }
  async readNotice(
    actor: RequestActor,
    noticeId: string,
    key: string | undefined,
  ) {
    this.rt.kernel.assertEnabled();
    return this.rt.run(actor, null, [], async (tx, now) =>
      this.rt.once(
        tx,
        actor,
        'social.notice.read',
        key,
        { noticeId },
        now,
        async () => {
          const row = await tx.socialNotice.findFirst({
            where: { id: noticeId, userId: actor.userId },
          });
          if (!row) throw new NotFoundException();
          const read = row.readAt
            ? row
            : await tx.socialNotice.update({
                where: { id: noticeId },
                data: { readAt: now },
              });
          return { resultId: noticeId, value: this.noticeView(read) };
        },
      ),
    );
  }
  /** Authorized overlay projection for the caller's own calendar views; nothing is copied. */
  async calendarFeed(
    actor: RequestActor,
    q: z.infer<typeof c.SocialActivityCalendarQuerySchema>,
  ) {
    this.rt.kernel.assertEnabled();
    const from = new Date(q.from),
      to = new Date(q.to);
    return this.rt.run(actor, null, [], async (tx) => {
      const mine = await tx.socialActivityParticipant.findMany({
        where: {
          userId: actor.userId,
          state: 'ACTIVE',
          activity: {
            state: 'PLANNED',
            startsAt: { lt: to },
            endsAt: { gt: from },
          },
        },
        include: { activity: true },
        take: 1001,
      });
      if (mine.length > 1000) throw new PayloadTooLargeException();
      const items: z.infer<typeof c.SocialActivityCalendarSchema>['items'] = [];
      const groups = new Map<string, Set<string>>();
      for (const p of mine) {
        const act = p.activity;
        if (act.groupId && !p.guest) {
          if (!groups.has(act.groupId))
            groups.set(act.groupId, await this.rt.groupUsers(tx, act.groupId));
          if (!groups.get(act.groupId)!.has(actor.userId)) continue;
        }
        items.push({
          activityId: act.id,
          itemId: null,
          kind: 'ACTIVITY',
          title: act.title,
          startsAt: act.startsAt.toISOString(),
          endsAt: act.endsAt.toISOString(),
          timezone: act.timezone,
        });
        const legs = await tx.socialActivityItem.findMany({
          where: {
            activityId: act.id,
            kind: 'ITINERARY',
            startsAt: { lt: to },
          },
          orderBy: { id: 'asc' },
        });
        for (const l of legs) {
          const end = l.endsAt ?? l.startsAt!;
          if (end < from) continue;
          items.push({
            activityId: act.id,
            itemId: l.id,
            kind: 'ITINERARY',
            title: l.title,
            startsAt: l.startsAt!.toISOString(),
            endsAt: end.toISOString(),
            timezone: act.timezone,
          });
        }
        if (items.length > 1000) throw new PayloadTooLargeException();
      }
      return c.SocialActivityCalendarSchema.parse({ items });
    });
  }
  /** Restores a deleted item inside its 30-day window (managers or the checklist author). */
  async restoreItem(
    actor: RequestActor,
    id: string,
    itemId: string,
    revision: number,
    key: string | undefined,
  ) {
    const h = await this.rt.hint(id);
    return this.rt.run(actor, h.groupId, [], async (tx, now, locked) => {
      const { act, a } = await this.activities.enter(
        tx,
        actor,
        id,
        now,
        locked,
      );
      this.activities.require(a);
      return this.rt.once(
        tx,
        actor,
        'social.activity.item.restore',
        key,
        { id, itemId, revision },
        now,
        async () => {
          const row = await tx.socialActivityItem.findFirst({
            where: { id: itemId, activityId: id, deletedAt: { not: null } },
          });
          if (!row) throw new NotFoundException();
          socialRevision(revision, row.revision);
          const author =
            row.kind === 'CHECKLIST' &&
            a.active &&
            row.createdByParticipantId === a.participant!.id;
          if (!a.manage && !author)
            throw new ForbiddenException({
              code: 'ACTIVITY_PERMISSION_REQUIRED',
            });
          const restored = await tx.socialActivityItem.update({
            where: { id: itemId },
            data: {
              deletedAt: null,
              recoverUntil: null,
              revision: { increment: 1 },
              updatedAt: now,
            },
          });
          await this.rt.record(
            tx,
            actor,
            { activityId: id },
            'social.activity.item.restore',
            itemId,
          );
          return { resultId: itemId, value: this.itemView(act, restored) };
        },
      );
    });
  }
}
