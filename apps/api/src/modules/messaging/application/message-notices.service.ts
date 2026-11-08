import {
  Inject,
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type {
  MessageActivity,
  MessageNotice,
} from '../../../generated/prisma/client.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { writeAudit } from '../../../platform/audit/audit.service.js';
import { MessagingPush } from '../../notifications/public/index.js';
import { MessagingAuthority, SharedKernel } from '../../spaces/public/index.js';
import {
  MessagingService,
  type MessageOperation as Op,
} from './messaging.service.js';
import { AdvancedMessagingService } from './advanced-messaging.service.js';
import {
  MessageMediaService,
  messageFingerprint,
  messageVersion,
} from './message-media.service.js';
const inaccessible = (e: unknown) =>
  e instanceof NotFoundException || e instanceof ForbiddenException;
type Page = z.infer<typeof c.ConversationPageQuerySchema>;
@Injectable()
export class MessageNotices {
  constructor(
    @Inject(DatabaseService) readonly db: DatabaseService,
    @Inject(MessagingService) readonly base: MessagingService,
    @Inject(AdvancedMessagingService)
    readonly advanced: AdvancedMessagingService,
    @Inject(MessageMediaService) readonly media: MessageMediaService,
    @Inject(MessagingAuthority) readonly authority: MessagingAuthority,
    @Inject(MessagingPush) readonly push: MessagingPush,
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
  ) {}
  async operation<T>(
    activity: MessageActivity,
    userId: string,
    work: (s: Op) => Promise<T>,
    actor?: RequestActor,
  ) {
    const sources =
      activity.kind === 'MESSAGE'
        ? await this.advanced.dependencies(activity.conversationId)
        : [];
    const invitation =
      activity.kind === 'INVITATION'
        ? await this.db.client.conversationInvitation.findUnique({
            where: { id: activity.invitationId! },
            select: { recipientActorId: true },
          })
        : null;
    const recipients = invitation
      ? await this.authority.hints([invitation.recipientActorId])
      : [];
    return this.base.operation(
      actor ?? { userId, requestId: randomUUID(), correlationId: randomUUID() },
      activity.conversationId,
      'messaging.notice.check',
      async (s) => {
        if (activity.kind === 'MESSAGE')
          await this.advanced.validateSources(s, sources);
        return work(s);
      },
      [userId, ...recipients],
      true,
      sources,
      !actor,
    );
  }
  async context(
    s: Op,
    activity: MessageActivity,
    actorId: string,
    memberId: string | null,
    generation: number | null,
  ) {
    try {
      const userId = await this.authority.user(s.tx, s.conv.spaceId, actorId);
      let member: null | Awaited<
          ReturnType<MessagingService['currentMember']>
        > = null,
        mentioned = false;
      if (activity.kind === 'MESSAGE') {
        const proof = await this.base.proof(s, userId),
          receiver: Op = { ...s, actor: { ...s.actor, userId }, proof };
        member = await this.base.currentMember(receiver);
        if (member.id !== memberId || member.generation !== generation)
          return null;
        const e = await this.advanced.entry(
          receiver,
          member,
          activity.messageId!,
        );
        if (e.memberId === member.id) return null;
        if ((await this.media.view(receiver, member, e)).state !== 'VISIBLE')
          return null;
        mentioned = !!(await s.tx.messageMention.findFirst({
          where: {
            messageId: e.id,
            memberId: member.id,
            generation: member.generation,
          },
        }));
      } else {
        const invitation = await s.tx.conversationInvitation.findFirst({
          where: {
            id: activity.invitationId!,
            conversationId: s.conv.id,
            recipientActorId: actorId,
            state: 'PENDING',
            expiresAt: { gt: s.now },
          },
        });
        if (!invitation) return null;
        const issuer = await this.authority.user(
            s.tx,
            s.conv.spaceId,
            invitation.inviterActorId,
          ),
          proof = await this.base.proof(s, issuer);
        if (
          invitation.inviterAccessId !== proof.accessId ||
          invitation.inviterGeneration !== proof.generation ||
          invitation.restoreGeneration !== proof.restoreGeneration
        )
          return null;
        const administrator = await this.base.administer(s, proof);
        if (
          invitation.inviterMemberId &&
          (administrator?.id !== invitation.inviterMemberId ||
            administrator.generation !== invitation.inviterMemberGeneration)
        )
          return null;
        if (invitation.recipientAccessId) {
          const recipient = await this.base.proof(s, userId);
          if (
            recipient.accessId !== invitation.recipientAccessId ||
            recipient.generation !== invitation.recipientGeneration
          )
            return null;
        }
      }
      const owner = await this.authority.personal(s.tx, userId),
        preferences = await this.push.preferences(s.tx, owner),
        settings = member
          ? await s.tx.messageNoticePreference.findUnique({
              where: {
                memberId_generation: {
                  memberId: member.id,
                  generation: member.generation,
                },
              },
            })
          : null;
      const mode = settings?.mode ?? 'ALL',
        effectiveAt =
          settings?.effectiveAt ?? member?.joinedAt ?? activity.createdAt;
      const quietStart = settings?.quietStart ?? preferences.quietStart,
        quietEnd = settings?.quietEnd ?? preferences.quietEnd;
      const notBefore = this.push.quiet(
        s.now,
        owner.timezone,
        quietStart,
        quietEnd,
        mentioned && !!settings?.mentionQuiet,
      );
      const pushAllowed =
        preferences.available &&
        preferences.webPush &&
        preferences.messagingWebPush &&
        !!preferences.enabledAt &&
        activity.createdAt > preferences.enabledAt &&
        (!member || activity.createdAt > effectiveAt) &&
        mode !== 'MUTED' &&
        (mode !== 'MENTIONS_ONLY' || mentioned) &&
        s.now.getTime() <= activity.createdAt.getTime() + 7 * 86400000;
      return { owner, preferences, member, mentioned, pushAllowed, notBefore };
    } catch (error) {
      if (inaccessible(error)) return null;
      throw error;
    }
  }
  async fanout() {
    const hint = await this.db.client.messageActivity.findFirst({
      where: { processed: false },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (!hint) return false;
    const conv = await this.db.client.conversation.findUnique({
        where: { id: hint.conversationId },
      }),
      operator = conv ? await this.authority.operator(conv.scopeId) : null;
    if (!operator) {
      await this.db.client.messageActivity.updateMany({
        where: { id: hint.id, processed: false },
        data: { processed: true },
      });
      return true;
    }
    try {
      return await this.operation(hint, operator, async (s) => {
        const activity = await s.tx.messageActivity.findUniqueOrThrow({
          where: { id: hint.id },
        });
        if (activity.processed) return true;
        if (activity.createdAt.getTime() + 7 * 86400000 < s.now.getTime()) {
          await s.tx.messageActivity.update({
            where: { id: hint.id },
            data: { processed: true },
          });
          return true;
        }
        const recipients: Array<{
          actorId: string;
          memberId: string | null;
          generation: number | null;
        }> = [];
        if (activity.kind === 'MESSAGE') {
          const e = await s.tx.messageEntry.findUniqueOrThrow({
              where: { id: activity.messageId! },
            }),
            members = await s.tx.conversationMember.findMany({
              where: {
                conversationId: s.conv.id,
                state: 'ACTIVE',
                historyAfter: { lt: e.sequence },
                id: { not: e.memberId },
              },
              orderBy: { id: 'asc' },
              take: 200,
            });
          for (const m of members)
            recipients.push({
              actorId: m.actorId,
              memberId: m.id,
              generation: m.generation,
            });
        } else {
          const invitation =
            await s.tx.conversationInvitation.findUniqueOrThrow({
              where: { id: activity.invitationId! },
            });
          recipients.push({
            actorId: invitation.recipientActorId,
            memberId: null,
            generation: null,
          });
        }
        for (const recipient of recipients) {
          if (
            !(await this.context(
              s,
              activity,
              recipient.actorId,
              recipient.memberId,
              recipient.generation,
            ))
          )
            continue;
          await s.tx.messageNotice.upsert({
            where: {
              activityId_actorId: {
                activityId: activity.id,
                actorId: recipient.actorId,
              },
            },
            create: {
              id: randomUUID(),
              spaceId: s.conv.spaceId,
              conversationId: s.conv.id,
              activityId: activity.id,
              ...recipient,
            },
            update: {},
          });
        }
        await s.tx.messageActivity.update({
          where: { id: hint.id },
          data: { processed: true },
        });
        return true;
      });
    } catch (error) {
      if (!inaccessible(error)) throw error;
      await this.db.client.messageActivity.updateMany({
        where: { id: hint.id, processed: false },
        data: { processed: true },
      });
      return true;
    }
  }
  async prepare() {
    const hint = await this.db.client.messageNotice.findFirst({
      where: { state: 'PENDING' },
      include: { activity: true },
      orderBy: { id: 'asc' },
    });
    if (!hint) return false;
    const userId = (await this.authority.hints([hint.actorId]))[0];
    if (!userId) {
      await this.cancel(hint.id);
      return true;
    }
    try {
      return await this.operation(hint.activity, userId, async (s) => {
        const notice = await s.tx.messageNotice.findUniqueOrThrow({
          where: { id: hint.id },
        });
        if (notice.state !== 'PENDING') return true;
        const context = await this.context(
          s,
          hint.activity,
          notice.actorId,
          notice.memberId,
          notice.generation,
        );
        if (
          !context ||
          hint.activity.createdAt.getTime() + 7 * 86400000 < s.now.getTime()
        ) {
          await s.tx.messageNotice.update({
            where: { id: notice.id },
            data: { state: 'CANCELED' },
          });
          return true;
        }
        await s.tx.messageNotice.update({
          where: { id: notice.id },
          data: { state: 'PUBLISHED', inApp: context.preferences.inApp },
        });
        if (context.pushAllowed) {
          for (const subscription of await this.push.subscriptions(
            s.tx,
            context.owner,
            hint.activity.createdAt,
          ))
            await s.tx.messageNoticeAttempt.upsert({
              where: {
                noticeId_subscriptionId: {
                  noticeId: notice.id,
                  subscriptionId: subscription.id,
                },
              },
              create: {
                id: randomUUID(),
                noticeId: notice.id,
                subscriptionId: subscription.id,
                subscriptionRevision: subscription.revision,
                notBefore: context.notBefore,
              },
              update: {},
            });
        }
        return true;
      });
    } catch (error) {
      if (!inaccessible(error)) throw error;
      await this.cancel(hint.id);
      return true;
    }
  }
  async cancel(id: string) {
    await this.db.client.$transaction(async (tx) => {
      await tx.messageNotice.updateMany({
        where: { id },
        data: { state: 'CANCELED', inApp: false },
      });
      await tx.messageNoticeAttempt.updateMany({
        where: {
          noticeId: id,
          state: { in: ['PENDING', 'PROCESSING', 'RETRY'] },
        },
        data: {
          state: 'CANCELED',
          canceledAt: new Date(),
          code: 'SOURCE_UNAVAILABLE',
        },
      });
      await tx.messageNoticeAttempt.updateMany({
        where: { noticeId: id, state: 'NETWORK' },
        data: { canceledAt: new Date() },
      });
    });
  }
  private dto(notice: MessageNotice, activity: MessageActivity) {
    return c.MessageNoticeSchema.parse({
      id: notice.id,
      conversationId: notice.conversationId,
      kind: activity.kind,
      messageId: activity.messageId,
      invitationId: activity.invitationId,
      read: notice.read,
      revision: notice.revision,
      createdAt: notice.createdAt.toISOString(),
    });
  }
  private async owned(actor: RequestActor, id: string) {
    const actors = await this.authority.actors(actor),
      notice = await this.db.client.messageNotice.findFirst({
        where: { id, actorId: { in: actors }, state: 'PUBLISHED' },
        include: { activity: true },
      });
    if (!notice) throw new NotFoundException();
    return notice;
  }
  list(actor: RequestActor, q: Page) {
    return this.listCurrent(actor, q);
  }
  private async listCurrent(actor: RequestActor, q: Page) {
    const actors = await this.authority.actors(actor),
      context = 'messaging-notices',
      stamp = messageFingerprint(actors.sort()),
      after = this.kernel.opaquePosition(
        context,
        stamp,
        actor.userId,
        q.cursor,
      );
    if (
      after !== undefined &&
      !c.MessageNoticeSchema.shape.id.safeParse(after).success
    )
      throw new BadRequestException();
    const rows = await this.db.client.messageNotice.findMany({
        where: {
          actorId: { in: actors },
          state: 'PUBLISHED',
          inApp: true,
          ...(after ? { id: { gt: after } } : {}),
        },
        include: { activity: true },
        orderBy: { id: 'asc' },
        take: q.limit + 1,
      }),
      items = [];
    for (const notice of rows.slice(0, q.limit)) {
      try {
        const value = await this.operation(
          notice.activity,
          actor.userId,
          async (s) =>
            (await this.context(
              s,
              notice.activity,
              notice.actorId,
              notice.memberId,
              notice.generation,
            ))
              ? this.dto(notice, notice.activity)
              : null,
          actor,
        );
        if (value) items.push(value);
      } catch (error) {
        if (!inaccessible(error)) throw error;
      }
    }
    return c.MessageNoticePageSchema.parse({
      items,
      nextCursor:
        rows.length > q.limit
          ? this.kernel.opaqueCursor(
              context,
              stamp,
              actor.userId,
              rows[q.limit - 1]!.id,
            )
          : null,
      hasMore: rows.length > q.limit,
    });
  }
  async read(actor: RequestActor, id: string, expected: number | undefined) {
    const hint = await this.owned(actor, id);
    return this.operation(
      hint.activity,
      actor.userId,
      async (s) => {
        const notice = await s.tx.messageNotice.findUniqueOrThrow({
          where: { id },
        });
        if (
          !(await this.context(
            s,
            hint.activity,
            notice.actorId,
            notice.memberId,
            notice.generation,
          ))
        )
          throw new NotFoundException();
        if (notice.read) return this.dto(notice, hint.activity);
        messageVersion(expected, notice.revision);
        const next = await s.tx.messageNotice.update({
          where: { id },
          data: { read: true, revision: { increment: 1 } },
        });
        await s.tx.messageNoticeAttempt.updateMany({
          where: {
            noticeId: id,
            state: { in: ['PENDING', 'PROCESSING', 'RETRY'] },
          },
          data: { state: 'CANCELED', canceledAt: s.now, code: 'NOTICE_READ' },
        });
        await s.tx.messageNoticeAttempt.updateMany({
          where: { noticeId: id, state: 'NETWORK' },
          data: { canceledAt: s.now },
        });
        await writeAudit(s.tx, {
          action: 'NOTIFICATION_CHANGE',
          outcome: 'SUCCEEDED',
          actorUserId: actor.userId,
          requestId: actor.requestId,
          correlationId: actor.correlationId,
          resourceId: id,
        });
        return this.dto(next, hint.activity);
      },
      actor,
    );
  }
  async attempts(actor: RequestActor, id: string) {
    const hint = await this.owned(actor, id);
    return this.operation(
      hint.activity,
      actor.userId,
      async (s) => {
        if (
          !(await this.context(
            s,
            hint.activity,
            hint.actorId,
            hint.memberId,
            hint.generation,
          ))
        )
          throw new NotFoundException();
        const rows = await s.tx.messageNoticeAttempt.findMany({
          where: { noticeId: id },
          orderBy: { id: 'asc' },
          take: 20,
        });
        return {
          items: rows.map((v) => ({
            id: v.id,
            state: v.state,
            attempts: v.attempts,
            notBefore: v.notBefore.toISOString(),
            code: v.code,
          })),
        };
      },
      actor,
    );
  }
}
