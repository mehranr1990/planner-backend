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
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type {
  Prisma,
  Conversation,
  ConversationMember,
  ConversationInvitation,
  ConversationMessage,
} from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import { persistenceStatus } from '../../../platform/database/persistence-error.js';
import {
  SharedKernel,
  CollaborationService,
  MessagingAuthority,
} from '../../spaces/public/index.js';
import { managesChannel, sameAdmission } from '../domain/messaging-policy.js';

type Tx = Prisma.TransactionClient;
type Proof = Awaited<ReturnType<MessagingAuthority['proof']>>;
type Page = z.infer<typeof c.ConversationPageQuerySchema>;
type Operation = {
  tx: Tx;
  actor: RequestActor;
  conv: Conversation;
  now: Date;
  locked: string[];
  begin: () => Promise<string>;
  proof: Proof | null;
};
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const fingerprint = (value: unknown) => hash(JSON.stringify(value));
const independent = (kind: string) => kind === 'DM' || kind === 'PRIVATE_GROUP';
function keyHash(key: string | undefined) {
  if (!key || !/^[\x21-\x7e]{1,128}$/.test(key))
    throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
  return hash(key);
}
function match(expected: number, actual: number) {
  if (expected !== actual)
    throw new ConflictException({ code: 'REVISION_CONFLICT' });
}
function hidden(error: unknown) {
  return (
    error instanceof NotFoundException || error instanceof ForbiddenException
  );
}
const memberView = (m: ConversationMember) =>
  c.ConversationMemberSchema.parse({
    id: m.id,
    conversationId: m.conversationId,
    actorId: m.actorId,
    role: m.role,
    state: m.state,
    generation: m.generation,
    revision: m.revision,
    historyAfter: String(m.historyAfter),
    joinedAt: m.joinedAt.toISOString(),
  });
const messageView = (m: ConversationMessage) =>
  c.ConversationMessageSchema.parse({
    id: m.id,
    conversationId: m.conversationId,
    sequence: String(m.sequence),
    memberId: m.memberId,
    memberGeneration: m.memberGeneration,
    text: m.text,
    createdAt: m.createdAt.toISOString(),
  });

