import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { NotificationIdentity } from '../public/notification-identity.js';
@Injectable()
export class NotificationIdentityRepository extends NotificationIdentity {
  async read(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    const user = await tx.user.findUnique({
      where: { id: scope.actor.userId },
      select: { email: true, emailVerified: true },
    });
    if (!user?.emailVerified) return null;
    const settings = await tx.userSettings.findUnique({
      where: { userId: scope.actor.userId },
      select: { timezone: true },
    });
    return settings ? { email: user.email, timezone: settings.timezone } : null;
  }
}
