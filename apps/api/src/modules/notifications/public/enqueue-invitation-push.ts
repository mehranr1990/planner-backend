import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { NotificationModuleSchema } from '@mehran/api-contracts';
import type { z } from 'zod';
import { invitationChannels } from './invitation-preferences.js';
import { personalNotificationOwner } from '../../spaces/public/notification-audience.js';
export type InvitationPushReference =
  | {
      contextInvitationId: string;
      conversationInvitationId?: never;
      meetingInvitationId?: never;
    }
  | {
      contextInvitationId?: never;
      conversationInvitationId: string;
      meetingInvitationId?: never;
    }
  | {
      contextInvitationId?: never;
      conversationInvitationId?: never;
      meetingInvitationId: string;
    };
/** Typed, transactional delivery intent. No content, address, proof or endpoint is copied. */
export async function enqueueInvitationPush(
  tx: Prisma.TransactionClient,
  userId: string,
  module: z.infer<typeof NotificationModuleSchema>,
  reference: InvitationPushReference,
  now: Date,
) {
  if (!(await invitationChannels(tx, userId, module)).webPush) return;
  if (module === 'MESSAGING_MEETINGS') {
    const p = await tx.notificationPreference.findFirst({
      where: { ownerUserId: userId },
      select: { messagingEnabledAt: true },
    });
    if (!p?.messagingEnabledAt || p.messagingEnabledAt >= now) return;
  }
  const owner = await personalNotificationOwner(tx, userId);
  if (!owner) return;
  const subscriptions = await tx.pushSubscription.findMany({
    where: {
      ownerUserId: userId,
      spaceId: owner.spaceId,
      state: 'ACTIVE',
      createdAt: { lt: now },
      updatedAt: { lt: now },
    },
    take: 20,
    select: { id: true, revision: true },
  });
  for (const subscription of subscriptions)
    await tx.invitationPushAttempt.createMany({
      skipDuplicates: true,
      data: [
        {
          id: randomUUID(),
          userId,
          module,
          eventAt: now,
          subscriptionId: subscription.id,
          subscriptionRevision: subscription.revision,
          ...reference,
        },
      ],
    });
}
/** Preserve historic Messaging attempts; new typed intents own their push once. */
export async function hasInvitationPushIntent(
  tx: Prisma.TransactionClient,
  invitationId: string,
  subscriptionId: string,
) {
  return !!(await tx.invitationPushAttempt.findFirst({
    where: { conversationInvitationId: invitationId, subscriptionId },
    select: { id: true },
  }));
}
