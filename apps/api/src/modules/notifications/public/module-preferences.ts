import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client.js';
import { sharedNotificationUsers } from '../../spaces/public/index.js';
type Module = z.infer<typeof c.NotificationModuleSchema>;
type Channel = z.infer<typeof c.NotificationChannelSchema>;
export function moduleChannelEnabled(
  value: unknown,
  module: Module,
  channel: Channel,
): boolean {
  const parsed = c.ModuleNotificationPreferencesSchema.safeParse(value);
  return parsed.success && (parsed.data[module]?.[channel] ?? true);
}
export function moduleChannelView(value: unknown) {
  return Object.fromEntries(
    c.NotificationModuleSchema.options.map((module) => [
      module,
      Object.fromEntries(
        c.NotificationChannelSchema.options.map((channel) => [
          channel,
          moduleChannelEnabled(value, module, channel),
        ]),
      ),
    ]),
  );
}
/** Filters already-authorized recipients; never grants access or discovers accounts. */
export async function filterModuleNotificationUsers(
  tx: Prisma.TransactionClient,
  users: string[],
  module: Module,
) {
  const preferences = await tx.notificationPreference.findMany({
    where: { ownerUserId: { in: users } },
    select: { ownerUserId: true, inApp: true, moduleChannels: true },
  });
  const disabled = new Set(
    preferences
      .filter(
        (p) =>
          !p.inApp || !moduleChannelEnabled(p.moduleChannels, module, 'IN_APP'),
      )
      .map((p) => p.ownerUserId),
  );
  return users.filter((user) => !disabled.has(user));
}
export async function filterModuleNotificationMembers<
  T extends { accessId: string; generation: number },
>(tx: Prisma.TransactionClient, scopeId: string, members: T[], module: Module) {
  const users = await sharedNotificationUsers(tx, scopeId, members);
  const allowed = new Set(
    await filterModuleNotificationUsers(
      tx,
      users.map((u) => u.userId),
      module,
    ),
  );
  const accesses = new Set(
    users
      .filter((u) => allowed.has(u.userId))
      .map((u) => u.accessId + ':' + u.generation),
  );
  return members.filter((m) => accesses.has(m.accessId + ':' + m.generation));
}