@Injectable()
export class MessagingService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
    @Inject(CollaborationService)
    private readonly collaboration: CollaborationService,
    @Inject(MessagingAuthority) private readonly authority: MessagingAuthority,
  ) {}
  request(ip: string, actor: RequestActor) {
    return this.collaboration.request(ip, actor);
  }
  /** Owner read under the lifecycle coordinator's custody fence. Disposal is
   * deliberately unavailable until the approved P5 retention implementation. */
  async disposalBlocker(tx: Tx, spaceId: string) {
    return (await tx.conversation.count({ where: { spaceId } }))
      ? 'MESSAGING_RETENTION_PENDING'
      : null;
  }
  private async proof(s: Operation, userId = s.actor.userId) {
    const proof = await this.authority.proof(
      s.tx,
      s.actor,
      s.conv.scopeId,
      userId,
      s.locked,
    );
    if (
      proof.spaceId !== s.conv.spaceId ||
      proof.kind !== (independent(s.conv.kind) ? 'CONVERSATION' : s.conv.kind)
    )
      throw new NotFoundException();
    return proof;
  }
  private async currentMember(s: Operation, proof = s.proof) {
    if (!proof) throw new NotFoundException();
    const member = await s.tx.conversationMember.findUnique({
      where: {
        conversationId_actorId: {
          conversationId: s.conv.id,
          actorId: proof.actorId,
        },
      },
    });
    if (!member || member.state !== 'ACTIVE' || !sameAdmission(member, proof))
      throw new NotFoundException();
    return member;
  }
  private async administer(s: Operation, proof = s.proof) {
    if (!proof) throw new NotFoundException();
    if (s.conv.kind === 'PRIVATE_GROUP' || s.conv.kind === 'DM') {
      const member = await this.currentMember(s, proof);
      if (s.conv.kind !== 'DM' && member.role !== 'ADMIN')
        throw new ForbiddenException();
      return member;
    }
    if (!managesChannel(s.conv.kind, proof.role))
      throw new ForbiddenException();
    return null;
  }
  private async validMembers(s: Operation) {
    const rows = await s.tx.conversationMember.findMany({
      where: { conversationId: s.conv.id, state: 'ACTIVE' },
      orderBy: { id: 'asc' },
      take: 201,
    });
    if (rows.length > 200) throw new PayloadTooLargeException();
    const result: ConversationMember[] = [];
    for (const row of rows) {
      try {
        const userId = await this.authority.user(
          s.tx,
          s.conv.spaceId,
          row.actorId,
        );
        await this.currentMember(s, await this.proof(s, userId));
        result.push(row);
      } catch (error) {
        if (!hidden(error)) throw error;
      }
    }
    return result;
  }
  private async writable(s: Operation) {
    if (s.proof?.role === 'VIEWER') return false;
    if (!independent(s.conv.kind)) return true;
    const members = await this.validMembers(s);
    return s.conv.kind === 'DM'
      ? members.length === 2
      : members.some((m) => m.role === 'ADMIN');
  }
  private async view(s: Operation) {
    await this.currentMember(s);
    const row = await s.tx.conversation.findUniqueOrThrow({
      where: { id: s.conv.id },
    });
    return c.ConversationSchema.parse({
      id: row.id,
      kind: row.kind,
      sourceId: independent(row.kind) ? null : row.scopeId,
      title: row.title,
      revision: row.revision,
      writable: await this.writable(s),
      createdAt: row.createdAt.toISOString(),
    });
  }
  private invitationView(conv: Conversation, row: ConversationInvitation) {
    return c.ConversationInvitationSchema.parse({
      id: row.id,
      conversationId: row.conversationId,
      kind: conv.kind,
      inviterActorId: row.inviterActorId,
      state: row.state,
      revision: row.revision,
      expiresAt: row.expiresAt.toISOString(),
    });
  }
  private async operation<T>(
    actor: RequestActor,
    id: string,
    action: string,
    work: (s: Operation) => Promise<T>,
    additionalUsers: string[] = [],
    pending = false,
  ) {
    const hint = await this.db.client.conversation.findUnique({
      where: { id },
    });
    if (!hint) {
      this.kernel.assertEnabled();
      throw new NotFoundException();
    }
    const members = await this.db.client.conversationMember.findMany({
      where: { conversationId: id, state: 'ACTIVE' },
      select: { actorId: true },
      take: 201,
    });
    if (members.length > 200) throw new PayloadTooLargeException();
    const users = await this.authority.hints(members.map((m) => m.actorId));
    return this.collaboration.signed(
      actor,
      hint.scopeId,
      [...users, ...additionalUsers],
      action,
      id,
      async (tx, now, locked, begin) => {
        const conv = await tx.conversation.findUnique({ where: { id } });
        if (
          !conv ||
          conv.spaceId !== hint.spaceId ||
          conv.scopeId !== hint.scopeId
        )
          throw new NotFoundException();
        const s: Operation = {
          tx,
          actor,
          conv,
          now,
          locked,
          begin,
          proof: null,
        };
        if (!pending || !independent(conv.kind)) s.proof = await this.proof(s);
        return work(s);
      },
    );
  }
  private async effect(
    s: Operation,
    action: string,
    resourceId: string,
    feature?:
      'messaging.conversation' | 'messaging.participant' | 'messaging.message',
    actorId = s.proof?.actorId,
  ) {
    if (!actorId) throw new NotFoundException();
    if (feature) await this.kernel.featureGrowth(s.tx, s.conv.scopeId, feature);
    const auditId = await s.begin();
    await this.kernel.offerEffect(
      s.tx,
      s.actor,
      s.conv.scopeId,
      actorId,
      action,
      resourceId,
      auditId,
      feature ? { actorId, feature, delta: 1 } : undefined,
    );
  }
  private async admit(s: Operation, proof: Proof, role: 'ADMIN' | 'MEMBER') {
    const old = await s.tx.conversationMember.findUnique({
      where: {
        conversationId_actorId: {
          conversationId: s.conv.id,
          actorId: proof.actorId,
        },
      },
    });
    if (old && old.state === 'ACTIVE' && sameAdmission(old, proof))
      throw new ConflictException({ code: 'ALREADY_PARTICIPATING' });
    if (old)
      await s.tx.conversationAdmission.updateMany({
        where: { memberId: old.id, endedAt: null },
        data: { endedAt: s.now },
      });
    if (
      !old &&
      (await s.tx.conversationMember.count({
        where: { conversationId: s.conv.id },
      })) >= 200
    )
      throw new PayloadTooLargeException();
    const data = {
      sourceAccessId: proof.accessId,
      sourceGeneration: proof.generation,
      restoreGeneration: proof.restoreGeneration,
      role,
      state: 'ACTIVE',
      historyAfter: s.conv.lastSequence,
      joinedAt: s.now,
    };
    const member = old
      ? await s.tx.conversationMember.update({
          where: { id: old.id },
          data: {
            ...data,
            generation: { increment: 1 },
            revision: { increment: 1 },
          },
        })
      : await s.tx.conversationMember.create({
          data: {
            ...data,
            id: randomUUID(),
            spaceId: s.conv.spaceId,
            scopeId: s.conv.scopeId,
            conversationId: s.conv.id,
            actorId: proof.actorId,
          },
        });
    await s.tx.conversationAdmission.create({
      data: {
        conversationId: s.conv.id,
        memberId: member.id,
        generation: member.generation,
        historyAfter: member.historyAfter,
        joinedAt: s.now,
      },
    });
    return member;
  }
  private async issue(
    s: Operation,
    input: z.infer<typeof c.ConversationInvitationInputSchema>,
    key: string,
  ) {
    const admin = await this.administer(s);
    const proof = s.proof!;
    if (!s.locked.includes(input.userId))
      throw new ConflictException({ code: 'RECIPIENT_CHANGED_RESTART' });
    const recipient = await this.authority.actor(
      s.tx,
      s.conv.spaceId,
      input.userId,
    );
    if (recipient.id === proof.actorId) throw new BadRequestException();
    const keyDigest = keyHash(key),
      bodyHash = fingerprint(input);
    const old = await s.tx.conversationInvitation.findUnique({
      where: {
        conversationId_inviterActorId_keyHash: {
          conversationId: s.conv.id,
          inviterActorId: proof.actorId,
          keyHash: keyDigest,
        },
      },
    });
    if (old) {
      if (old.fingerprint !== bodyHash)
        throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT' });
      if (old.state === 'PENDING' && old.expiresAt <= s.now)
        throw new ConflictException({ code: 'INVITATION_EXPIRED' });
      return old;
    }
    if (s.conv.kind === 'DM') {
      const original = await s.tx.conversationInvitation.findFirst({
        where: { conversationId: s.conv.id },
        orderBy: { createdAt: 'asc' },
      });
      if (
        recipient.id !== s.conv.createdByActorId &&
        original &&
        original.recipientActorId !== recipient.id
      )
        throw new ForbiddenException({ code: 'DM_PAIR_FIXED' });
    }
    let recipientProof: Proof | null = null;
    if (!independent(s.conv.kind))
      recipientProof = await this.proof(s, input.userId);
    const existing = await s.tx.conversationMember.findUnique({
      where: {
        conversationId_actorId: {
          conversationId: s.conv.id,
          actorId: recipient.id,
        },
      },
    });
    if (existing?.state === 'ACTIVE') {
      const p =
        recipientProof ??
        (await this.proof(s, input.userId).catch((error) => {
          if (!hidden(error)) throw error;
          return null;
        }));
      if (p && sameAdmission(existing, p))
        throw new ConflictException({ code: 'ALREADY_PARTICIPATING' });
    }
    if (
      (await s.tx.conversationInvitation.count({
        where: {
          conversationId: s.conv.id,
          state: 'PENDING',
          expiresAt: { gt: s.now },
        },
      })) >= 200
    )
      throw new PayloadTooLargeException();
    await s.tx.conversationInvitation.updateMany({
      where: {
        conversationId: s.conv.id,
        recipientActorId: recipient.id,
        state: 'PENDING',
      },
      data: { state: 'REVOKED', revision: { increment: 1 } },
    });
    return s.tx.conversationInvitation.create({
      data: {
        id: input.id,
        spaceId: s.conv.spaceId,
        scopeId: s.conv.scopeId,
        conversationId: s.conv.id,
        recipientActorId: recipient.id,
        inviterActorId: proof.actorId,
        inviterAccessId: proof.accessId,
        inviterGeneration: proof.generation,
        inviterMemberId: admin?.id ?? null,
        inviterMemberGeneration: admin?.generation ?? null,
        recipientAccessId: recipientProof?.accessId ?? null,
        recipientGeneration: recipientProof?.generation ?? null,
        restoreGeneration: proof.restoreGeneration,
        keyHash: keyDigest,
        fingerprint: bodyHash,
        expiresAt: new Date(s.now.getTime() + 7 * 86400000),
      },
    });
  }
  async create(
    actor: RequestActor,
    input: z.infer<typeof c.ConversationCreateSchema>,
    key: string | undefined,
  ) {
    try {
      return await this.createOnce(actor, input, key);
    } catch (error) {
      if (
        !(error instanceof ConflictException) &&
        persistenceStatus(error) !== 409
      )
        throw error;
      if (
        !(await this.db.client.conversation.findUnique({
          where: { id: input.id },
        }))
      )
        throw error;
      // A competing identical creation may have won the actor/custody fence.
      // Re-enter current authorization; never return an unfenced old receipt.
      return this.createOnce(actor, input, key);
    }
  }
  private async createOnce(
    actor: RequestActor,
    input: z.infer<typeof c.ConversationCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.ConversationCreateSchema.parse(input),
      keyDigest = keyHash(key),
      bodyHash = fingerprint(body);
    if (body.participants.includes(actor.userId))
      throw new BadRequestException();
    const existing = await this.db.client.conversation.findUnique({
      where: { id: body.id },
    });
    if (existing)
      return this.operation(
        actor,
        body.id,
        'messaging.conversation.replay',
        async (s) => {
          if (!independent(s.conv.kind)) await this.administer(s);
          if (
            s.conv.createdByActorId !== s.proof!.actorId ||
            s.conv.creationKeyHash !== keyDigest ||
            s.conv.creationFingerprint !== bodyHash
          )
            throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT' });
          return this.view(s);
        },
      );
    const insert = async (s: Operation) => {
      await this.admit(s, s.proof!, 'ADMIN');
      for (const userId of body.participants)
        await this.issue(
          s,
          { id: randomUUID(), userId },
          body.id + ':' + userId,
        );
    };
    if ('retentionPolicyVersion' in body) {
      await this.kernel.provision(
        actor,
        body.id,
        body.retentionPolicyVersion,
        async (tx, boundary) => {
          const now = (
            await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
          )[0]!.now;
          const conv = await tx.conversation.create({
            data: {
              id: body.id,
              ...{ spaceId: boundary.spaceId, scopeId: boundary.scopeId },
              kind: body.kind,
              title: 'title' in body ? body.title : null,
              createdByActorId: boundary.actorId,
              creationKeyHash: keyDigest,
              creationFingerprint: bodyHash,
            },
          });
          const locked = [actor.userId, ...body.participants];
          const proof = await this.authority.proof(
            tx,
            actor,
            conv.scopeId,
            actor.userId,
            locked,
          );
          const s = {
            tx,
            actor,
            conv,
            now,
            locked,
            begin: async () => randomUUID(),
            proof,
          };
          await insert(s);
          await this.effect(
            s,
            'messaging.conversation.create',
            body.id,
            'messaging.conversation',
          );
        },
        'CONVERSATION',
        body.participants,
      );
      return this.get(actor, body.id);
    }
    const spaceId = await this.kernel.custodySpace(body.sourceId);
    return this.collaboration.signed(
      actor,
      body.sourceId,
      body.participants,
      'messaging.conversation.create',
      body.id,
      async (tx, now, locked, begin) => {
        const proof = await this.authority.proof(
          tx,
          actor,
          body.sourceId,
          actor.userId,
          locked,
        );
        if (proof.kind !== body.kind || !managesChannel(body.kind, proof.role))
          throw new ForbiddenException();
        const conv = await tx.conversation.create({
          data: {
            id: body.id,
            spaceId,
            scopeId: body.sourceId,
            kind: body.kind,
            title: body.title,
            createdByActorId: proof.actorId,
            creationKeyHash: keyDigest,
            creationFingerprint: bodyHash,
            projectId: body.kind === 'PROJECT' ? body.sourceId : null,
            teamId: body.kind === 'TEAM' ? body.sourceId : null,
            companyId: body.kind === 'COMPANY' ? body.sourceId : null,
          },
        });
        const s = { tx, actor, conv, now, locked, begin, proof };
        await insert(s);
        await this.effect(
          s,
          'messaging.conversation.create',
          body.id,
          'messaging.conversation',
        );
        return this.view(s);
      },
    );
  }
  get(actor: RequestActor, id: string) {
    return this.operation(actor, id, 'messaging.read', (s) => this.view(s));
  }
  async list(actor: RequestActor, q: Page) {
    const stamp = hash('messaging-list-v1'),
      context = 'conversations';
    const after = this.kernel.cursorPosition(
      context,
      stamp,
      actor.userId,
      q.cursor,
    );
    const actors = await this.authority.actors(actor);
    const rows = await this.db.client.conversation.findMany({
      where: {
        Members: { some: { state: 'ACTIVE', actorId: { in: actors } } },
        ...(after ? { id: { gt: after } } : {}),
      },
      orderBy: { id: 'asc' },
      take: q.limit + 1,
    });
    const items: z.infer<typeof c.ConversationSchema>[] = [];
    for (const row of rows.slice(0, q.limit)) {
      try {
        items.push(await this.get(actor, row.id));
      } catch (error) {
        if (!hidden(error)) throw error;
      }
    }
    return this.kernel.cursorPage(context, stamp, actor.userId, {
      items,
      nextCursor: rows.length > q.limit ? rows[q.limit - 1]!.id : null,
    });
  }
  members(actor: RequestActor, id: string, q: Page) {
    return this.operation(actor, id, 'messaging.members.read', async (s) => {
      const member = await this.currentMember(s),
        stamp = fingerprint({
          member: member.id,
          generation: member.generation,
          restore: s.proof!.restoreGeneration,
        });
      const context = 'conversation-members:' + id,
        after = this.kernel.cursorPosition(
          context,
          stamp,
          actor.userId,
          q.cursor,
        );
      const rows = await s.tx.conversationMember.findMany({
        where: { conversationId: id, ...(after ? { id: { gt: after } } : {}) },
        orderBy: { id: 'asc' },
        take: q.limit + 1,
      });
      return this.kernel.cursorPage(context, stamp, actor.userId, {
        items: rows.slice(0, q.limit).map(memberView),
        nextCursor: rows.length > q.limit ? rows[q.limit - 1]!.id : null,
      });
    });
  }
  invite(
    actor: RequestActor,
    id: string,
    revision: number,
    input: z.infer<typeof c.ConversationInvitationInputSchema>,
    key: string | undefined,
  ) {
    const body = c.ConversationInvitationInputSchema.parse(input);
    keyHash(key);
    return this.operation(
      actor,
      id,
      'messaging.invitation.create',
      async (s) => {
        await this.administer(s);
        const old = await s.tx.conversationInvitation.findUnique({
          where: {
            conversationId_inviterActorId_keyHash: {
              conversationId: id,
              inviterActorId: s.proof!.actorId,
              keyHash: keyHash(key),
            },
          },
        });
        if (!old) match(revision, s.conv.revision);
        const row = await this.issue(s, body, key!);
        if (!old) {
          await s.tx.conversation.update({
            where: { id },
            data: { revision: { increment: 1 } },
          });
          await this.effect(s, 'messaging.invitation.create', row.id);
        }
        return this.invitationView(s.conv, row);
      },
      [body.userId],
    );
  }
  private async recipientOperation<T>(
    actor: RequestActor,
    invitationId: string,
    action: string,
    work: (s: Operation, row: ConversationInvitation) => Promise<T>,
  ) {
    const hint = await this.db.client.conversationInvitation.findUnique({
      where: { id: invitationId },
    });
    if (!hint) throw new NotFoundException();
    const users = await this.authority.hints([
      hint.inviterActorId,
      hint.recipientActorId,
    ]);
    return this.operation(
      actor,
      hint.conversationId,
      action,
      async (s) => {
        const row = await s.tx.conversationInvitation.findUniqueOrThrow({
          where: { id: invitationId },
        });
        if (
          (await this.authority.user(
            s.tx,
            s.conv.spaceId,
            row.recipientActorId,
          )) !== actor.userId
        )
          throw new NotFoundException();
        return work(s, row);
      },
      users,
      true,
    );
  }
  private async eligibleInvitation(s: Operation, row: ConversationInvitation) {
    if (row.expiresAt <= s.now)
      throw new ConflictException({ code: 'INVITATION_EXPIRED' });
    const issuer = await this.authority.user(
      s.tx,
      s.conv.spaceId,
      row.inviterActorId,
    );
    const proof = await this.proof(s, issuer);
    if (
      proof.accessId !== row.inviterAccessId ||
      proof.generation !== row.inviterGeneration ||
      proof.restoreGeneration !== row.restoreGeneration
    )
      throw new NotFoundException();
    const admin = await this.administer(s, proof);
    if (
      admin &&
      (admin.id !== row.inviterMemberId ||
        admin.generation !== row.inviterMemberGeneration)
    )
      throw new NotFoundException();
    if (
      !independent(s.conv.kind) &&
      (!s.proof ||
        s.proof.accessId !== row.recipientAccessId ||
        s.proof.generation !== row.recipientGeneration)
    )
      throw new NotFoundException();
  }
  async invitations(actor: RequestActor, q: Page) {
    const context = 'conversation-invitations',
      stamp = hash('messaging-invitations-v1'),
      after = this.kernel.cursorPosition(
        context,
        stamp,
        actor.userId,
        q.cursor,
      );
    const actors = await this.authority.actors(actor);
    const rows = await this.db.client.conversationInvitation.findMany({
      where: {
        state: 'PENDING',
        recipientActorId: { in: actors },
        expiresAt: { gt: new Date() },
        ...(after ? { id: { gt: after } } : {}),
      },
      orderBy: { id: 'asc' },
      take: q.limit + 1,
    });
    const items: z.infer<typeof c.ConversationInvitationSchema>[] = [];
    for (const row of rows.slice(0, q.limit)) {
      try {
        items.push(
          await this.recipientOperation(
            actor,
            row.id,
            'messaging.invitation.read',
            async (s, r) => {
              await this.eligibleInvitation(s, r);
              return this.invitationView(s.conv, r);
            },
          ),
        );
      } catch (error) {
        if (!hidden(error) && !(error instanceof ConflictException))
          throw error;
      }
    }
    return this.kernel.cursorPage(context, stamp, actor.userId, {
      items,
      nextCursor: rows.length > q.limit ? rows[q.limit - 1]!.id : null,
    });
  }
  decide(
    actor: RequestActor,
    invitationId: string,
    revision: number,
    accept: boolean,
  ) {
    return this.recipientOperation(
      actor,
      invitationId,
      'messaging.invitation.decide',
      async (s, row) => {
        if (row.state === 'ACCEPTED' && accept) {
          s.proof = await this.proof(s);
          await this.currentMember(s);
          return this.invitationView(s.conv, row);
        }
        if (row.state === 'DECLINED' && !accept)
          return this.invitationView(s.conv, row);
        match(revision, row.revision);
        if (row.state !== 'PENDING') throw new ConflictException();
        await this.eligibleInvitation(s, row);
        if (accept) {
          if (independent(s.conv.kind))
            await this.authority.independentSeat(
              s.tx,
              s.conv.spaceId,
              actor.userId,
              s.now,
            );
          s.proof = await this.proof(s);
          await this.admit(s, s.proof, 'MEMBER');
        }
        const next = await s.tx.conversationInvitation.update({
          where: { id: row.id },
          data: {
            state: accept ? 'ACCEPTED' : 'DECLINED',
            revision: { increment: 1 },
          },
        });
        await s.tx.conversation.update({
          where: { id: s.conv.id },
          data: { revision: { increment: 1 } },
        });
        await this.effect(
          s,
          accept ? 'messaging.member.admit' : 'messaging.invitation.decline',
          row.id,
          accept ? 'messaging.participant' : undefined,
          row.recipientActorId,
        );
        return this.invitationView(s.conv, next);
      },
    );
  }
  revokeInvitation(
    actor: RequestActor,
    id: string,
    invitationId: string,
    revision: number,
  ) {
    return this.operation(
      actor,
      id,
      'messaging.invitation.revoke',
      async (s) => {
        await this.administer(s);
        const row = await s.tx.conversationInvitation.findFirst({
          where: { id: invitationId, conversationId: id },
        });
        if (!row) throw new NotFoundException();
        if (row.state === 'REVOKED') return this.invitationView(s.conv, row);
        match(revision, row.revision);
        if (row.state !== 'PENDING') throw new ConflictException();
        const next = await s.tx.conversationInvitation.update({
          where: { id: row.id },
          data: { state: 'REVOKED', revision: { increment: 1 } },
        });
        await s.tx.conversation.update({
          where: { id },
          data: { revision: { increment: 1 } },
        });
        await this.effect(s, 'messaging.invitation.revoke', row.id);
        return this.invitationView(s.conv, next);
      },
    );
  }
  changeMember(
    actor: RequestActor,
    id: string,
    memberId: string,
    revision: number,
    role: 'ADMIN' | 'MEMBER' | null,
  ) {
    return this.operation(
      actor,
      id,
      role ? 'messaging.member.role' : 'messaging.member.remove',
      async (s) => {
        await this.administer(s);
        const row = await s.tx.conversationMember.findFirst({
          where: { id: memberId, conversationId: id },
        });
        if (!row) throw new NotFoundException();
        match(revision, row.revision);
        if (role && s.conv.kind !== 'PRIVATE_GROUP')
          throw new ForbiddenException();
        if (!role && s.conv.kind === 'DM') throw new ForbiddenException();
        if (row.state !== 'ACTIVE') throw new ConflictException();
        const next = await s.tx.conversationMember.update({
          where: { id: row.id },
          data: {
            ...(role ? { role } : { state: 'REVOKED' }),
            revision: { increment: 1 },
          },
        });
        if (!role)
          await s.tx.conversationAdmission.updateMany({
            where: { memberId: row.id, endedAt: null },
            data: { endedAt: s.now },
          });
        await s.tx.conversation.update({
          where: { id },
          data: { revision: { increment: 1 } },
        });
        await this.effect(
          s,
          role ? 'messaging.member.role' : 'messaging.member.remove',
          row.id,
        );
        return memberView(next);
      },
    );
  }
  leave(actor: RequestActor, id: string, revision: number) {
    return this.operation(actor, id, 'messaging.member.leave', async (s) => {
      const member = await this.currentMember(s);
      match(revision, member.revision);
      const next = await s.tx.conversationMember.update({
        where: { id: member.id },
        data: { state: 'LEFT', revision: { increment: 1 } },
      });
      await s.tx.conversationAdmission.updateMany({
        where: { memberId: member.id, endedAt: null },
        data: { endedAt: s.now },
      });
      await s.tx.conversation.update({
        where: { id },
        data: { revision: { increment: 1 } },
      });
      await this.effect(s, 'messaging.member.leave', member.id);
      return memberView(next);
    });
  }
  send(
    actor: RequestActor,
    id: string,
    input: z.infer<typeof c.ConversationMessageInputSchema>,
    key: string | undefined,
  ) {
    const body = c.ConversationMessageInputSchema.parse(input),
      digest = keyHash(key),
      bodyHash = fingerprint(body);
    return this.operation(actor, id, 'messaging.message.send', async (s) => {
      const member = await this.currentMember(s);
      if (!(await this.writable(s)))
        throw new ForbiddenException({ code: 'CONVERSATION_READ_ONLY' });
      const old = await s.tx.conversationMessage.findUnique({
        where: {
          conversationId_memberId_keyHash: {
            conversationId: id,
            memberId: member.id,
            keyHash: digest,
          },
        },
      });
      if (old) {
        if (
          old.fingerprint !== bodyHash ||
          old.memberGeneration !== member.generation ||
          old.sequence <= member.historyAfter
        )
          throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT' });
        return messageView(old);
      }
      if (await s.tx.conversationMessage.findUnique({ where: { id: body.id } }))
        throw new ConflictException({ code: 'MESSAGE_ID_CONFLICT' });
      const conv = await s.tx.conversation.update({
        where: { id },
        data: { lastSequence: { increment: 1 } },
      });
      const row = await s.tx.conversationMessage.create({
        data: {
          id: body.id,
          spaceId: conv.spaceId,
          scopeId: conv.scopeId,
          conversationId: id,
          sequence: conv.lastSequence,
          memberId: member.id,
          memberGeneration: member.generation,
          text: body.text,
          keyHash: digest,
          fingerprint: bodyHash,
        },
      });
      await this.effect(
        s,
        'messaging.message.send',
        row.id,
        'messaging.message',
      );
      return messageView(row);
    });
  }
  messages(actor: RequestActor, id: string, q: Page) {
    return this.operation(actor, id, 'messaging.messages.read', async (s) => {
      const member = await this.currentMember(s),
        context = 'conversation-messages:' + id;
      const stamp = fingerprint({
        member: member.id,
        generation: member.generation,
        source: member.sourceAccessId,
        sourceGeneration: member.sourceGeneration,
        restore: s.proof!.restoreGeneration,
        policy: s.proof!.policyVersion,
        role: s.proof!.role,
        historyAfter: String(member.historyAfter),
      });
      const position = this.kernel.opaquePosition(
        context,
        stamp,
        actor.userId,
        q.cursor,
      );
      if (position !== undefined && !/^(0|[1-9][0-9]{0,18})$/.test(position))
        throw new BadRequestException();
      const after =
        position === undefined ? member.historyAfter : BigInt(position);
      if (after < member.historyAfter || after > s.conv.lastSequence)
        throw new BadRequestException({ code: 'INVALID_CURSOR' });
      const rows = await s.tx.conversationMessage.findMany({
        where: { conversationId: id, sequence: { gt: after } },
        orderBy: { sequence: 'asc' },
        take: q.limit + 1,
      });
      const items = rows.slice(0, q.limit),
        last = items.at(-1)?.sequence ?? after;
      return c.ConversationMessagePageSchema.parse({
        items: items.map(messageView),
        nextCursor: this.kernel.opaqueCursor(
          context,
          stamp,
          actor.userId,
          String(last),
        )!,
        hasMore: rows.length > q.limit,
        highWatermark: String(s.conv.lastSequence),
      });
    });
  }
}
