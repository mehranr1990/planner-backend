import {
  Inject,
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type {
  Prisma,
  Meeting,
  MeetingMember,
} from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import {
  SharedKernel,
  SharedAuthority,
  CollaborationService,
  MessagingAuthority,
  SpacesService,
} from '../../spaces/public/index.js';
import type {
  SharedRequest,
  SharedFeatureKey,
} from '../../spaces/public/index.js';
import { meetingManages } from '../domain/meeting-policy.js';
export { meetingManages } from '../domain/meeting-policy.js';
export type MeetingProof = Awaited<ReturnType<MessagingAuthority['proof']>>;
export type SourceOperation = {
  tx: Prisma.TransactionClient;
  actor: RequestActor;
  spaceId: string;
  scopeId: string;
  kind: string;
  now: Date;
  locked: string[];
  begin: () => Promise<string>;
  proof: MeetingProof | null;
  open: boolean;
};
export type MeetingOperation = SourceOperation & { meeting: Meeting };
export const meetingHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function meetingKey(value: string | undefined) {
  if (!value || !/^[\x21-\x7e]{1,128}$/.test(value))
    throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
  return meetingHash(value);
}
export function meetingRevision(expected: number | undefined, actual: number) {
  if (expected === undefined)
    throw new BadRequestException({ code: 'IF_MATCH_REQUIRED' });
  if (expected !== actual)
    throw new ConflictException({ code: 'REVISION_CONFLICT' });
}
export const meetingUnavailable = (error: unknown) =>
  error instanceof NotFoundException || error instanceof ForbiddenException;
@Injectable()
export class MeetingKernel {
  constructor(
    @Inject(DatabaseService) readonly db: DatabaseService,
    @Inject(SharedKernel) readonly shared: SharedKernel,
    @Inject(CollaborationService) readonly collaboration: CollaborationService,
    @Inject(MessagingAuthority) readonly authority: MessagingAuthority,
    @Inject(SpacesService) readonly spaces: SpacesService,
  ) {}
  async disposalBlocker(tx: Prisma.TransactionClient, spaceId: string) {
    return (await tx.meeting.count({ where: { spaceId } })) ||
      (await tx.announcement.count({ where: { spaceId } }))
      ? 'MEETING_RETENTION_PENDING'
      : null;
  }
  async personalTaskReferences(
    tx: Prisma.TransactionClient,
    source: AuthorizedSpace,
    taskId: string,
  ) {
    await source.fence(tx);
    return tx.meetingTaskLink.count({
      where: { taskSpaceId: source.spaceId, taskId },
    });
  }
  /** Called by the Team owner inside its existing current-user/source fence. */
  async calendarPrivacy(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    scopeId: string,
    eventId?: string,
    write = false,
  ) {
    const p = a.require(tx, scopeId, write ? 'work.manage' : 'task.read'),
      source = await this.authority.scope(tx, scopeId);
    const rows = await tx.meeting.findMany({
      where: {
        scopeId,
        legacyTeamMeetingId: null,
        ...(eventId ? { eventId } : {}),
        NOT: {
          MeetingMember_meeting: {
            some: {
              actorId: p.actorId,
              state: 'ACTIVE',
              rsvp: { in: ['ACCEPTED', 'TENTATIVE'] },
              sourceAccessId: p.accessId,
              sourceGeneration: p.generation,
              restoreGeneration: source.restoreGeneration,
              ...(write
                ? {
                    role: 'ORGANIZER',
                    ...(!meetingManages(source.kind, p.role)
                      ? { id: { in: [] } }
                      : {}),
                  }
                : {}),
            },
          },
        },
      },
      select: { eventId: true },
    });
    if (eventId && rows.length) throw new NotFoundException();
    return rows.map((v) => v.eventId);
  }
  async source<T>(
    actor: RequestActor,
    scopeId: string,
    kind: string,
    action: string,
    target: string,
    work: (s: SourceOperation) => Promise<T>,
    users: string[] = [],
  ) {
    this.shared.assertEnabled();
    const spaceId = await this.shared.custodySpace(scopeId);
    return this.collaboration.signed(
      actor,
      scopeId,
      users,
      action,
      target,
      async (tx, now, locked, begin) => {
        const current = await this.authority.scope(tx, scopeId);
        if (
          current.spaceId !== spaceId ||
          current.kind !== kind ||
          (kind === 'COMPANY' && scopeId !== spaceId)
        )
          throw new NotFoundException();
        const proof = await this.authority.proof(
          tx,
          actor,
          scopeId,
          actor.userId,
          locked,
        );
        const s: SourceOperation = {
          tx,
          actor,
          spaceId,
          scopeId,
          kind,
          now,
          locked,
          begin,
          proof,
          open: true,
        };
        try {
          return await work(s);
        } finally {
          s.open = false;
        }
      },
    );
  }
  async operation<T>(
    actor: RequestActor,
    id: string,
    action: string,
    work: (s: MeetingOperation) => Promise<T>,
    extraUsers: string[] = [],
    pending = false,
  ) {
    this.shared.assertEnabled();
    const hint = await this.db.client.meeting.findUnique({ where: { id } });
    if (!hint) throw new NotFoundException();
    const members = await this.db.client.meetingMember.findMany({
      where: { meetingId: id, state: 'ACTIVE' },
      select: { actorId: true },
      take: 201,
    });
    if (members.length > 200) throw new PayloadTooLargeException();
    const users = [
      ...new Set([
        ...(await this.authority.hints(members.map((v) => v.actorId))),
        ...extraUsers,
      ]),
    ];
    return this.collaboration.signed(
      actor,
      hint.scopeId,
      users,
      action,
      id,
      async (tx, now, locked, begin) => {
        const meeting = await tx.meeting.findUnique({ where: { id } });
        if (
          !meeting ||
          meeting.spaceId !== hint.spaceId ||
          meeting.scopeId !== hint.scopeId
        )
          throw new NotFoundException();
        const source = await this.authority.scope(tx, meeting.scopeId);
        if (
          source.spaceId !== meeting.spaceId ||
          source.kind !==
            (meeting.kind === 'INDEPENDENT' ? 'MEETING' : meeting.kind)
        )
          throw new NotFoundException();
        const s: MeetingOperation = {
          tx,
          actor,
          spaceId: meeting.spaceId,
          scopeId: meeting.scopeId,
          kind: meeting.kind,
          meeting,
          now,
          locked,
          begin,
          proof: null,
          open: true,
        };
        try {
          if (!pending || meeting.kind !== 'INDEPENDENT')
            s.proof = await this.authority.proof(
              tx,
              actor,
              meeting.scopeId,
              actor.userId,
              locked,
            );
          if (!pending) await this.member(s);
          return await work(s);
        } finally {
          s.open = false;
        }
      },
    );
  }
  async proof(
    s: SourceOperation,
    userId = s.actor.userId,
    capability: SharedRequest['capability'] = 'task.read',
  ) {
    return this.authority.proof(
      s.tx,
      s.actor,
      s.scopeId,
      userId,
      s.locked,
      capability,
    );
  }
  async member(s: MeetingOperation, proof = s.proof) {
    if (!proof) throw new NotFoundException();
    const m = await s.tx.meetingMember.findUnique({
      where: {
        meetingId_actorId: { meetingId: s.meeting.id, actorId: proof.actorId },
      },
    });
    if (
      !m ||
      m.state !== 'ACTIVE' ||
      m.sourceAccessId !== proof.accessId ||
      m.sourceGeneration !== proof.generation ||
      m.restoreGeneration !== proof.restoreGeneration ||
      !['ACCEPTED', 'TENTATIVE'].includes(m.rsvp)
    )
      throw new NotFoundException();
    return m;
  }
  async other(s: MeetingOperation, memberId: string, generation?: number) {
    const row = await s.tx.meetingMember.findFirst({
      where: { id: memberId, meetingId: s.meeting.id },
    });
    if (!row || (generation !== undefined && row.generation !== generation))
      throw new NotFoundException();
    const userId = await this.authority.user(s.tx, s.spaceId, row.actorId),
      proof = await this.proof(s, userId),
      member = await this.member(s, proof);
    return { member, proof, userId };
  }
  async eligible(s: MeetingOperation, memberId: string, generation?: number) {
    try {
      return await this.other(s, memberId, generation);
    } catch (error) {
      if (meetingUnavailable(error)) return null;
      throw error;
    }
  }
  async writer(s: MeetingOperation) {
    const m = await this.member(s);
    if (s.meeting.state !== 'ACTIVE')
      throw new ConflictException({ code: 'MEETING_CANCELED' });
    if (s.proof?.role === 'VIEWER') throw new ForbiddenException();
    return m;
  }
  async organizer(s: MeetingOperation, allowCanceled = false) {
    const m = allowCanceled ? await this.member(s) : await this.writer(s);
    if (
      s.proof?.role === 'VIEWER' ||
      m.role !== 'ORGANIZER' ||
      !meetingManages(s.kind, s.proof!.role)
    )
      throw new ForbiddenException();
    await this.proof(s, s.actor.userId, 'work.manage');
    return m;
  }
  async canOrganize(s: MeetingOperation) {
    try {
      await this.organizer(s, true);
      return true;
    } catch (error) {
      if (meetingUnavailable(error) || error instanceof ConflictException)
        return false;
      throw error;
    }
  }
  async sourceManager(s: SourceOperation) {
    if (!s.proof || !meetingManages(s.kind, s.proof.role))
      throw new ForbiddenException();
    await this.proof(s, s.actor.userId, 'work.manage');
  }
  async withAuthority<T>(
    s: SourceOperation,
    caps: SharedRequest['capability'][],
    work: (authority: SharedAuthority) => Promise<T>,
  ) {
    const proofs = [];
    for (const cap of new Set(['task.read' as const, ...caps]))
      proofs.push(await this.proof(s, s.actor.userId, cap));
    const authority = new SharedAuthority(s.tx, proofs, s.scopeId);
    try {
      return await work(authority);
    } finally {
      authority.close();
    }
  }
  async effect(
    s: SourceOperation,
    action: string,
    resourceId: string,
    feature?: SharedFeatureKey,
  ) {
    if (!s.proof) throw new NotFoundException();
    if (feature) await this.shared.featureGrowth(s.tx, s.scopeId, feature);
    await this.shared.offerEffect(
      s.tx,
      s.actor,
      s.scopeId,
      s.proof.actorId,
      action,
      resourceId,
      await s.begin(),
      feature ? { actorId: s.proof.actorId, feature, delta: 1 } : undefined,
    );
  }
  async once(
    s: MeetingOperation,
    key: string | undefined,
    body: unknown,
    action: string,
    work: () => Promise<string>,
    feature?: SharedFeatureKey,
    generation?: number,
  ) {
    const me = s.proof;
    if (!me) throw new NotFoundException();
    const current = generation ?? (await this.member(s)).generation,
      identity = {
        meetingId: s.meeting.id,
        actorId: me.actorId,
        generation: current,
        keyHash: meetingKey(key),
      },
      fingerprint = meetingHash({ action, body });
    const old = await s.tx.meetingMutation.findUnique({
      where: { meetingId_actorId_generation_keyHash: identity },
    });
    if (old) {
      if (old.fingerprint !== fingerprint)
        throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT' });
      return old.resourceId;
    }
    const resourceId = await work();
    await s.tx.meetingMutation.create({
      data: {
        ...identity,
        spaceId: s.spaceId,
        fingerprint,
        resourceId,
        action,
      },
    });
    await this.effect(s, action, resourceId, feature);
    return resourceId;
  }
  async admit(
    s: MeetingOperation,
    proof: MeetingProof,
    role: 'ORGANIZER' | 'PARTICIPANT',
    rsvp: 'ACCEPTED' | 'TENTATIVE' = 'ACCEPTED',
  ) {
    const previous = await s.tx.meetingMember.findUnique({
      where: {
        meetingId_actorId: { meetingId: s.meeting.id, actorId: proof.actorId },
      },
    });
    if (
      previous?.state === 'ACTIVE' &&
      previous.sourceAccessId === proof.accessId &&
      previous.sourceGeneration === proof.generation &&
      previous.restoreGeneration === proof.restoreGeneration
    )
      throw new ConflictException({ code: 'ALREADY_PARTICIPATING' });
    if (
      !previous &&
      (await s.tx.meetingMember.count({
        where: { meetingId: s.meeting.id },
      })) >= 200
    )
      throw new PayloadTooLargeException();
    if (previous)
      await s.tx.meetingAdmission.updateMany({
        where: { memberId: previous.id, endedAt: null },
        data: { endedAt: s.now },
      });
    const data = {
      state: 'ACTIVE',
      role,
      rsvp,
      sourceAccessId: proof.accessId,
      sourceGeneration: proof.generation,
      restoreGeneration: proof.restoreGeneration,
      joinedAt: s.now,
    };
    const member = previous
      ? await s.tx.meetingMember.update({
          where: { id: previous.id },
          data: {
            ...data,
            generation: { increment: 1 },
            revision: { increment: 1 },
          },
        })
      : await s.tx.meetingMember.create({
          data: {
            ...data,
            id: randomUUID(),
            spaceId: s.spaceId,
            scopeId: s.scopeId,
            meetingId: s.meeting.id,
            actorId: proof.actorId,
          },
        });
    await s.tx.meetingAdmission.create({
      data: {
        meetingId: s.meeting.id,
        memberId: member.id,
        generation: member.generation,
        joinedAt: s.now,
      },
    });
    return member;
  }
  async end(
    s: MeetingOperation,
    member: MeetingMember,
    state: 'LEFT' | 'REVOKED',
  ) {
    await s.tx.meetingAdmission.updateMany({
      where: {
        memberId: member.id,
        generation: member.generation,
        endedAt: null,
      },
      data: { endedAt: s.now },
    });
    await s.tx.meetingMember.update({
      where: { id: member.id },
      data: { state, rsvp: 'DECLINED', revision: { increment: 1 } },
    });
    await s.tx.meeting.update({
      where: { id: s.meeting.id },
      data: { revision: { increment: 1 } },
    });
  }
  async stamp(s: MeetingOperation) {
    const m = await this.member(s);
    return meetingHash([
      s.meeting.id,
      s.meeting.revision,
      m.id,
      m.generation,
      m.sourceGeneration,
      m.restoreGeneration,
      await this.authority.frame(s.tx, s.scopeId, s.actor.userId),
    ]);
  }
  after(
    actor: RequestActor,
    context: string,
    stamp: string,
    cursor: string | undefined,
  ) {
    const value = this.shared.opaquePosition(
      context,
      stamp,
      actor.userId,
      cursor,
    );
    if (value !== undefined && !/^[a-f0-9-]{36}$/i.test(value))
      throw new BadRequestException();
    return value;
  }
  page<T extends { id: string }>(
    actor: RequestActor,
    context: string,
    stamp: string,
    items: T[],
    limit: number,
  ) {
    return {
      items: items.slice(0, limit),
      hasMore: items.length > limit,
      nextCursor:
        items.length > limit
          ? this.shared.opaqueCursor(
              context,
              stamp,
              actor.userId,
              items[limit - 1]!.id,
            )
          : null,
    };
  }
}
