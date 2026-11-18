import {
  Injectable,
  Inject,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import {
  ConversationSourceGuard,
  MessagingService,
} from '../../messaging/public/index.js';
import { socialKey, socialRevision } from './social-context.js';
import type { Tx } from './social-context.js';
import { ActivityRuntime } from './activity-runtime.js';
/**
 * ADR 0067 (owner decision D7): Messaging asks this guard on every operation
 * on a Group's primary conversation. Authority is the current ACTIVE seat in
 * an ACTIVE Group; `since` (start of the current seat generation) makes a
 * re-admitted member re-join so history restarts at the new join point.
 */
@Injectable()
export class GroupConversationGuard extends ConversationSourceGuard {
  async assert(tx: Tx, groupId: string, userId: string) {
    const custody = await tx.sharedCustody.findUnique({
      where: { spaceId: groupId },
    });
    if (custody?.kind !== 'SOCIAL_GROUP' || custody.state !== 'ACTIVE')
      throw new NotFoundException();
    const actor = await tx.sharedActor.findFirst({
      where: { spaceId: groupId, userId, state: 'ACTIVE' },
      select: { id: true },
    });
    if (!actor) throw new NotFoundException();
    // Serializes with a concurrent removal, departure, suspension or deletion.
    const [seat] = await tx.$queryRaw<
      {
        id: string;
        state: string;
        memberRole: string | null;
        generation: number;
        joinedAt: Date;
      }[]
    >`SELECT id, state, "memberRole", generation, "joinedAt" FROM "ContextAccess" WHERE "spaceId"=${groupId}::uuid AND "scopeId"=${groupId}::uuid AND "actorId"=${actor.id}::uuid FOR SHARE`;
    if (seat?.state !== 'ACTIVE') throw new NotFoundException();
    const interval = await tx.contextAccessInterval.findUnique({
      where: {
        accessId_generation: { accessId: seat.id, generation: seat.generation },
      },
      select: { joinedAt: true },
    });
    return {
      role:
        seat.memberRole === 'ADMIN' || custody.primaryOwnerAccessId === seat.id
          ? ('ADMIN' as const)
          : ('MEMBER' as const),
      since: interval?.joinedAt ?? seat.joinedAt,
    };
  }
}
/**
 * One primary Messaging-owned conversation per Social Group. Social reserves
 * the conversation ID on the Group row (unique, under the Group row lock) so
 * concurrent opens converge on one conversation; Messaging creates and binds
 * it by source and keeps every message, member and history rule.
 */
@Injectable()
export class SocialGroupConversationService {
  constructor(
    @Inject(ActivityRuntime) private readonly rt: ActivityRuntime,
    @Inject(MessagingService) private readonly messaging: MessagingService,
  ) {}
  private async enter(
    tx: Tx,
    actor: RequestActor,
    groupId: string,
    locked: string[],
    lock = false,
  ) {
    if (!(await this.rt.can(tx, actor, groupId, 'task.read', locked)))
      throw new NotFoundException();
    if (lock)
      await tx.$queryRaw`SELECT id FROM "SocialGroup" WHERE id=${groupId}::uuid FOR UPDATE`;
    return {
      group: await tx.socialGroup.findUniqueOrThrow({ where: { id: groupId } }),
      admin: await this.rt.can(tx, actor, groupId, 'settings.manage', locked),
    };
  }
  private bound(groupId: string) {
    return this.messaging.sourcedConversationId('SOCIAL_GROUP', groupId);
  }
  async read(actor: RequestActor, groupId: string) {
    this.rt.kernel.assertEnabled();
    const { admin } = await this.rt.run(
      actor,
      groupId,
      [],
      async (tx, _now, locked) => this.enter(tx, actor, groupId, locked),
    );
    const conversationId = await this.bound(groupId);
    return c.SocialGroupConversationSchema.parse({
      groupId,
      conversationId,
      canOpen: admin && !conversationId,
    });
  }
  async open(
    actor: RequestActor,
    groupId: string,
    body: z.infer<typeof c.SocialGroupConversationOpenSchema>,
    revision: number,
    key: string | undefined,
  ) {
    this.rt.kernel.assertEnabled();
    socialKey(key);
    const { id, name } = await this.rt.run(
      actor,
      groupId,
      [],
      async (tx, now, locked) => {
        const { group, admin } = await this.enter(
          tx,
          actor,
          groupId,
          locked,
          true,
        );
        if (!admin)
          throw new ForbiddenException({ code: 'GROUP_PERMISSION_REQUIRED' });
        if (group.conversationId)
          return { id: group.conversationId, name: group.name };
        socialRevision(revision, group.revision);
        await tx.socialGroup.update({
          where: { id: groupId },
          data: {
            conversationId: body.id,
            revision: { increment: 1 },
            updatedAt: now,
          },
        });
        // No SocialAuditEvent: it is a protected record that would block the
        // approved D1 disposal; Messaging audits creation and admissions.
        return { id: body.id, name: group.name };
      },
    );
    if (!(await this.bound(groupId)))
      try {
        await this.messaging.openSourced(
          actor,
          {
            id,
            sourceKind: 'SOCIAL_GROUP',
            sourceId: groupId,
            title: name,
            retentionPolicyVersion: body.retentionPolicyVersion,
          },
          key,
        );
      } catch (error) {
        // Another Owner/Admin is creating the reserved conversation.
        if (!(await this.bound(groupId)))
          if (id !== body.id)
            throw new ConflictException({
              code: 'CONVERSATION_OPEN_IN_PROGRESS',
            });
          else throw error;
      }
    return this.read(actor, groupId);
  }
  /** Explicit self-join by a current member; Messaging starts history at join. */
  async join(actor: RequestActor, groupId: string, key: string | undefined) {
    this.rt.kernel.assertEnabled();
    socialKey(key);
    await this.rt.run(actor, groupId, [], async (tx, _now, locked) => {
      await this.enter(tx, actor, groupId, locked);
    });
    const conversationId = await this.bound(groupId);
    if (!conversationId)
      throw new ConflictException({ code: 'CONVERSATION_NOT_OPEN' });
    return this.messaging.admitSourced(actor, conversationId);
  }
}
