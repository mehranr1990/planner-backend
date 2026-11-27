import { SystemEmailEvidence } from '../../../platform/auth/email-evidence.js';
import type { EmailCategory } from '../../../platform/auth/email-evidence.js';
import { Injectable, Inject } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import { APP_CONFIG } from '../../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../../bootstrap/environment.js';
import {
  invitationChannels,
  invitationQuietUntil,
} from './invitation-preferences.js';
import { NotificationTransport } from '../application/transport.port.js';
/** Notifications keeps ownership of subscription secrets and recipient preferences. */
@Injectable()
export class EngagementDelivery {
  constructor(
    @Inject(SystemEmailEvidence) private readonly evidence: SystemEmailEvidence,
    @Inject(NotificationTransport)
    private readonly transport: NotificationTransport,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
  async policy(tx: Prisma.TransactionClient, userId: string, now: Date) {
    const channels = await invitationChannels(tx, userId, 'PERSONAL');
    return {
      channels: {
        IN_APP: channels.inApp,
        EMAIL: channels.email && this.config.NOTIFICATION_EMAIL_ENABLED,
        WEB_PUSH: channels.webPush && this.config.PUSH_MODE !== 'disabled',
      },
      quietUntil: await invitationQuietUntil(tx, userId, now),
    };
  }
  subscriptions(tx: Prisma.TransactionClient, userId: string) {
    return tx.pushSubscription.findMany({
      where: { ownerUserId: userId, state: 'ACTIVE' },
      select: { id: true, revision: true },
      take: 20,
      orderBy: { id: 'asc' },
    });
  }
  async send(
    tx: Prisma.TransactionClient,
    input: {
      emailCategory?: EmailCategory;
      id: string;
      communicationId: string;
      userId: string;
      channel: string;
      subscriptionId: string | null;
      subscriptionRevision: number | null;
      email: string;
      subject: string;
      body: string;
    },
  ) {
    if (input.channel === 'EMAIL' && !this.config.NOTIFICATION_EMAIL_ENABLED)
      return { outcome: 'FAILED' as const, code: 'EMAIL_DISABLED' };
    if (input.channel === 'EMAIL')
      return this.evidence.inTransaction(tx, () =>
        this.transport.send({
          deliveryId: input.id,
          notificationId: input.communicationId,
          channel: 'EMAIL',
          purpose: 'ADMIN',
          emailMetadata: {
            sourceKind:
              input.id === input.communicationId ? 'NOTICE' : 'COMMUNICATION',
            sourceId: input.id,
            userId: input.userId,
            category:
              input.emailCategory ??
              (input.id === input.communicationId
                ? 'SUPPORT'
                : 'COMMUNICATIONS'),
          },
          email: input.email,
          content: { subject: input.subject, text: input.body },
        }),
      );
    const sub = await tx.pushSubscription.findFirst({
      where: {
        id: input.subscriptionId!,
        ownerUserId: input.userId,
        state: 'ACTIVE',
        revision: input.subscriptionRevision!,
      },
    });
    if (!sub?.endpoint || !sub.auth || !sub.p256dh)
      return { outcome: 'FAILED' as const, code: 'SUBSCRIPTION_UNAVAILABLE' };
    const result = await this.transport.send({
      deliveryId: input.id,
      notificationId: input.communicationId,
      channel: 'WEB_PUSH',
      purpose: 'ADMIN',
      subscription: {
        endpoint: sub.endpoint,
        keys: { auth: sub.auth, p256dh: sub.p256dh },
      },
    });
    if (result.outcome === 'GONE')
      await tx.pushSubscription.updateMany({
        where: { id: sub.id, revision: sub.revision },
        data: {
          state: 'REVOKED',
          endpoint: null,
          auth: null,
          p256dh: null,
          revokedAt: new Date(),
          revision: { increment: 1 },
        },
      });
    return result;
  }
}
