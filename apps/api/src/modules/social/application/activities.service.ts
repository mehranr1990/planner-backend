import {
  Injectable,
  Inject,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { DmContacts, MessagingService } from '../../messaging/public/index.js';
import { socialHash, socialKey, socialRevision } from './social-context.js';
import type { Tx } from './social-context.js';
import { ActivityRuntime } from './activity-runtime.js';
import type {
  ActivityAccess,
  ActivityRow,
  ParticipantRow,
} from './activity-runtime.js';
import { requestSeat, seatCounts } from '../domain/seats.js';
type Page = z.infer<typeof c.SocialPageQuerySchema>;
const MAX_PARTICIPANTS = 1000;
/** ADR 0060 decision B: owner-approved Social content recovery window. */
// Unified 7-day recovery (ADR 0069). Stored per row as recoverUntil, so
// activities deleted earlier keep their original deadline.
export const RECOVERY_MS = 7 * 86400000;
export const iso = (d: Date | null) => (d ? d.toISOString() : null);
export function participation(p: ParticipantRow | null) {
  if (!p) return null;
  return c.SocialActivityParticipationSchema.parse({
    participantId: p.id,
    role: p.role,
    state: p.state,
    rsvp: p.rsvp,
    seat: p.seat,
    guest: p.guest,
    offerExpiresAt: iso(p.offerExpiresAt),
    reminderMinutes: p.reminderMinutes,
    generation: p.generation,
    revision: p.revision,
  });
}
@Injectable()
export class SocialActivitiesService {
  constructor(
    @Inject(ActivityRuntime) private readonly rt: ActivityRuntime,
    @Inject(DmContacts) private readonly contacts: DmContacts,
    @Inject(MessagingService) private readonly messaging: MessagingService,
  ) {}
  private async summary(
    tx: Tx,
    act: ActivityRow,
    me: ParticipantRow | null,
    now: Date,
  ) {
    const rows = await tx.socialActivityParticipant.findMany({
      where: { activityId: act.id },
    });
    return c.SocialActivitySummarySchema.parse({
      id: act.id,
      groupId: act.groupId,
      template: act.template,
      title: act.title,
      timezone: act.timezone,
      startsAt: act.startsAt.toISOString(),
      endsAt: act.endsAt.toISOString(),
      state: act.state,
      capacity: act.capacity,
      ...seatCounts(rows, now),
      me: participation(me),
    });
  }
  async view(tx: Tx, act: ActivityRow, a: ActivityAccess, now: Date) {
    const me = a.participant
      ? await tx.socialActivityParticipant.findUnique({
          where: { id: a.participant.id },
        })
      : null;
    return c.SocialActivitySchema.parse({
      ...(await this.summary(tx, act, me, now)),
      description: act.description,
      location: act.location,
      conversationId: act.conversationId,
      conversationManaged: act.conversationManaged,
      successorParticipantId: act.successorParticipantId,
      orphanedAt: iso(act.orphanedAt),
      deletedAt: iso(act.deletedAt),
      recoverUntil: iso(act.recoverUntil),
      manage: a.manage,
      revision: act.revision,
      createdAt: act.createdAt.toISOString(),
      updatedAt: act.updatedAt.toISOString(),
    });
  }
  /** Content requires explicit current participation or Group Owner/Admin management. */
  require(a: ActivityAccess, manage = false) {
    if (manage ? !a.manage : !(a.active || a.manage))
      throw a.active || a.groupMember || a.participant?.state === 'INVITED'
        ? new ForbiddenException({ code: 'ACTIVITY_PERMISSION_REQUIRED' })
        : new NotFoundException();
  }
  open(act: ActivityRow, now: Date) {
    if (act.state !== 'PLANNED' || act.endsAt <= now)
      throw new ConflictException({ code: 'ACTIVITY_NOT_OPEN' });
  }
  /** Shared entry for planning/expense owners: lock, reconcile and resolve access. */
  async enter(
    tx: Tx,
    actor: RequestActor,
    id: string,
    now: Date,
    locked: string[],
    deleted = false,
  ) {
    const act = await this.rt.lock(tx, id);
    await this.rt.reconcile(tx, act, now);
    // A deleted Activity hides its content; ledgers and restore pass `deleted`.
    if (act.state === 'DELETED' && !deleted) throw new NotFoundException();
    return { act, a: await this.rt.access(tx, actor, act, locked) };
  }
  async deleteActivity(
    actor: RequestActor,
    id: string,
    revision: number,
    key: string | undefined,
  ) {
    const h = await this.rt.hint(id);
    return this.rt.run(actor, h.groupId, [], async (tx, now, locked) => {
      const { act, a } = await this.enter(tx, actor, id, now, locked, true);
      this.require(a, true);
      return this.rt.once(
        tx,
        actor,
        'social.activity.delete',
        key,
        { id, revision },
        now,
        async () => {
          socialRevision(revision, act.revision);
          if (act.state === 'DELETED')
            throw new ConflictException({ code: 'ACTIVITY_DELETED' });
          const updated = await tx.socialActivity.update({
            where: { id },
            data: {
              state: 'DELETED',
              stateBeforeDelete: act.state,
              deletedAt: now,
              recoverUntil: new Date(now.getTime() + RECOVERY_MS),
              successorParticipantId: null,
              revision: { increment: 1 },
              updatedAt: now,
            },
          });
          await this.rt.reconcile(tx, updated, now);
          await this.notifyActive(
            tx,
            updated,
            'ACTIVITY_DELETED',
            actor.userId,
          );
          await this.rt.record(
            tx,
            actor,
            { activityId: id },
            'social.activity.delete',
            id,
          );
          return { resultId: id, value: await this.view(tx, updated, a, now) };
        },
      );
    });
  }
  async restore(
    actor: RequestActor,
    id: string,
    revision: number,
    key: string | undefined,
  ) {
    const h = await this.rt.hint(id);
    return this.rt.run(actor, h.groupId, [], async (tx, now, locked) => {
      const { act, a } = await this.enter(tx, actor, id, now, locked, true);
      this.require(a, true);
      return this.rt.once(
        tx,
        actor,
        'social.activity.restore',
        key,
        { id, revision },
        now,
        async () => {
          socialRevision(revision, act.revision);
          if (act.state !== 'DELETED')
            throw new ConflictException({ code: 'ACTIVITY_NOT_DELETED' });
          if (act.contentDisposedAt || act.recoverUntil! <= now)
            throw new ConflictException({ code: 'RECOVERY_EXPIRED' });
          // Restoration revives content only; participation, removals and revocations are unchanged.
          const updated = await tx.socialActivity.update({
            where: { id },
            data: {
              state: act.stateBeforeDelete!,
              stateBeforeDelete: null,
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
            'social.activity.restore',
            id,
          );
          return { resultId: id, value: await this.view(tx, updated, a, now) };
        },
      );
    });
  }
  async nominate(
    actor: RequestActor,
    id: string,
    body: z.infer<typeof c.SocialActivitySuccessionSchema>,
    revision: number,
    key: string | undefined,
  ) {
    const h = await this.rt.hint(id);
    return this.rt.run(actor, h.groupId, [], async (tx, now, locked) => {
      const { act, a } = await this.enter(tx, actor, id, now, locked);
      this.require(a, true);
      return this.rt.once(
        tx,
        actor,
        'social.activity.succession',
        key,
        { id, body, revision },
        now,
        async () => {
          socialRevision(revision, act.revision);
          const target = (await this.rt.eligible(tx, act)).find(
            (p) => p.id === body.participantId,
          );
          // Only a current, verified, accepted participant who is not yet an organizer.
          if (!target || target.role === 'ORGANIZER')
            throw new UnprocessableEntityException({
              code: 'SUCCESSOR_INELIGIBLE',
            });
          await this.rt.context.owner(tx, target.userId!, false);
          const updated = await tx.socialActivity.update({
            where: { id },
            data: {
              successorParticipantId: target.id,
              revision: { increment: 1 },
              updatedAt: now,
            },
          });
          await this.rt.notify(tx, [target.userId], {
            activityId: id,
            kind: 'ORGANIZER_NOMINATED',
            resourceId: target.id,
            dedupe: `${target.id}:${updated.revision}`,
          });
          await this.rt.record(
            tx,
            actor,
            { activityId: id },
            'social.activity.succession.offer',
            target.id,
          );
          return { resultId: id, value: await this.view(tx, updated, a, now) };
        },
      );
    });
  }
  /** Organizer authority transfers only on the nominee's explicit acceptance. */
  async succession(
    actor: RequestActor,
    id: string,
    action: z.infer<typeof c.SocialActivitySuccessionActionSchema>,
    revision: number,
    key: string | undefined,
  ) {
    const h = await this.rt.hint(id);
    return this.rt.run(actor, h.groupId, [], async (tx, now, locked) => {
      const { act, a } = await this.enter(tx, actor, id, now, locked);
      const nominee =
        !!a.participant && a.participant.id === act.successorParticipantId;
      if (action === 'cancel') this.require(a, true);
      else if (!nominee || !a.active) throw new NotFoundException();
      return this.rt.once(
        tx,
        actor,
        'social.activity.succession.' + action,
        key,
        { id, revision },
        now,
        async () => {
          socialRevision(revision, act.revision);
          if (!act.successorParticipantId)
            throw new ConflictException({ code: 'NO_SUCCESSION_PENDING' });
          if (action === 'accept') {
            const still = (await this.rt.eligible(tx, act)).some(
              (p) => p.id === act.successorParticipantId,
            );
            if (!still)
              throw new ConflictException({ code: 'SUCCESSOR_INELIGIBLE' });
            await tx.socialActivityParticipant.update({
              where: { id: act.successorParticipantId },
              data: {
                role: 'ORGANIZER',
                revision: { increment: 1 },
                updatedAt: now,
              },
            });
          }
          const updated = await tx.socialActivity.update({
            where: { id },
            data: {
              successorParticipantId: null,
              ...(action === 'accept' ? { orphanedAt: null } : {}),
              revision: { increment: 1 },
              updatedAt: now,
            },
          });
          await this.rt.record(
            tx,
            actor,
            { activityId: id },
            'social.activity.succession.' + action,
            id,
          );
          return {
            resultId: id,
            value: await this.view(
              tx,
              updated,
              await this.rt.access(tx, actor, updated, locked),
              now,
            ),
          };
        },
      );
    });
  }
  async create(
    actor: RequestActor,
    body: z.infer<typeof c.SocialActivityCreateSchema>,
    key: string | undefined,
  ) {
    this.rt.kernel.assertEnabled();
    const keyHash = socialKey(key);
    return this.rt.run(actor, body.groupId, [], async (tx, now, locked) => {
      if (
        body.groupId &&
        !(await this.rt.can(tx, actor, body.groupId, 'task.read', locked))
      )
        throw new NotFoundException();
      return this.rt.once(
        tx,
        actor,
        'social.activity.create',
        key,
        body,
        now,
        async () => {
          if (await tx.socialActivity.findUnique({ where: { id: body.id } }))
            throw new ConflictException({ code: 'ACTIVITY_EXISTS' });
          const act = await tx.socialActivity.create({
            data: {
              id: body.id,
              groupId: body.groupId,
              template: body.template,
              title: body.title,
              description: body.description ?? null,
              location: body.location ?? null,
              timezone: body.timezone,
              startsAt: new Date(body.startsAt),
              endsAt: new Date(body.endsAt),
              capacity: body.capacity ?? null,
              createdByUserId: actor.userId,
              creationKeyHash: keyHash,
              creationFingerprint: socialHash(body),
            },
          });
          const seat = act.capacity === null || act.capacity >= 1;
          const organizer = await tx.socialActivityParticipant.create({
            data: {
              id: randomUUID(),
              activityId: act.id,
              userId: actor.userId,
              role: 'ORGANIZER',
              state: 'ACTIVE',
              rsvp: seat ? 'GOING' : 'PENDING',
              seat: seat ? 'HELD' : 'NONE',
            },
          });
          await this.rt.record(
            tx,
            actor,
            { activityId: act.id },
            'social.activity.create',
            act.id,
          );
          return {
            resultId: act.id,
            value: await this.view(
              tx,
              act,
              {
                participant: organizer,
                active: true,
                organizer: true,
                groupMember: !!body.groupId,
                groupAdmin: false,
                manage: true,
              },
              now,
            ),
          };
        },
      );
    });
  }
  async read(actor: RequestActor, id: string) {
    const h = await this.rt.hint(id);
    return this.rt.run(actor, h.groupId, [], async (tx, now, locked) => {
      const { act, a } = await this.enter(tx, actor, id, now, locked);
      this.require(a);
      return this.view(tx, act, a, now);
    });
  }
  async list(
    actor: RequestActor,
    q: z.infer<typeof c.SocialActivityListQuerySchema>,
  ) {
    this.rt.kernel.assertEnabled();
    const page: Page = { limit: q.limit, after: q.after };
    if (q.groupId) {
      const groupId = q.groupId;
      return this.rt.run(actor, groupId, [], async (tx, now, locked) => {
        if (!(await this.rt.can(tx, actor, groupId, 'task.read', locked)))
          throw new NotFoundException();
        const rows = await tx.socialActivity.findMany({
          where: { groupId },
          orderBy: { id: 'asc' },
          take: 5001,
        });
        if (rows.length > 5000) throw new PayloadTooLargeException();
        const items = await Promise.all(
          rows.map(async (r) =>
            this.summary(
              tx,
              r,
              await tx.socialActivityParticipant.findUnique({
                where: {
                  activityId_userId: { activityId: r.id, userId: actor.userId },
                },
              }),
              now,
            ),
          ),
        );
        return this.rt.context.page(
          actor,
          'social.activities.group:' + groupId,
          socialHash(items.map((i) => [i.id, i.me?.revision])),
          page,
          items,
        );
      });
    }
    return this.rt.run(actor, null, [], async (tx, now) => {
      const mine = await tx.socialActivityParticipant.findMany({
        where: { userId: actor.userId, state: { in: ['INVITED', 'ACTIVE'] } },
        orderBy: { activityId: 'asc' },
        take: 5001,
      });
      if (mine.length > 5000) throw new PayloadTooLargeException();
      const items = [];
      const groups = new Map<string, Set<string>>();
      for (const p of mine) {
        const act = await tx.socialActivity.findUniqueOrThrow({
          where: { id: p.activityId },
        });
        if (act.groupId && !p.guest && p.state === 'ACTIVE') {
          if (!groups.has(act.groupId))
            groups.set(act.groupId, await this.rt.groupUsers(tx, act.groupId));
          if (!groups.get(act.groupId)!.has(actor.userId)) continue;
        }
        items.push(await this.summary(tx, act, p, now));
      }
      return this.rt.context.page(
        actor,
        'social.activities.mine',
        socialHash(items.map((i) => [i.id, i.me?.revision])),
        page,
        items,
      );
    });
  }
  async patch(
    actor: RequestActor,
    id: string,
    body: z.infer<typeof c.SocialActivityPatchSchema>,
    revision: number,
    key: string | undefined,
  ) {
    const h = await this.rt.hint(id);
    return this.rt.run(actor, h.groupId, [], async (tx, now, locked) => {
      const { act, a } = await this.enter(tx, actor, id, now, locked);
      this.require(a, true);
      return this.rt.once(
        tx,
        actor,
        'social.activity.update',
        key,
        { id, body, revision },
        now,
        async () => {
          socialRevision(revision, act.revision);
          this.open(act, now);
          const startsAt = new Date(body.startsAt ?? act.startsAt),
            endsAt = new Date(body.endsAt ?? act.endsAt);
          if (
            endsAt <= startsAt ||
            endsAt.getTime() - startsAt.getTime() > 90 * 86400000
          )
            throw new UnprocessableEntityException({
              code: 'SCHEDULE_INVALID',
            });
          await this.assertItemsWithin(tx, id, startsAt, endsAt);
          const capacity =
            body.capacity === undefined ? act.capacity : body.capacity;
          if (capacity !== null) {
            const held = await tx.socialActivityParticipant.count({
              where: { activityId: id, seat: 'HELD' },
            });
            if (held > capacity)
              throw new ConflictException({ code: 'CAPACITY_BELOW_HELD' });
            // Reduced capacity withdraws only unaccepted offers, preserving FIFO position.
            const offers = await tx.socialActivityParticipant.findMany({
              where: { activityId: id, seat: 'OFFERED' },
              orderBy: [{ waitlistedAt: 'desc' }, { id: 'desc' }],
            });
            for (const o of offers.slice(
              0,
              Math.max(0, held + offers.length - capacity),
            ))
              await tx.socialActivityParticipant.update({
                where: { id: o.id },
                data: {
                  seat: 'WAITLISTED',
                  offerExpiresAt: null,
                  revision: { increment: 1 },
                  updatedAt: now,
                },
              });
          }
          const updated = await tx.socialActivity.update({
            where: { id },
            data: {
              ...(body.template !== undefined
                ? { template: body.template }
                : {}),
              ...(body.title !== undefined ? { title: body.title } : {}),
              ...(body.description !== undefined
                ? { description: body.description }
                : {}),
              ...(body.location !== undefined
                ? { location: body.location }
                : {}),
              ...(body.timezone !== undefined
                ? { timezone: body.timezone }
                : {}),
              startsAt,
              endsAt,
              capacity,
              revision: { increment: 1 },
              updatedAt: now,
            },
          });
          await this.rt.reconcile(tx, updated, now);
          if (
            startsAt.getTime() !== act.startsAt.getTime() ||
            endsAt.getTime() !== act.endsAt.getTime()
          )
            await this.notifyActive(
              tx,
              updated,
              'ACTIVITY_UPDATED',
              actor.userId,
            );
          await this.rt.record(
            tx,
            actor,
            { activityId: id },
            'social.activity.update',
            id,
          );
          return { resultId: id, value: await this.view(tx, updated, a, now) };
        },
      );
    });
  }
  async assertItemsWithin(tx: Tx, id: string, startsAt: Date, endsAt: Date) {
    const outside = await tx.socialActivityItem.count({
      where: {
        activityId: id,
        kind: { in: ['ITINERARY', 'AGENDA'] },
        OR: [
          { startsAt: { lt: startsAt } },
          { startsAt: { gt: endsAt } },
          { endsAt: { gt: endsAt } },
        ],
      },
    });
    if (outside)
      throw new ConflictException({ code: 'SCHEDULE_EXCLUDES_ITEMS' });
  }
  private async notifyActive(
    tx: Tx,
    act: ActivityRow,
    kind: string,
    except: string,
    states = ['ACTIVE'],
  ) {
    const rows = await tx.socialActivityParticipant.findMany({
      where: { activityId: act.id, state: { in: states } },
      select: { userId: true },
    });
    await this.rt.notify(
      tx,
      rows.map((r) => (r.userId === except ? null : r.userId)),
      {
        activityId: act.id,
        kind,
        resourceId: act.id,
        dedupe: `${act.id}:${act.revision}`,
      },
    );
  }
  async lifecycle(
    actor: RequestActor,
    id: string,
    action: z.infer<typeof c.SocialActivityLifecycleActionSchema>,
    revision: number,
    key: string | undefined,
  ) {
    const h = await this.rt.hint(id);
    return this.rt.run(actor, h.groupId, [], async (tx, now, locked) => {
      const { act, a } = await this.enter(tx, actor, id, now, locked);
      this.require(a, true);
      return this.rt.once(
        tx,
        actor,
        'social.activity.' + action,
        key,
        { id, revision },
        now,
        async () => {
          socialRevision(revision, act.revision);
          if (act.state !== 'PLANNED')
            throw new ConflictException({ code: 'ACTIVITY_NOT_OPEN' });
          const updated = await tx.socialActivity.update({
            where: { id },
            data: {
              state: action === 'cancel' ? 'CANCELED' : 'CLOSED',
              revision: { increment: 1 },
              updatedAt: now,
            },
          });
          // Queues and unaccepted offers end with the Activity; held places remain as history.
          await this.rt.reconcile(tx, updated, now);
          if (action === 'cancel') {
            await tx.socialActivityParticipant.updateMany({
              where: { activityId: id, seat: 'HELD' },
              data: {
                seat: 'NONE',
                rsvp: 'DECLINED',
                revision: { increment: 1 },
                updatedAt: now,
              },
            });
            await this.notifyActive(
              tx,
              updated,
              'ACTIVITY_CANCELED',
              actor.userId,
              ['ACTIVE', 'INVITED'],
            );
          }
          await this.rt.record(
            tx,
            actor,
            { activityId: id },
            'social.activity.' + action,
            id,
          );
          return { resultId: id, value: await this.view(tx, updated, a, now) };
        },
      );
    });
  }
  async join(actor: RequestActor, id: string, key: string | undefined) {
    const h = await this.rt.hint(id);
    if (!h.groupId) throw new NotFoundException();
    return this.rt.run(actor, h.groupId, [], async (tx, now, locked) => {
      const { act, a } = await this.enter(tx, actor, id, now, locked);
      if (!a.groupMember && a.participant?.state !== 'INVITED')
        throw new NotFoundException();
      return this.rt.once(
        tx,
        actor,
        'social.activity.join',
        key,
        { id },
        now,
        async () => {
          this.open(act, now);
          const p = a.participant;
          if (p?.state === 'REMOVED')
            throw new ForbiddenException({ code: 'INVITATION_REQUIRED' });
          if (p?.state === 'ACTIVE')
            throw new ConflictException({ code: 'ALREADY_PARTICIPATING' });
          if (!p && (await this.count(tx, id)) >= MAX_PARTICIPANTS)
            throw new PayloadTooLargeException();
          const joined = p
            ? await tx.socialActivityParticipant.update({
                where: { id: p.id },
                data: {
                  state: 'ACTIVE',
                  rsvp: 'PENDING',
                  seat: 'NONE',
                  guest: p.state === 'INVITED' ? p.guest : false,
                  generation:
                    p.state === 'INVITED' ? p.generation : p.generation + 1,
                  revision: { increment: 1 },
                  updatedAt: now,
                },
              })
            : await tx.socialActivityParticipant.create({
                data: {
                  id: randomUUID(),
                  activityId: id,
                  userId: actor.userId,
                  state: 'ACTIVE',
                },
              });
          await this.rt.record(
            tx,
            actor,
            { activityId: id },
            'social.activity.join',
            joined.id,
          );
          return {
            resultId: id,
            value: await this.view(
              tx,
              act,
              { ...a, participant: joined, active: true },
              now,
            ),
          };
        },
      );
    });
  }
  private count(tx: Tx, activityId: string) {
    return tx.socialActivityParticipant.count({ where: { activityId } });
  }
  async rsvp(
    actor: RequestActor,
    id: string,
    body: z.infer<typeof c.SocialActivityRsvpSchema>,
    key: string | undefined,
  ) {
    const h = await this.rt.hint(id);
    return this.rt.run(actor, h.groupId, [], async (tx, now, locked) => {
      const { act, a } = await this.enter(tx, actor, id, now, locked);
      const invited = ['INVITED', 'DECLINED'].includes(
        a.participant?.state ?? '',
      );
      if (!a.active && !invited) throw new NotFoundException();
      return this.rt.once(
        tx,
        actor,
        'social.activity.rsvp',
        key,
        { id, body },
        now,
        async () => {
          this.open(act, now);
          const p = await tx.socialActivityParticipant.findUniqueOrThrow({
            where: { id: a.participant!.id },
          });
          let data: Record<string, unknown>;
          if (body.rsvp === 'GOING') {
            const rows = await tx.socialActivityParticipant.findMany({
              where: { activityId: id },
            });
            const seat = requestSeat(act.capacity, rows, p);
            data =
              seat === 'HELD'
                ? {
                    rsvp: 'GOING',
                    seat: 'HELD',
                    waitlistedAt: null,
                    offerExpiresAt: null,
                  }
                : {
                    rsvp: 'PENDING',
                    seat: 'WAITLISTED',
                    waitlistedAt:
                      p.seat === 'WAITLISTED' ? p.waitlistedAt : now,
                    offerExpiresAt: null,
                  };
          } else
            data = {
              rsvp: body.rsvp,
              seat: 'NONE',
              waitlistedAt: null,
              offerExpiresAt: null,
            };
          const updated = await tx.socialActivityParticipant.update({
            where: { id: p.id },
            data: {
              ...data,
              // Explicit acceptance: declining an invitation grants no content authority.
              state:
                invited && body.rsvp === 'DECLINED' ? 'DECLINED' : 'ACTIVE',
              revision: { increment: 1 },
              updatedAt: now,
            },
          });
          await this.rt.reconcile(tx, act, now);
          await this.rt.record(
            tx,
            actor,
            { activityId: id },
            'social.activity.rsvp',
            p.id,
          );
          const access = await this.rt.access(tx, actor, act, locked);
          return {
            resultId: id,
            value: access.active
              ? await this.view(tx, act, access, now)
              : await this.view(
                  tx,
                  act,
                  { ...access, participant: updated },
                  now,
                ),
          };
        },
      );
    });
  }
  async leave(actor: RequestActor, id: string, key: string | undefined) {
    const h = await this.rt.hint(id);
    return this.rt.run(actor, h.groupId, [], async (tx, now, locked) => {
      const { act, a } = await this.enter(tx, actor, id, now, locked);
      if (!a.participant) throw new NotFoundException();
      return this.rt.once(
        tx,
        actor,
        'social.activity.leave',
        key,
        { id },
        now,
        async () => {
          const p = a.participant!;
          if (!['ACTIVE', 'INVITED'].includes(p.state))
            throw new ConflictException({ code: 'PARTICIPANT_NOT_CURRENT' });
          await this.assertNotLastOrganizer(tx, act, p);
          const left = await this.end(
            tx,
            act,
            p,
            p.state === 'INVITED' ? 'DECLINED' : 'LEFT',
            now,
          );
          await this.rt.record(
            tx,
            actor,
            { activityId: id },
            'social.activity.leave',
            p.id,
          );
          return {
            resultId: id,
            value: await this.view(
              tx,
              await tx.socialActivity.findUniqueOrThrow({ where: { id } }),
              {
                ...a,
                participant: left,
                active: false,
                organizer: false,
                manage: a.groupAdmin,
              },
              now,
            ),
          };
        },
      );
    });
  }
  private async assertNotLastOrganizer(
    tx: Tx,
    act: ActivityRow,
    p: ParticipantRow,
  ) {
    if (
      p.role !== 'ORGANIZER' ||
      p.state !== 'ACTIVE' ||
      act.state !== 'PLANNED'
    )
      return;
    const others = await tx.socialActivityParticipant.count({
      where: {
        activityId: act.id,
        role: 'ORGANIZER',
        state: 'ACTIVE',
        id: { not: p.id },
      },
    });
    if (!others) throw new ConflictException({ code: 'LAST_ORGANIZER' });
  }
  /** Ends participation: seats, consented busy data and pending authority are revoked atomically. */
  private async end(
    tx: Tx,
    act: ActivityRow,
    p: ParticipantRow,
    state: string,
    now: Date,
  ) {
    await tx.socialActivityBusy.deleteMany({ where: { participantId: p.id } });
    const lastOrganizer =
      p.role === 'ORGANIZER' &&
      p.state === 'ACTIVE' &&
      !(await tx.socialActivityParticipant.count({
        where: {
          activityId: act.id,
          role: 'ORGANIZER',
          state: 'ACTIVE',
          id: { not: p.id },
        },
      }));
    // A pending nomination ends with its nominee; an independent Activity whose
    // last organizer departs (only possible once not PLANNED) is marked orphaned.
    if (act.successorParticipantId === p.id || (lastOrganizer && !act.groupId))
      await tx.socialActivity.update({
        where: { id: act.id },
        data: {
          ...(act.successorParticipantId === p.id
            ? { successorParticipantId: null }
            : {}),
          ...(lastOrganizer && !act.groupId ? { orphanedAt: now } : {}),
          revision: { increment: 1 },
          updatedAt: now,
        },
      });
    const ended = await tx.socialActivityParticipant.update({
      where: { id: p.id },
      data: {
        state,
        role: 'PARTICIPANT',
        rsvp:
          state === 'DECLINED'
            ? 'DECLINED'
            : p.rsvp === 'GOING'
              ? 'DECLINED'
              : p.rsvp,
        seat: 'NONE',
        waitlistedAt: null,
        offerExpiresAt: null,
        reminderMinutes: null,
        revision: { increment: 1 },
        updatedAt: now,
      },
    });
    await this.rt.reconcile(tx, act, now);
    return ended;
  }
  async participants(actor: RequestActor, id: string, q: Page) {
    const h = await this.rt.hint(id);
    return this.rt.run(actor, h.groupId, [], async (tx, now, locked) => {
      const { act, a } = await this.enter(tx, actor, id, now, locked);
      this.require(a);
      const rows = await tx.socialActivityParticipant.findMany({
        where: {
          activityId: id,
          state: { in: a.manage ? ['INVITED', 'ACTIVE'] : ['ACTIVE'] },
        },
        orderBy: { id: 'asc' },
      });
      const group = act.groupId
        ? await this.rt.groupUsers(tx, act.groupId)
        : null;
      const items = await Promise.all(
        rows
          .filter(
            (r) =>
              r.state !== 'ACTIVE' ||
              !group ||
              r.guest ||
              group.has(r.userId ?? ''),
          )
          .map(async (r) => this.participantView(tx, r)),
      );
      return this.rt.context.page(
        actor,
        'social.activity.participants:' + id,
        socialHash([
          a.participant?.generation,
          a.manage,
          items.map((i) => [i.id, i.revision]),
        ]),
        q,
        items,
      );
    });
  }
  async participantView(tx: Tx, r: ParticipantRow) {
    return c.SocialActivityParticipantSchema.parse({
      id: r.id,
      userId: r.userId,
      displayName: await this.rt.displayName(tx, r.userId),
      role: r.role,
      state: r.state,
      rsvp: r.rsvp,
      seat: r.seat,
      guest: r.guest,
      waitlistedAt: iso(r.waitlistedAt),
      offerExpiresAt: iso(r.offerExpiresAt),
      revision: r.revision,
    });
  }
  async invite(
    actor: RequestActor,
    id: string,
    body: z.infer<typeof c.SocialActivityInviteSchema>,
    key: string | undefined,
  ) {
    const h = await this.rt.hint(id);
    return this.rt.run(
      actor,
      h.groupId,
      [body.userId],
      async (tx, now, locked) => {
        const { act, a } = await this.enter(tx, actor, id, now, locked);
        this.require(a, true);
        return this.rt.once(
          tx,
          actor,
          'social.activity.invite',
          key,
          { id, body },
          now,
          async () => {
            this.open(act, now);
            if (body.userId === actor.userId)
              throw new ConflictException({ code: 'ALREADY_PARTICIPATING' });
            // Existing verified, unblocked contact rules; reasons stay private.
            await this.contacts.require(tx, actor.userId, body.userId, locked);
            const prior = await tx.socialActivityParticipant.findUnique({
              where: {
                activityId_userId: { activityId: id, userId: body.userId },
              },
            });
            if (prior && ['INVITED', 'ACTIVE'].includes(prior.state))
              throw new ConflictException({ code: 'ALREADY_PARTICIPATING' });
            if (!prior && (await this.count(tx, id)) >= MAX_PARTICIPANTS)
              throw new PayloadTooLargeException();
            const guest = act.groupId
              ? !(await this.rt.groupUsers(tx, act.groupId)).has(body.userId)
              : false;
            const row = prior
              ? await tx.socialActivityParticipant.update({
                  where: { id: prior.id },
                  data: {
                    state: 'INVITED',
                    role: 'PARTICIPANT',
                    rsvp: 'PENDING',
                    seat: 'NONE',
                    guest,
                    generation: { increment: 1 },
                    revision: { increment: 1 },
                    updatedAt: now,
                  },
                })
              : await tx.socialActivityParticipant.create({
                  data: {
                    id: randomUUID(),
                    activityId: id,
                    userId: body.userId,
                    state: 'INVITED',
                    guest,
                  },
                });
            await this.rt.notify(tx, [body.userId], {
              activityId: id,
              kind: 'ACTIVITY_INVITED',
              resourceId: row.id,
              dedupe: `${row.id}:${row.generation}`,
            });
            await this.rt.record(
              tx,
              actor,
              { activityId: id },
              'social.activity.invite',
              row.id,
            );
            return {
              resultId: row.id,
              value: await this.participantView(tx, row),
            };
          },
        );
      },
    );
  }
  private async target(tx: Tx, id: string, participantId: string) {
    const row = await tx.socialActivityParticipant.findFirst({
      where: { id: participantId, activityId: id },
    });
    if (!row) throw new NotFoundException();
    return row;
  }
  async remove(
    actor: RequestActor,
    id: string,
    participantId: string,
    revision: number,
    key: string | undefined,
  ) {
    const h = await this.rt.hint(id);
    return this.rt.run(actor, h.groupId, [], async (tx, now, locked) => {
      const { act, a } = await this.enter(tx, actor, id, now, locked);
      this.require(a, true);
      return this.rt.once(
        tx,
        actor,
        'social.activity.remove',
        key,
        { id, participantId, revision },
        now,
        async () => {
          const row = await this.target(tx, id, participantId);
          socialRevision(revision, row.revision);
          if (!['INVITED', 'ACTIVE'].includes(row.state))
            throw new ConflictException({ code: 'PARTICIPANT_NOT_CURRENT' });
          await this.assertNotLastOrganizer(tx, act, row);
          const ended = await this.end(tx, act, row, 'REMOVED', now);
          await this.rt.notify(tx, [row.userId], {
            activityId: id,
            kind: 'ACTIVITY_REMOVED',
            resourceId: row.id,
            dedupe: `${row.id}:${row.generation}`,
          });
          await this.rt.record(
            tx,
            actor,
            { activityId: id },
            'social.activity.remove',
            row.id,
          );
          return {
            resultId: row.id,
            value: await this.participantView(tx, ended),
          };
        },
      );
    });
  }
  async role(
    actor: RequestActor,
    id: string,
    participantId: string,
    body: z.infer<typeof c.SocialActivityRoleSchema>,
    revision: number,
    key: string | undefined,
  ) {
    const h = await this.rt.hint(id);
    return this.rt.run(actor, h.groupId, [], async (tx, now, locked) => {
      const { act, a } = await this.enter(tx, actor, id, now, locked);
      this.require(a, true);
      return this.rt.once(
        tx,
        actor,
        'social.activity.role',
        key,
        { id, participantId, body, revision },
        now,
        async () => {
          const row = await this.target(tx, id, participantId);
          socialRevision(revision, row.revision);
          if (row.state !== 'ACTIVE')
            throw new ConflictException({ code: 'PARTICIPANT_NOT_CURRENT' });
          if (body.role === 'PARTICIPANT')
            await this.assertNotLastOrganizer(tx, act, row);
          const changed = await tx.socialActivityParticipant.update({
            where: { id: row.id },
            data: {
              role: body.role,
              revision: { increment: 1 },
              updatedAt: now,
            },
          });
          await this.rt.record(
            tx,
            actor,
            { activityId: id },
            'social.activity.role',
            row.id,
          );
          return {
            resultId: row.id,
            value: await this.participantView(tx, changed),
          };
        },
      );
    });
  }
  async conversation(
    actor: RequestActor,
    id: string,
    body: z.infer<typeof c.SocialActivityConversationSchema>,
    revision: number,
    key: string | undefined,
  ) {
    const h = await this.rt.hint(id);
    // Reuse the Phase 5 engine: only a current member may link its own private conversation.
    // The link grants nobody chat access; participants join through messaging invitations.
    if (body.conversationId)
      await this.messaging.accessMe(actor, body.conversationId);
    return this.rt.run(actor, h.groupId, [], async (tx, now, locked) => {
      const { act, a } = await this.enter(tx, actor, id, now, locked);
      this.require(a, true);
      return this.rt.once(
        tx,
        actor,
        'social.activity.conversation',
        key,
        { id, body, revision },
        now,
        async () => {
          socialRevision(revision, act.revision);
          if (act.conversationManaged)
            throw new ConflictException({ code: 'CONVERSATION_MANAGED' });
          const updated = await tx.socialActivity.update({
            where: { id },
            data: {
              conversationId: body.conversationId,
              revision: { increment: 1 },
              updatedAt: now,
            },
          });
          await this.rt.record(
            tx,
            actor,
            { activityId: id },
            'social.activity.conversation',
            id,
          );
          return { resultId: id, value: await this.view(tx, updated, a, now) };
        },
      );
    });
  }
  async reminder(
    actor: RequestActor,
    id: string,
    body: z.infer<typeof c.SocialActivityReminderSchema>,
    key: string | undefined,
  ) {
    const h = await this.rt.hint(id);
    return this.rt.run(actor, h.groupId, [], async (tx, now, locked) => {
      const { a } = await this.enter(tx, actor, id, now, locked);
      if (!a.active) throw new NotFoundException();
      return this.rt.once(
        tx,
        actor,
        'social.activity.reminder',
        key,
        { id, body },
        now,
        async () => {
          const updated = await tx.socialActivityParticipant.update({
            where: { id: a.participant!.id },
            data: {
              reminderMinutes: body.minutesBefore,
              revision: { increment: 1 },
              updatedAt: now,
            },
          });
          return { resultId: updated.id, value: participation(updated)! };
        },
      );
    });
  }
  /**
   * ADR 0062: an accepted organizer opens the Activity's Messaging-owned
   * conversation once. Messaging creates and binds it; Social stores the link.
   */
  async openConversation(
    actor: RequestActor,
    id: string,
    body: z.infer<typeof c.SocialActivityConversationOpenSchema>,
    revision: number,
    key: string | undefined,
  ) {
    const h = await this.rt.hint(id);
    socialKey(key);
    const current = await this.rt.run(
      actor,
      h.groupId,
      [],
      async (tx, now, locked) => {
        const { act, a } = await this.enter(tx, actor, id, now, locked);
        if (!a.organizer)
          throw new ForbiddenException({
            code: 'ACTIVITY_PERMISSION_REQUIRED',
          });
        if (act.conversationManaged) return act;
        socialRevision(revision, act.revision);
        return act;
      },
    );
    if (current.conversationManaged) return this.read(actor, id);
    const conversationId = await this.messaging.openSourced(
      actor,
      {
        id: body.id,
        sourceKind: 'SOCIAL_ACTIVITY',
        sourceId: id,
        title: current.title,
        retentionPolicyVersion: body.retentionPolicyVersion,
      },
      key,
    );
    return this.rt.run(actor, h.groupId, [], async (tx, now, locked) => {
      const { act, a } = await this.enter(tx, actor, id, now, locked);
      if (act.conversationManaged && act.conversationId === conversationId)
        return this.view(tx, act, a, now);
      const updated = await tx.socialActivity.update({
        where: { id },
        data: {
          conversationId,
          conversationManaged: true,
          revision: { increment: 1 },
          updatedAt: now,
        },
      });
      await this.rt.record(
        tx,
        actor,
        { activityId: id },
        'social.activity.conversation.open',
        conversationId,
      );
      return this.view(tx, updated, a, now);
    });
  }
  /** Explicit chat join by a current accepted participant; Messaging enforces history-from-join. */
  async joinConversation(
    actor: RequestActor,
    id: string,
    key: string | undefined,
  ) {
    const h = await this.rt.hint(id);
    socialKey(key);
    const conversationId = await this.rt.run(
      actor,
      h.groupId,
      [],
      async (tx, now, locked) => {
        const { act, a } = await this.enter(tx, actor, id, now, locked);
        if (!a.active) throw new NotFoundException();
        if (!act.conversationManaged || !act.conversationId)
          throw new ConflictException({ code: 'CONVERSATION_NOT_OPEN' });
        return act.conversationId;
      },
    );
    return this.messaging.admitSourced(actor, conversationId);
  }
}
