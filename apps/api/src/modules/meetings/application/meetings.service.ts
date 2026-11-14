import {
  Inject,
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type {
  Prisma,
  MeetingInvitation,
} from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { SharedCalendar } from '../../calendar/public/index.js';
import {
  MeetingKernel,
  meetingKey,
  meetingHash,
  meetingRevision,
  meetingUnavailable,
  meetingManages,
  type MeetingOperation as Op,
  type SourceOperation,
} from './meeting-kernel.js';
type Page = z.infer<typeof c.MeetingPageQuerySchema>;
@Injectable()
export class MeetingsService {
  constructor(
    @Inject(MeetingKernel) readonly op: MeetingKernel,
    @Inject(SharedCalendar) readonly calendar: SharedCalendar,
  ) {}
  event(s: Op) {
    return this.op.withAuthority(s, [], async (a) =>
      c.TeamCalendarEventSchema.parse(
        await this.calendar.run(s.tx, a, s.actor, s.scopeId, {
          kind: 'READ',
          id: s.meeting.eventId,
        }),
      ),
    );
  }
  async active(s: Op) {
    if (
      s.meeting.state !== 'ACTIVE' ||
      (await this.event(s)).status !== 'ACTIVE'
    )
      throw new ConflictException({ code: 'MEETING_CANCELED' });
  }
  async view(s: Op) {
    const member = await this.op.member(s),
      event = await this.event(s),
      current = await s.tx.meetingVersion.findFirst({
        where: { meetingId: s.meeting.id, state: 'FINAL' },
        orderBy: { number: 'desc' },
        select: { id: true },
      });
    return c.MeetingSchema.parse({
      id: s.meeting.id,
      kind: s.kind,
      sourceId: s.kind === 'INDEPENDENT' ? null : s.scopeId,
      legacyTeamMeetingId: s.meeting.legacyTeamMeetingId,
      event,
      externalUrl: s.meeting.externalUrl,
      state:
        s.meeting.state === 'CANCELED' || event.status === 'CANCELED'
          ? 'CANCELED'
          : 'ACTIVE',
      revision: s.meeting.revision,
      createdAt: s.meeting.createdAt.toISOString(),
      role: member.role,
      currentFinalVersionId: current?.id ?? null,
    });
  }
  async create(
    actor: RequestActor,
    input: z.infer<typeof c.MeetingCreateSchema>,
    key: string | undefined,
  ): Promise<z.infer<typeof c.MeetingSchema>> {
    const body = c.MeetingCreateSchema.parse(input),
      digest = meetingKey(key),
      fingerprint = meetingHash(body);
    if (body.participants.includes(actor.userId))
      throw new BadRequestException();
    const existing = await this.op.db.client.meeting.findUnique({
      where: { id: body.id },
    });
    if (existing)
      return this.op.operation(
        actor,
        body.id,
        'meeting.create.replay',
        async (s) => {
          await this.op.organizer(s);
          if (
            s.meeting.createdByActorId !== s.proof!.actorId ||
            s.meeting.creationKeyHash !== digest ||
            s.meeting.creationFingerprint !== fingerprint
          )
            throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT' });
          return this.view(s);
        },
      );
    const actorIds =
      body.kind === 'INDEPENDENT' ? [] : body.participantActorIds;
    const seed = async (s: Op) => {
      await this.op.admit(s, s.proof!, 'ORGANIZER');
      for (const userId of body.participants)
        await this.issue(
          s,
          { id: randomUUID(), userId },
          body.id + ':' + userId,
        );
      for (const actorId of actorIds)
        await this.issue(
          s,
          { id: randomUUID(), actorId },
          body.id + ':actor:' + actorId,
        );
    };
    const insert = async (s: SourceOperation, eventId: string) =>
      s.tx.meeting.create({
        data: {
          id: body.id,
          spaceId: s.spaceId,
          scopeId: s.scopeId,
          kind: body.kind,
          eventId,
          externalUrl: body.externalUrl,
          createdByActorId: s.proof!.actorId,
          creationKeyHash: digest,
          creationFingerprint: fingerprint,
          ...(body.kind === 'PROJECT'
            ? { projectId: s.scopeId }
            : body.kind === 'TEAM'
              ? { teamId: s.scopeId }
              : body.kind === 'COMPANY'
                ? { companyId: s.spaceId }
                : {}),
        },
      });
    try {
      if (body.kind === 'INDEPENDENT') {
        await this.op.shared.provision(
          actor,
          body.id,
          body.retentionPolicyVersion,
          async (tx, boundary) => {
            const now = (
                await tx.$queryRaw<
                  { now: Date }[]
                >`SELECT clock_timestamp() now`
              )[0]!.now,
              locked = [actor.userId, ...body.participants],
              proof = await this.op.authority.proof(
                tx,
                actor,
                boundary.scopeId,
                actor.userId,
                locked,
              );
            const source: SourceOperation = {
                tx,
                actor,
                ...boundary,
                kind: 'INDEPENDENT',
                now,
                locked,
                proof,
                open: true,
                begin: async () => randomUUID(),
              },
              eventId = randomUUID(),
              meeting = await insert(source, eventId),
              s: Op = { ...source, meeting };
            await this.op.withAuthority(s, ['work.manage'], async (a) => {
              const event = c.TeamCalendarEventSchema.parse(
                await this.calendar.run(tx, a, actor, s.scopeId, {
                  kind: 'CREATE',
                  key: key!,
                  input: body.event,
                }),
              );
              if (event.id !== eventId)
                s.meeting = await tx.meeting.update({
                  where: { id: meeting.id },
                  data: { eventId: event.id },
                });
            });
            await seed(s);
            await this.op.effect(
              s,
              'meeting.create',
              meeting.id,
              'meeting.resource',
            );
            s.open = false;
          },
          'MEETING',
          body.participants,
        );
        return this.get(actor, body.id);
      }
      return await this.op.source(
        actor,
        body.sourceId,
        body.kind,
        'meeting.create',
        body.id,
        async (source) => {
          await this.op.sourceManager(source);
          const replay = await source.tx.meeting.findUnique({
            where: { id: body.id },
          });
          if (replay) {
            const s: Op = { ...source, meeting: replay };
            await this.op.organizer(s);
            if (
              replay.scopeId !== source.scopeId ||
              replay.spaceId !== source.spaceId ||
              replay.createdByActorId !== source.proof!.actorId ||
              replay.creationKeyHash !== digest ||
              replay.creationFingerprint !== fingerprint
            )
              throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT' });
            return this.view(s);
          }
          const event = await this.op.withAuthority(
            source,
            ['work.manage'],
            async (a) =>
              c.TeamCalendarEventSchema.parse(
                await this.calendar.run(source.tx, a, actor, source.scopeId, {
                  kind: 'CREATE',
                  key: key!,
                  input: body.event,
                }),
              ),
          );
          await source.begin();
          const meeting = await insert(source, event.id),
            s: Op = { ...source, meeting };
          await seed(s);
          await this.op.effect(
            s,
            'meeting.create',
            meeting.id,
            'meeting.resource',
          );
          return this.view(s);
        },
        [
          ...body.participants,
          ...(await this.op.authority.spaceHints(
            await this.op.shared.custodySpace(body.sourceId),
            actorIds,
          )),
        ],
      );
    } catch (error) {
      if (
        !(error instanceof ConflictException) ||
        !(await this.op.db.client.meeting.findUnique({
          where: { id: body.id },
        }))
      )
        throw error;
      return this.create(actor, body, key);
    }
  }
  /** Trusted Team owner callback revalidates the legacy event/agenda in this same fence. */
  async extendTeam(
    actor: RequestActor,
    scopeId: string,
    legacyId: string,
    key: string | undefined,
    expectedLegacyRevision: number,
    verify: (
      tx: Prisma.TransactionClient,
    ) => Promise<{ eventId: string; agenda: string }>,
  ) {
    meetingKey(key);
    const id = legacyId,
      body = { legacyId, scopeId, expectedLegacyRevision },
      fingerprint = meetingHash(body),
      digest = meetingKey(key);
    const old = await this.op.db.client.meeting.findUnique({
      where: { legacyTeamMeetingId: legacyId },
    });
    if (old)
      return this.op.operation(
        actor,
        old.id,
        'meeting.legacy.replay',
        async (s) => {
          await this.op.organizer(s);
          if (
            s.meeting.creationKeyHash !== digest ||
            s.meeting.creationFingerprint !== fingerprint
          )
            throw new ConflictException();
          return this.view(s);
        },
      );
    return this.op.source(
      actor,
      scopeId,
      'TEAM',
      'meeting.legacy.extend',
      id,
      async (source) => {
        await this.op.sourceManager(source);
        const replay = await source.tx.meeting.findUnique({
          where: { legacyTeamMeetingId: legacyId },
        });
        if (replay) {
          const s: Op = { ...source, meeting: replay };
          await this.op.organizer(s);
          if (
            replay.scopeId !== scopeId ||
            replay.creationKeyHash !== digest ||
            replay.creationFingerprint !== fingerprint
          )
            throw new ConflictException();
          return this.view(s);
        }
        const legacy = await verify(source.tx);
        await source.begin();
        const meeting = await source.tx.meeting.create({
          data: {
            id,
            spaceId: source.spaceId,
            scopeId,
            kind: 'TEAM',
            teamId: scopeId,
            legacyTeamMeetingId: legacyId,
            eventId: legacy.eventId,
            createdByActorId: source.proof!.actorId,
            creationKeyHash: digest,
            creationFingerprint: fingerprint,
          },
        });
        const s: Op = { ...source, meeting },
          me = await this.op.admit(s, s.proof!, 'ORGANIZER');
        if (legacy.agenda.trim())
          await source.tx.meetingAgendaEntry.create({
            data: {
              id: randomUUID(),
              meetingId: id,
              memberId: me.id,
              generation: me.generation,
              text: legacy.agenda,
              state: 'ACCEPTED',
            },
          });
        await this.op.effect(
          s,
          'meeting.legacy.extend',
          id,
          'meeting.resource',
        );
        return this.view(s);
      },
    );
  }
  get(actor: RequestActor, id: string) {
    return this.op.operation(actor, id, 'meeting.read', (s) => this.view(s));
  }
  restoreAdmission(
    actor: RequestActor,
    id: string,
    expected: number | undefined,
    key: string | undefined,
  ) {
    return this.op.operation(
      actor,
      id,
      'meeting.admission.restore',
      async (s) => {
        s.proof = await this.op.proof(s);
        const p = s.proof;
        const old = await s.tx.meetingMember.findUnique({
          where: { meetingId_actorId: { meetingId: id, actorId: p.actorId } },
        });
        if (
          !old ||
          old.state !== 'ACTIVE' ||
          !['ACCEPTED', 'TENTATIVE'].includes(old.rsvp) ||
          old.sourceAccessId !== p.accessId ||
          old.sourceGeneration !== p.generation
        )
          throw new NotFoundException();
        await this.op.once(
          s,
          key,
          { action: 'restore-admission', expected },
          'meeting.admission.restore',
          async () => {
            meetingRevision(expected, old.revision);
            if (old.restoreGeneration === p.restoreGeneration)
              throw new ConflictException({
                code: 'RESTORE_ADMISSION_NOT_REQUIRED',
              });
            await this.op.admit(
              s,
              p,
              p.role === 'VIEWER'
                ? 'PARTICIPANT'
                : old.role === 'ORGANIZER'
                  ? 'ORGANIZER'
                  : 'PARTICIPANT',
              old.rsvp === 'TENTATIVE' ? 'TENTATIVE' : 'ACCEPTED',
            );
            return old.id;
          },
          undefined,
          0,
        );
        return this.memberDto(await this.op.member(s));
      },
      [],
      true,
    );
  }
  async list(actor: RequestActor, q: Page) {
    const actors = await this.op.authority.actors(actor),
      stamp = meetingHash(actors.sort()),
      context = 'meetings',
      after = this.op.after(actor, context, stamp, q.cursor);
    const rows = await this.op.db.client.meeting.findMany({
        where: {
          MeetingMember_meeting: {
            some: { actorId: { in: actors }, state: 'ACTIVE' },
          },
          ...(after ? { id: { gt: after } } : {}),
        },
        orderBy: { id: 'asc' },
        take: 201,
      }),
      items = [];
    for (const row of rows.slice(0, 200)) {
      try {
        items.push(await this.get(actor, row.id));
      } catch (error) {
        if (!meetingUnavailable(error)) throw error;
      }
      if (items.length > q.limit) break;
    }
    if (items.length > q.limit)
      return c.MeetingPageSchema.parse(
        this.op.page(actor, context, stamp, items, q.limit),
      );
    return c.MeetingPageSchema.parse({
      items,
      hasMore: rows.length > 200,
      nextCursor:
        rows.length > 200
          ? this.op.shared.opaqueCursor(
              context,
              stamp,
              actor.userId,
              rows[199]!.id,
            )
          : null,
    });
  }
  patch(
    actor: RequestActor,
    id: string,
    expected: number | undefined,
    input: z.infer<typeof c.MeetingPatchSchema>,
    key: string | undefined,
  ) {
    const body = c.MeetingPatchSchema.parse(input);
    return this.op.operation(actor, id, 'meeting.patch', async (s) => {
      await this.op.organizer(s, true);
      await this.op.once(
        s,
        key,
        { expected, body },
        'meeting.patch',
        async () => {
          meetingRevision(expected, s.meeting.revision);
          const state = body.state ?? body.event?.status;
          if (body.event || state)
            await this.op.withAuthority(s, ['work.manage'], async (a) => {
              const event = await this.event(s);
              await this.calendar.run(s.tx, a, s.actor, s.scopeId, {
                kind: 'PATCH',
                id: s.meeting.eventId,
                revision: event.revision,
                input: { ...body.event, ...(state ? { status: state } : {}) },
              });
            });
          s.meeting = await s.tx.meeting.update({
            where: { id },
            data: {
              ...(state ? { state } : {}),
              ...(body.externalUrl !== undefined
                ? { externalUrl: body.externalUrl }
                : {}),
              revision: { increment: 1 },
            },
          });
          return id;
        },
      );
      return this.view(s);
    });
  }
  private async issuer(s: Op, row: MeetingInvitation) {
    if (
      row.restoreGeneration !==
      (await this.op.authority.scope(s.tx, s.scopeId)).restoreGeneration
    )
      throw new NotFoundException();
    const issuer = await this.op.other(
      s,
      row.inviterMemberId,
      row.inviterMemberGeneration,
    );
    if (
      issuer.proof.accessId !== row.inviterAccessId ||
      issuer.proof.generation !== row.inviterGeneration ||
      issuer.member.role !== 'ORGANIZER' ||
      !meetingManages(s.kind, issuer.proof.role)
    )
      throw new NotFoundException();
    await this.op.proof(s, issuer.userId, 'work.manage');
    return {
      ...s,
      actor: { ...s.actor, userId: issuer.userId },
      proof: issuer.proof,
    };
  }
  private async invitationView(s: Op, row: MeetingInvitation) {
    const issuer = await this.issuer(s, row),
      event = await this.event(issuer);
    return c.MeetingInvitationSchema.parse({
      id: row.id,
      meetingId: s.meeting.id,
      title: event.title,
      schedule: event.schedule,
      state: row.state,
      revision: row.revision,
      expiresAt: row.expiresAt.toISOString(),
    });
  }
  private async issue(
    s: Op,
    input: z.infer<typeof c.MeetingInviteInputSchema>,
    key: string,
  ) {
    const me = await this.op.organizer(s);
    await this.active(s);
    const userId =
      'userId' in input
        ? input.userId
        : await this.op.authority.user(s.tx, s.spaceId, input.actorId);
    if (!s.locked.includes(userId) || userId === s.actor.userId)
      throw new BadRequestException();
    const recipient = await this.op.authority.actor(s.tx, s.spaceId, userId),
      proof = s.kind === 'INDEPENDENT' ? null : await this.op.proof(s, userId);
    const member = await s.tx.meetingMember.findUnique({
      where: {
        meetingId_actorId: { meetingId: s.meeting.id, actorId: recipient.id },
      },
    });
    if (member?.state === 'ACTIVE' && (await this.op.eligible(s, member.id)))
      throw new ConflictException({ code: 'ALREADY_PARTICIPATING' });
    if (
      (await s.tx.meetingInvitation.count({
        where: {
          meetingId: s.meeting.id,
          state: 'PENDING',
          expiresAt: { gt: s.now },
        },
      })) >= 200
    )
      throw new PayloadTooLargeException();
    const digest = meetingKey(key),
      fingerprint = meetingHash(input),
      old = await s.tx.meetingInvitation.findUnique({
        where: {
          meetingId_inviterMemberId_keyHash: {
            meetingId: s.meeting.id,
            inviterMemberId: me.id,
            keyHash: digest,
          },
        },
      });
    if (old) {
      if (old.fingerprint !== fingerprint) throw new ConflictException();
      return old;
    }
    await s.tx.meetingInvitation.updateMany({
      where: {
        meetingId: s.meeting.id,
        recipientActorId: recipient.id,
        state: 'PENDING',
      },
      data: { state: 'REVOKED', revision: { increment: 1 } },
    });
    return s.tx.meetingInvitation.create({
      data: {
        id: input.id,
        meetingId: s.meeting.id,
        spaceId: s.spaceId,
        scopeId: s.scopeId,
        recipientActorId: recipient.id,
        inviterMemberId: me.id,
        inviterMemberGeneration: me.generation,
        inviterAccessId: s.proof!.accessId,
        inviterGeneration: s.proof!.generation,
        recipientAccessId: proof?.accessId ?? null,
        recipientGeneration: proof?.generation ?? null,
        restoreGeneration: s.proof!.restoreGeneration,
        keyHash: digest,
        fingerprint,
        expiresAt: new Date(s.now.getTime() + 7 * 86400000),
      },
    });
  }
  async invite(
    actor: RequestActor,
    id: string,
    expected: number | undefined,
    input: z.infer<typeof c.MeetingInviteInputSchema>,
    key: string | undefined,
  ) {
    const body = c.MeetingInviteInputSchema.parse(input),
      hint =
        'userId' in body
          ? null
          : await this.op.db.client.meeting.findUnique({ where: { id } });
    return this.op.operation(
      actor,
      id,
      'meeting.invite',
      async (s) => {
        await this.op.organizer(s);
        const resource = await this.op.once(
          s,
          key,
          { expected, body },
          'meeting.invite',
          async () => {
            meetingRevision(expected, s.meeting.revision);
            const invite = await this.issue(s, body, key!);
            s.meeting = await s.tx.meeting.update({
              where: { id },
              data: { revision: { increment: 1 } },
            });
            return invite.id;
          },
          'meeting.invitation',
        );
        return this.invitationView(
          s,
          await s.tx.meetingInvitation.findUniqueOrThrow({
            where: { id: resource },
          }),
        );
      },
      'userId' in body
        ? [body.userId]
        : hint
          ? await this.op.authority.spaceHints(hint.spaceId, [body.actorId])
          : [],
    );
  }
  async invitations(actor: RequestActor, q: Page) {
    const actors = await this.op.authority.actors(actor),
      stamp = meetingHash(actors.sort()),
      context = 'meeting-invitations',
      after = this.op.after(actor, context, stamp, q.cursor);
    const rows = await this.op.db.client.meetingInvitation.findMany({
        where: {
          recipientActorId: { in: actors },
          OR: [
            { state: 'PENDING', expiresAt: { gt: new Date() } },
            { state: { in: ['ACCEPTED', 'TENTATIVE'] } },
          ],
          ...(after ? { id: { gt: after } } : {}),
        },
        orderBy: { id: 'asc' },
        take: q.limit + 1,
      }),
      items = [];
    for (const row of rows.slice(0, q.limit)) {
      try {
        items.push(
          await this.op.operation(
            actor,
            row.meetingId,
            'meeting.invitation.read',
            async (s) => {
              const current = await s.tx.meetingInvitation.findUniqueOrThrow({
                where: { id: row.id },
              });
              if (
                !['PENDING', 'ACCEPTED', 'TENTATIVE'].includes(current.state) ||
                (current.state === 'PENDING' && current.expiresAt <= s.now)
              )
                throw new NotFoundException();
              if (
                (await this.op.authority.user(
                  s.tx,
                  s.spaceId,
                  current.recipientActorId,
                )) !== actor.userId
              )
                throw new NotFoundException();
              if (
                current.recipientAccessId &&
                (s.proof?.accessId !== current.recipientAccessId ||
                  s.proof.generation !== current.recipientGeneration)
              )
                throw new NotFoundException();
              if (current.state !== 'PENDING') {
                s.proof ??= await this.op.proof(s);
                const member = await this.op.member(s);
                if (
                  member.id !== current.acceptedMemberId ||
                  member.generation !== current.acceptedMemberGeneration
                )
                  throw new NotFoundException();
              }
              return this.invitationView(s, current);
            },
            [actor.userId],
            true,
          ),
        );
      } catch (error) {
        if (!meetingUnavailable(error)) throw error;
      }
    }
    return c.MeetingInvitationPageSchema.parse({
      items,
      hasMore: rows.length > q.limit,
      nextCursor:
        rows.length > q.limit
          ? this.op.shared.opaqueCursor(
              context,
              stamp,
              actor.userId,
              rows[q.limit - 1]!.id,
            )
          : null,
    });
  }
  revokeInvitation(
    actor: RequestActor,
    id: string,
    invitationId: string,
    expected: number | undefined,
    key: string | undefined,
  ) {
    return this.op.operation(
      actor,
      id,
      'meeting.invitation.revoke',
      async (s) => {
        await this.op.organizer(s, true);
        await this.op.once(
          s,
          key,
          { invitationId, expected },
          'meeting.invitation.revoke',
          async () => {
            const row = await s.tx.meetingInvitation.findFirst({
              where: { id: invitationId, meetingId: id },
            });
            if (!row) throw new NotFoundException();
            meetingRevision(expected, row.revision);
            if (row.acceptedMemberId && row.acceptedMemberGeneration) {
              const target = await this.op.eligible(
                s,
                row.acceptedMemberId,
                row.acceptedMemberGeneration,
              );
              if (target) await this.op.end(s, target.member, 'REVOKED');
            }
            await s.tx.meetingInvitation.update({
              where: { id: invitationId },
              data: { state: 'REVOKED', revision: { increment: 1 } },
            });
            return invitationId;
          },
        );
        return { revoked: true };
      },
    );
  }
  async rsvp(
    actor: RequestActor,
    invitationId: string,
    expected: number | undefined,
    decision: 'ACCEPTED' | 'TENTATIVE' | 'DECLINED',
    key: string | undefined,
  ) {
    const hint = await this.op.db.client.meetingInvitation.findUnique({
      where: { id: invitationId },
    });
    if (!hint) throw new NotFoundException();
    return this.op.operation(
      actor,
      hint.meetingId,
      'meeting.rsvp',
      async (s) => {
        let row = await s.tx.meetingInvitation.findUniqueOrThrow({
          where: { id: invitationId },
        });
        if (
          (await this.op.authority.user(
            s.tx,
            s.spaceId,
            row.recipientActorId,
          )) !== actor.userId
        )
          throw new NotFoundException();
        await this.issuer(s, row);
        if (
          row.state === 'REVOKED' ||
          (row.state === 'PENDING' && row.expiresAt <= s.now)
        )
          throw new ConflictException({ code: 'INVITATION_UNAVAILABLE' });
        if (s.kind === 'INDEPENDENT') {
          if (decision !== 'DECLINED')
            await this.op.authority.independentSeat(
              s.tx,
              s.spaceId,
              actor.userId,
              s.now,
              'MEETING',
            );
          s.proof = await this.op.proof(s).catch((error) => {
            if (decision === 'DECLINED' && meetingUnavailable(error))
              return null;
            throw error;
          });
        }
        if (
          s.kind !== 'INDEPENDENT' &&
          (s.proof?.accessId !== row.recipientAccessId ||
            s.proof!.generation !== row.recipientGeneration)
        )
          throw new NotFoundException();
        // A pending independent invitee may decline without receiving a context seat.
        if (!s.proof) {
          const digest = meetingKey(key),
            fingerprint = meetingHash({ decision });
          if (row.decisionKeyHash === digest) {
            if (row.decisionFingerprint !== fingerprint)
              throw new ConflictException();
            return this.invitationView(s, row);
          }
          meetingRevision(expected, row.revision);
          if (row.state !== 'PENDING') throw new ConflictException();
          row = await s.tx.meetingInvitation.update({
            where: { id: row.id },
            data: {
              state: 'DECLINED',
              decisionKeyHash: digest,
              decisionFingerprint: fingerprint,
              revision: { increment: 1 },
            },
          });
          return this.invitationView(s, row);
        }
        const participating = await this.op.member(s).catch((error) => {
          if (meetingUnavailable(error)) return null;
          throw error;
        });
        await this.op.once(
          s,
          key,
          { invitationId, expected, decision },
          'meeting.rsvp',
          async () => {
            meetingRevision(expected, row.revision);
            await this.active({
              ...s,
              proof: (await this.issuer(s, row)).proof,
              actor: (await this.issuer(s, row)).actor,
            });
            let member = await this.op.member(s).catch((error) => {
              if (meetingUnavailable(error)) return null;
              throw error;
            });
            if (
              row.acceptedMemberId &&
              (!member ||
                row.acceptedMemberId !== member.id ||
                row.acceptedMemberGeneration !== member.generation)
            )
              throw new ConflictException({ code: 'ADMISSION_CHANGED' });
            if (decision === 'DECLINED') {
              if (member) await this.op.end(s, member, 'LEFT');
            } else if (!member) {
              if (row.state !== 'PENDING') throw new ConflictException();
              member = await this.op.admit(
                s,
                s.proof!,
                'PARTICIPANT',
                decision,
              );
            } else
              await s.tx.meetingMember.update({
                where: { id: member.id },
                data: { rsvp: decision, revision: { increment: 1 } },
              });
            await s.tx.meetingInvitation.update({
              where: { id: row.id },
              data: {
                state: decision,
                ...(member
                  ? {
                      acceptedMemberId: member.id,
                      acceptedMemberGeneration: member.generation,
                    }
                  : {}),
                revision: { increment: 1 },
              },
            });
            return row.id;
          },
          decision === 'DECLINED' || participating
            ? undefined
            : 'meeting.participant',
          0,
        );
        row = await s.tx.meetingInvitation.findUniqueOrThrow({
          where: { id: row.id },
        });
        return this.invitationView(s, row);
      },
      [actor.userId],
      true,
    );
  }
  members(actor: RequestActor, id: string, q: Page) {
    return this.op.operation(actor, id, 'meeting.members', async (s) => {
      const stamp = await this.op.stamp(s),
        context = 'meeting-members:' + id,
        after = this.op.after(actor, context, stamp, q.cursor),
        rows = await s.tx.meetingMember.findMany({
          where: {
            meetingId: id,
            state: 'ACTIVE',
            ...(after ? { id: { gt: after } } : {}),
          },
          orderBy: { id: 'asc' },
          take: 201,
        }),
        items = [];
      for (const row of rows) {
        if (await this.op.eligible(s, row.id))
          items.push({
            ...this.memberDto(row),
            displayName: await this.op.authority.displayName(
              s.tx,
              s.spaceId,
              row.actorId,
            ),
          });
        if (items.length > q.limit) break;
      }
      return c.MeetingMemberPageSchema.parse(
        this.op.page(actor, context, stamp, items, q.limit),
      );
    });
  }
  accessMe(actor: RequestActor, id: string) {
    return this.op.operation(actor, id, 'meeting.access.read', async (s) => {
      const member = await this.op.member(s);
      const { id: memberId, ...view } = this.memberDto(member);
      const capabilities: z.infer<
        typeof c.MeetingAccessMeSchema
      >['capabilities'] = ['meeting.read', 'membership.leave'];
      if (s.meeting.state === 'ACTIVE' && s.proof?.role !== 'VIEWER')
        capabilities.push('agenda.propose', 'minutes.draft');
      if (s.meeting.state === 'ACTIVE' && (await this.op.canOrganize(s)))
        capabilities.push('meeting.manage');
      return c.MeetingAccessMeSchema.parse({
        ...view,
        meetingId: id,
        memberId,
        capabilities,
        displayName: await this.op.authority.displayName(
          s.tx,
          s.spaceId,
          member.actorId,
        ),
      });
    });
  }
  memberRole(
    actor: RequestActor,
    id: string,
    memberId: string,
    role: 'ORGANIZER' | 'PARTICIPANT',
    expected: number | undefined,
    key: string | undefined,
  ) {
    return this.op.operation(actor, id, 'meeting.member.role', async (s) => {
      await this.op.organizer(s);
      const target = await this.op.other(s, memberId);
      await this.op.once(
        s,
        key,
        { memberId, role, expected },
        'meeting.member.role',
        async () => {
          meetingRevision(expected, target.member.revision);
          if (
            role === 'ORGANIZER' &&
            (target.proof.role === 'VIEWER' ||
              !meetingManages(
                s.kind === 'INDEPENDENT' ? 'MEETING' : s.kind,
                s.kind === 'INDEPENDENT' ? 'ADMIN' : target.proof.role,
              ))
          )
            throw new ForbiddenException();
          if (s.kind === 'INDEPENDENT')
            await this.op.authority.meetingOrganizerSeat(
              s.tx,
              s.scopeId,
              target.member.actorId,
              role === 'ORGANIZER',
            );
          await s.tx.meetingMember.update({
            where: { id: memberId },
            data: { role, revision: { increment: 1 } },
          });
          await s.tx.meeting.update({
            where: { id },
            data: { revision: { increment: 1 } },
          });
          return memberId;
        },
      );
      return this.memberDto(
        await s.tx.meetingMember.findUniqueOrThrow({ where: { id: memberId } }),
      );
    });
  }
  remove(
    actor: RequestActor,
    id: string,
    memberId: string,
    expected: number | undefined,
    key: string | undefined,
  ) {
    return this.op.operation(actor, id, 'meeting.member.remove', async (s) => {
      await this.op.organizer(s, true);
      const target = await this.op.other(s, memberId);
      await this.op.once(
        s,
        key,
        { memberId, expected },
        'meeting.member.remove',
        async () => {
          meetingRevision(expected, target.member.revision);
          await this.op.end(s, target.member, 'REVOKED');
          return memberId;
        },
      );
      return { removed: true };
    });
  }
  leave(
    actor: RequestActor,
    id: string,
    expected: number | undefined,
    key: string | undefined,
  ) {
    return this.op.operation(actor, id, 'meeting.leave', async (s) => {
      const me = await this.op.member(s);
      await this.op.once(s, key, { expected }, 'meeting.leave', async () => {
        meetingRevision(expected, me.revision);
        await this.op.end(s, me, 'LEFT');
        return me.id;
      });
      return { left: true };
    });
  }
  agenda(actor: RequestActor, id: string, q: Page) {
    return this.op.operation(actor, id, 'meeting.agenda.read', async (s) => {
      const stamp = await this.op.stamp(s),
        context = 'meeting-agenda:' + id,
        after = this.op.after(actor, context, stamp, q.cursor),
        rows = await s.tx.meetingAgendaEntry.findMany({
          where: { meetingId: id, ...(after ? { id: { gt: after } } : {}) },
          orderBy: { id: 'asc' },
          take: q.limit + 1,
        });
      return c.MeetingAgendaPageSchema.parse(
        this.op.page(
          actor,
          context,
          stamp,
          rows.map((v) => this.agendaDto(v)),
          q.limit,
        ),
      );
    });
  }
  propose(
    actor: RequestActor,
    id: string,
    input: z.infer<typeof c.MeetingAgendaCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.MeetingAgendaCreateSchema.parse(input);
    return this.op.operation(actor, id, 'meeting.agenda.propose', async (s) => {
      const me = await this.op.writer(s);
      await this.active(s);
      const resource = await this.op.once(
        s,
        key,
        body,
        'meeting.agenda.propose',
        async () => {
          if (
            (await s.tx.meetingAgendaEntry.count({
              where: { meetingId: id },
            })) >= 1000
          )
            throw new PayloadTooLargeException();
          await s.tx.meetingAgendaEntry.create({
            data: {
              ...body,
              meetingId: id,
              memberId: me.id,
              generation: me.generation,
            },
          });
          return body.id;
        },
        'meeting.agenda-entry',
      );
      const row = await s.tx.meetingAgendaEntry.findUniqueOrThrow({
        where: { id: resource },
      });
      return this.agendaDto(row);
    });
  }
  selectAgenda(
    actor: RequestActor,
    id: string,
    entryId: string,
    state: 'ACCEPTED' | 'REJECTED',
    expected: number | undefined,
    key: string | undefined,
  ) {
    return this.op.operation(actor, id, 'meeting.agenda.select', async (s) => {
      await this.op.organizer(s);
      await this.active(s);
      await this.op.once(
        s,
        key,
        { entryId, state, expected },
        'meeting.agenda.select',
        async () => {
          const entry = await s.tx.meetingAgendaEntry.findFirst({
            where: { id: entryId, meetingId: id },
          });
          if (!entry) throw new NotFoundException();
          meetingRevision(expected, entry.revision);
          await s.tx.meetingAgendaEntry.update({
            where: { id: entryId },
            data: { state, revision: { increment: 1 } },
          });
          return entryId;
        },
      );
      const row = await s.tx.meetingAgendaEntry.findUniqueOrThrow({
        where: { id: entryId },
      });
      return this.agendaDto(row);
    });
  }
  private agendaDto(row: {
    id: string;
    meetingId: string;
    memberId: string;
    text: string;
    state: string;
    revision: number;
    createdAt: Date;
  }) {
    return c.MeetingAgendaSchema.parse({
      id: row.id,
      meetingId: row.meetingId,
      memberId: row.memberId,
      text: row.text,
      state: row.state,
      revision: row.revision,
      createdAt: row.createdAt.toISOString(),
    });
  }
  private memberDto(row: {
    id: string;
    actorId: string;
    role: string;
    state: string;
    rsvp: string;
    generation: number;
    revision: number;
  }) {
    return c.MeetingMemberSchema.parse({
      id: row.id,
      actorId: row.actorId,
      role: row.role,
      state: row.state,
      rsvp: row.rsvp,
      generation: row.generation,
      revision: row.revision,
    });
  }
  /** OD-12: organizer chooses whether non-invited source members see busy-only blocks (default hidden). */
  setBusyVisibility(
    actor: RequestActor,
    id: string,
    revision: number,
    input: z.infer<typeof c.MeetingBusyVisibilityInputSchema>,
  ) {
    const body = c.MeetingBusyVisibilityInputSchema.parse(input);
    return this.op.operation(actor, id, 'meeting.busy.update', async (s) => {
      await this.op.organizer(s);
      if (s.kind === 'INDEPENDENT')
        throw new ConflictException({ code: 'MEETING_HAS_NO_SOURCE' });
      const before = await s.tx.meetingBusySetting.findUnique({
        where: { meetingId: id },
      });
      if ((before?.revision ?? 1) !== revision)
        throw new ConflictException({ code: 'REVISION_CONFLICT' });
      const row = before
        ? await s.tx.meetingBusySetting.update({
            where: { meetingId: id },
            data: {
              visibility: body.visibility,
              updatedAt: s.now,
              revision: { increment: 1 },
            },
          })
        : await s.tx.meetingBusySetting.create({
            data: { meetingId: id, visibility: body.visibility },
          });
      return c.MeetingBusyVisibilitySchema.parse({
        meetingId: id,
        visibility: row.visibility,
        revision: row.revision,
      });
    });
  }
  /**
   * OD-12: busy-only blocks of a source workspace for a member who is not in
   * the meeting. Only schedule and recurrence are served, never the title,
   * description, attendees, agenda or meeting id.
   */
  busy(actor: RequestActor, query: z.infer<typeof c.MeetingBusyQuerySchema>) {
    const q = c.MeetingBusyQuerySchema.parse(query);
    return this.op.source(
      actor,
      q.sourceId,
      q.sourceKind,
      'meeting.busy.read',
      q.sourceId,
      (s) =>
        this.op.withAuthority(s, [], async (a) => {
          const p = s.proof!;
          const rows = await s.tx.meeting.findMany({
            where: {
              scopeId: q.sourceId,
              state: 'ACTIVE',
              legacyTeamMeetingId: null,
              MeetingMember_meeting: {
                none: { actorId: p.actorId, state: 'ACTIVE' },
              },
            },
            orderBy: { id: 'asc' },
            take: 501,
          });
          if (rows.length > 500) throw new PayloadTooLargeException();
          const shared = new Set(
            (
              await s.tx.meetingBusySetting.findMany({
                where: {
                  meetingId: { in: rows.map((r) => r.id) },
                  visibility: 'SOURCE',
                },
              })
            ).map((r) => r.meetingId),
          );
          const items = [];
          for (const row of rows) {
            if (!shared.has(row.id)) continue;
            const event = c.TeamCalendarEventSchema.parse(
              await this.calendar.run(s.tx, a, s.actor, q.sourceId, {
                kind: 'READ',
                id: row.eventId,
              }),
            );
            if (event.status !== 'ACTIVE') continue;
            items.push({
              schedule: event.schedule,
              recurrence: event.recurrence,
            });
          }
          return c.MeetingBusyListSchema.parse({ items });
        }),
    );
  }
}
