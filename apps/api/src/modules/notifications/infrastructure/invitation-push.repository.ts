import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import type { InvitationPushAttempt } from '../../../generated/prisma/client.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import { APP_CONFIG } from '../../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../../bootstrap/environment.js';
import { NotificationModuleSchema } from '@mehran/api-contracts';
import { NotificationTransport } from '../application/transport.port.js';
import { invitationChannels } from '../public/invitation-preferences.js';
import { personalNotificationOwner } from '../../spaces/public/notification-audience.js';
import { quietUntil } from '../domain/timing.js';
@Injectable()
export class InvitationPushDeliveries {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(NotificationTransport)
    private readonly transport: NotificationTransport,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
  async consume(validate: (attempt: InvitationPushAttempt) => Promise<void>) {
    const now = (
      await this.db.client.$queryRaw<
        { now: Date }[]
      >`SELECT clock_timestamp() now`
    )[0]!.now;
    const rows = await this.db.client.invitationPushAttempt.findMany({
      where: {
        OR: [
          { state: { in: ['PENDING', 'RETRY'] }, notBefore: { lte: now } },
          { state: 'PROCESSING', leaseUntil: { lt: now } },
        ],
      },
      orderBy: { notBefore: 'asc' },
      take: 20,
    });
    for (const row of rows) {
      if (row.state === 'PROCESSING') {
        await this.db.client.invitationPushAttempt.updateMany({
          where: { id: row.id, state: 'PROCESSING', leaseUntil: { lt: now } },
          data: {
            state: row.networkStartedAt ? 'AMBIGUOUS' : 'RETRY',
            leaseUntil: row.networkStartedAt ? row.leaseUntil : null,
          },
        });
        continue;
      }
      const leaseUntil = new Date(now.getTime() + 120000);
      const claim = await this.db.client.invitationPushAttempt.updateMany({
        where: {
          id: row.id,
          state: row.state,
          attempts: row.attempts,
          notBefore: { lte: now },
        },
        data: {
          state: 'PROCESSING',
          leaseUntil,
          networkStartedAt: null,
        },
      });
      if (!claim.count) continue;
      let network = false;
      try {
        await validate(row);
        const message = await this.db.client.$transaction(async (tx) => {
          const owner = await personalNotificationOwner(tx, row.userId);
          const prefs = await tx.notificationPreference.findFirst({
            where: { ownerUserId: row.userId },
          });
          const channels = await invitationChannels(
            tx,
            row.userId,
            NotificationModuleSchema.parse(row.module),
          );
          if (
            !owner ||
            !channels.webPush ||
            this.config.PUSH_MODE === 'disabled' ||
            (row.module === 'MESSAGING_MEETINGS' &&
              (!prefs?.messagingEnabledAt ||
                prefs.messagingEnabledAt >= row.eventAt))
          )
            return { state: 'CANCELED' as const };
          const sub = await tx.pushSubscription.findFirst({
            where: {
              id: row.subscriptionId,
              ownerUserId: row.userId,
              spaceId: owner.spaceId,
              revision: row.subscriptionRevision,
              state: 'ACTIVE',
            },
          });
          if (!sub?.endpoint || !sub.auth || !sub.p256dh)
            return { state: 'CANCELED' as const };
          const quiet = quietUntil(
            now,
            owner.timezone,
            prefs?.quietStart ?? null,
            prefs?.quietEnd ?? null,
            false,
          );
          if (quiet && quiet > now)
            return { state: 'RETRY' as const, notBefore: quiet };
          return {
            state: 'SEND' as const,
            subscription: {
              endpoint: sub.endpoint,
              keys: { auth: sub.auth, p256dh: sub.p256dh },
            },
          };
        });
        if (message.state !== 'SEND') {
          await this.db.client.invitationPushAttempt.updateMany({
            where: { id: row.id, state: 'PROCESSING', leaseUntil },
            data: {
              state: message.state,
              leaseUntil: null,
              ...(message.state === 'RETRY'
                ? { notBefore: message.notBefore }
                : {}),
            },
          });
          continue;
        }
        const started = await this.db.client.$executeRaw`
          UPDATE "InvitationPushAttempt" SET "networkStartedAt"=clock_timestamp(), attempts=attempts+1
          WHERE id=${row.id}::uuid AND state='PROCESSING' AND "leaseUntil"=${leaseUntil}
          AND "leaseUntil">clock_timestamp() AND "networkStartedAt" IS NULL AND attempts=${row.attempts}`;
        if (!started) continue;
        network = true;
        const result = await this.transport.send({
          deliveryId: row.id,
          notificationId:
            row.contextInvitationId ??
            row.conversationInvitationId ??
            row.meetingInvitationId!,
          purpose: 'INVITATION',
          channel: 'WEB_PUSH',
          subscription: message.subscription,
        });
        const state =
          result.outcome === 'ACCEPTED'
            ? 'DELIVERED'
            : result.outcome === 'RETRY' && row.attempts < 4
              ? 'RETRY'
              : result.outcome === 'AMBIGUOUS'
                ? 'AMBIGUOUS'
                : 'FAILED';
        await this.db.client.invitationPushAttempt.updateMany({
          where: {
            id: row.id,
            state: { in: ['PROCESSING', 'AMBIGUOUS'] },
            leaseUntil,
          },
          data: {
            state,
            leaseUntil: null,
            notBefore: new Date(Date.now() + 60000 * 2 ** row.attempts),
          },
        });
        if (result.outcome === 'GONE')
          await this.db.client.pushSubscription.updateMany({
            where: {
              id: row.subscriptionId,
              ownerUserId: row.userId,
              revision: row.subscriptionRevision,
              state: 'ACTIVE',
            },
            data: {
              state: 'REVOKED',
              endpoint: null,
              auth: null,
              p256dh: null,
              revokedAt: now,
              revision: { increment: 1 },
            },
          });
      } catch (error) {
        const permanent =
          error instanceof NotFoundException ||
          error instanceof ForbiddenException ||
          error instanceof ConflictException;
        await this.db.client.invitationPushAttempt.updateMany({
          where: { id: row.id, state: 'PROCESSING', leaseUntil },
          data: {
            state: network
              ? 'AMBIGUOUS'
              : permanent
                ? 'CANCELED'
                : row.attempts < 4
                  ? 'RETRY'
                  : 'FAILED',
            leaseUntil: null,
            ...(!network && !permanent ? { attempts: { increment: 1 } } : {}),
            notBefore: new Date(Date.now() + 60000 * 2 ** row.attempts),
          },
        });
      }
    }
    return rows.length > 0;
  }
}
