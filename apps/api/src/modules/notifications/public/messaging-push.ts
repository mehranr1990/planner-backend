import {
  Inject,
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  Module,
} from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import { DatabaseModule } from '../../../platform/database/database.module.js';
import { APP_CONFIG } from '../../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../../bootstrap/environment.js';
import { NotificationTransport } from '../application/transport.port.js';
import type { TransportMessage } from '../application/transport.port.js';
import { ChannelTransport } from '../infrastructure/transport.js';
import { quietUntil, retryAt } from '../domain/timing.js';
import {
  SpacesModule,
  SpacesService,
  SharedKernel,
} from '../../spaces/public/index.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { idempotent } from '../../../platform/database/idempotency.js';
import { writeAudit } from '../../../platform/audit/audit.service.js';
export type MessagingPushOwner = {
  spaceId: string;
  userId: string;
  timezone: string;
  verify: (tx: Prisma.TransactionClient) => void;
};
/** Notifications owns subscriptions, preferences, transport secrets and retry timing. */
@Injectable()
export class MessagingPush {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(NotificationTransport)
    private readonly transport: NotificationTransport,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SpacesService) private readonly spaces: SpacesService,
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
  ) {}
  async settings(actor: RequestActor) {
    const scope = await this.spaces.authorizePersonal(actor);
    return this.kernel.personalWork(actor, async (tx) => {
      const p = await this.preferences(tx, {
        spaceId: scope.spaceId,
        userId: actor.userId,
        timezone: 'UTC',
        verify: (current) => {
          if (current !== tx) throw new NotFoundException();
        },
      });
      return {
        enabled: p.messagingWebPush,
        revision: p.revision,
        serverAvailable: p.available,
        globalWebPush: p.webPush,
      };
    });
  }
  async setConsent(
    actor: RequestActor,
    enabled: boolean,
    revision: number,
    key: string,
  ) {
    const scope = await this.spaces.authorizePersonal(actor);
    await idempotent(
      this.db.client,
      scope,
      'messaging.push.optin',
      key,
      { enabled, revision },
      async (tx) => {
        await this.consent(
          tx,
          {
            spaceId: scope.spaceId,
            userId: actor.userId,
            timezone: 'UTC',
            verify: (current) => {
              if (current !== tx) throw new NotFoundException();
            },
          },
          enabled,
          revision,
          (
            await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() now`
          )[0]!.now,
        );
        await writeAudit(tx, {
          action: 'NOTIFICATION_PREFERENCE_CHANGE',
          outcome: 'SUCCEEDED',
          actorUserId: actor.userId,
          requestId: actor.requestId,
          correlationId: actor.correlationId,
          resourceId: scope.spaceId,
        });
        return { resultId: scope.spaceId, statusCode: 200 };
      },
      (tx) => this.kernel.personalIdentity(tx, actor),
    );
    return this.settings(actor);
  }
  async preferences(tx: Prisma.TransactionClient, owner: MessagingPushOwner) {
    owner.verify(tx);
    const p = await tx.notificationPreference.findUnique({
      where: { spaceId: owner.spaceId },
    });
    return {
      inApp: p?.inApp ?? true,
      webPush: p?.webPush ?? false,
      messagingWebPush: p?.messagingWebPush ?? false,
      enabledAt: p?.messagingEnabledAt ?? null,
      quietStart: p?.quietStart ?? null,
      quietEnd: p?.quietEnd ?? null,
      revision: p?.revision ?? 1,
      available: this.config.PUSH_MODE !== 'disabled',
    };
  }
  async consent(
    tx: Prisma.TransactionClient,
    owner: MessagingPushOwner,
    enabled: boolean,
    revision: number,
    now: Date,
  ) {
    const old = await this.preferences(tx, owner);
    if (old.revision !== revision)
      throw new ConflictException({ code: 'REVISION_CONFLICT' });
    if (enabled && !old.available)
      throw new BadRequestException({ code: 'PUSH_UNAVAILABLE' });
    const existing = await tx.notificationPreference.findUnique({
      where: { spaceId: owner.spaceId },
    });
    const data = {
      messagingWebPush: enabled,
      messagingEnabledAt: enabled
        ? old.messagingWebPush
          ? old.enabledAt
          : // Round above the persisted millisecond: equal/earlier events fail closed.
            new Date(now.getTime() + 1)
        : null,
    };
    if (existing)
      await tx.notificationPreference.update({
        where: { id: existing.id },
        data: { ...data, revision: { increment: 1 } },
      });
    else
      await tx.notificationPreference.create({
        data: {
          spaceId: owner.spaceId,
          ownerUserId: owner.userId,
          createdByUserId: owner.userId,
          ...data,
          revision: 2,
        },
      });
    return this.preferences(tx, owner);
  }
  async subscriptions(
    tx: Prisma.TransactionClient,
    owner: MessagingPushOwner,
    createdBefore: Date,
  ) {
    owner.verify(tx);
    return tx.pushSubscription.findMany({
      where: {
        spaceId: owner.spaceId,
        ownerUserId: owner.userId,
        state: 'ACTIVE',
        createdAt: { lt: new Date(createdBefore.getTime() - 1) },
        updatedAt: { lt: new Date(createdBefore.getTime() - 1) },
      },
      select: { id: true, revision: true },
      orderBy: { id: 'asc' },
      take: 20,
    });
  }
  async ticket(
    tx: Prisma.TransactionClient,
    owner: MessagingPushOwner,
    id: string,
    revision: number,
  ) {
    owner.verify(tx);
    await tx.$queryRaw`SELECT id FROM "PushSubscription" WHERE id=${id}::uuid AND "spaceId"=${owner.spaceId}::uuid FOR UPDATE`;
    const row = await tx.pushSubscription.findFirst({
      where: {
        id,
        spaceId: owner.spaceId,
        ownerUserId: owner.userId,
        state: 'ACTIVE',
        revision,
      },
    });
    if (!row?.endpoint || !row.auth || !row.p256dh)
      throw new NotFoundException();
    return {
      id: row.id,
      revision: row.revision,
      spaceId: row.spaceId,
      subscription: {
        endpoint: row.endpoint,
        keys: { auth: row.auth, p256dh: row.p256dh },
      },
    };
  }
  send(
    deliveryId: string,
    notificationId: string,
    subscription: NonNullable<TransportMessage['subscription']>,
  ) {
    return this.transport.send({
      deliveryId,
      notificationId,
      subscription,
      channel: 'WEB_PUSH',
      purpose: 'MESSAGING',
    });
  }
  async gone(ticket: { id: string; revision: number; spaceId: string }) {
    await this.db.client.pushSubscription.updateMany({
      where: {
        id: ticket.id,
        spaceId: ticket.spaceId,
        revision: ticket.revision,
        state: 'ACTIVE',
      },
      data: {
        state: 'REVOKED',
        endpoint: null,
        auth: null,
        p256dh: null,
        revokedAt: new Date(),
        revision: { increment: 1 },
      },
    });
  }
  quiet(
    now: Date,
    zone: string,
    start: string | null,
    end: string | null,
    mentionBypass: boolean,
  ) {
    return quietUntil(now, zone, start, end, mentionBypass);
  }
  retry(now: Date, attempts: number) {
    return retryAt(now, attempts);
  }
}
@Module({
  imports: [DatabaseModule, SpacesModule],
  providers: [
    { provide: NotificationTransport, useClass: ChannelTransport },
    MessagingPush,
  ],
  exports: [NotificationTransport, MessagingPush],
})
export class NotificationChannelModule {}
