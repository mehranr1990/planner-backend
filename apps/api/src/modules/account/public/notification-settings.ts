import type { Prisma } from '../../../generated/prisma/client.js';
import { effectiveSuspension } from '../../../platform/admin/management-policy.js';
/** Settings-only projection for an already selected notification recipient. */
export async function notificationRecipientSettings(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  const settings = await tx.userSettings.findUnique({
    where: { userId },
    select: { timezone: true, suspendedAt: true, suspensionExpiresAt: true },
  });
  return {
    timezone: settings?.timezone ?? 'UTC',
    suspended: settings ? effectiveSuspension(settings) : false,
  };
}
