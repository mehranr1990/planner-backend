import { ModuleNotificationPreferencesSchema } from '@mehran/api-contracts';
import type { NotificationModuleSchema } from '@mehran/api-contracts';
import type { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client.js';
import { notificationRecipientSettings } from '../../account/public/notification-settings.js';
import { quietUntil } from '../domain/timing.js';

export async function invitationQuietUntil(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date,
) {
  const p = await tx.notificationPreference.findFirst({
    where: { ownerUserId: userId },
    select: { quietStart: true, quietEnd: true },
  });
  const settings = await notificationRecipientSettings(tx, userId);
  return quietUntil(
    now,
    settings.timezone,
    p?.quietStart ?? null,
    p?.quietEnd ?? null,
    false,
  );
}

/** Read-only recipient channel policy. No directory lookup or admission authority. */
export async function invitationChannels(
  tx: Prisma.TransactionClient,
  userId: string,
  module: z.infer<typeof NotificationModuleSchema>,
) {
  const p = await tx.notificationPreference.findFirst({
    where: { ownerUserId: userId },
  });
  const matrix = ModuleNotificationPreferencesSchema.safeParse(
    p?.moduleChannels ?? {},
  );
  const enabled = (channel: 'IN_APP' | 'EMAIL' | 'WEB_PUSH') =>
    matrix.success && (matrix.data[module]?.[channel] ?? true);
  return {
    inApp: (p?.inApp ?? true) && enabled('IN_APP'),
    email: (p?.email ?? false) && enabled('EMAIL'),
    webPush:
      (p?.webPush ?? false) &&
      enabled('WEB_PUSH') &&
      (module !== 'MESSAGING_MEETINGS' || (p?.messagingWebPush ?? false)),
  };
}
