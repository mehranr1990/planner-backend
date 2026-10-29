import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { ExportBudget } from '../../../platform/lifecycle/personal-data.js';
import { NotificationsData } from '../public/personal-data.js';
@Injectable()
export class NotificationsDataRepository extends NotificationsData {
  override async suspend(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    await tx.notificationDelivery.updateMany({
      where: {
        spaceId: scope.spaceId,
        state: { in: ['PENDING', 'QUEUED', 'RETRY', 'SENDING'] },
      },
      data: {
        state: 'CANCELED',
        reason: 'ACCOUNT_CLOSED',
        canceledAt: new Date(),
      },
    });
  }
  async snapshot(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    budget: ExportBudget,
  ) {
    await budget.collect(
      'reminder',
      (after: string | undefined) =>
        tx.reminder.findMany({
          where: {
            spaceId: scope.spaceId,
            ...(after ? { id: { gt: after } } : {}),
          },
          orderBy: { id: 'asc' },
          take: 100,
        }),
      (row) => row.id,
    );
    await budget.collect(
      'notification',
      (after: string | undefined) =>
        tx.notification.findMany({
          where: {
            spaceId: scope.spaceId,
            ...(after ? { id: { gt: after } } : {}),
          },
          orderBy: { id: 'asc' },
          take: 100,
        }),
      (row) => row.id,
    );
    await budget.collect(
      'notificationDelivery',
      (after: string | undefined) =>
        tx.notificationDelivery.findMany({
          where: {
            spaceId: scope.spaceId,
            ...(after ? { id: { gt: after } } : {}),
          },
          orderBy: { id: 'asc' },
          take: 100,
          omit: { leaseToken: true, jobId: true },
        }),
      (row) => row.id,
    );
    await budget.collect(
      'notificationPreference',
      (after: string | undefined) =>
        tx.notificationPreference.findMany({
          where: {
            spaceId: scope.spaceId,
            ...(after ? { id: { gt: after } } : {}),
          },
          orderBy: { id: 'asc' },
          take: 100,
        }),
      (row) => row.id,
    );
    await budget.collect(
      'pushSubscription',
      (after: string | undefined) =>
        tx.pushSubscription.findMany({
          where: {
            spaceId: scope.spaceId,
            ...(after ? { id: { gt: after } } : {}),
          },
          orderBy: { id: 'asc' },
          take: 100,
          omit: {
            endpoint: true,
            endpointHash: true,
            auth: true,
            p256dh: true,
          },
        }),
      (row) => row.id,
    );
  }
  async erase(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    const where = { spaceId: scope.spaceId };
    await tx.notificationDelivery.updateMany({
      where,
      data: { sourceDeliveryId: null },
    });
    await tx.notificationDelivery.updateMany({
      where,
      data: { sourceNotificationId: null },
    });
    await tx.notificationDelivery.updateMany({
      where,
      data: { notificationId: null },
    });
    await tx.notification.updateMany({
      where,
      data: { sourceNotificationId: null },
    });
    await tx.notificationDelivery.deleteMany({ where });
    await tx.notification.deleteMany({ where });
    await tx.reminder.deleteMany({ where });
    await tx.pushSubscription.deleteMany({ where });
    await tx.notificationPreference.deleteMany({ where });
  }
}
