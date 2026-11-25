import type { Prisma } from '../../../generated/prisma/client.js';
import { SharedIdentity } from '../../../platform/auth/shared-identity.js';
import { notificationRecipientSettings } from '../../account/public/notification-settings.js';
export async function personalNotificationOwner(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  const user = await new SharedIdentity().current(tx, userId);
  const settings = await notificationRecipientSettings(tx, userId);
  if (!user?.emailVerified || settings.suspended) return null;
  const space = await tx.space.findFirst({
    where: { ownerUserId: userId, kind: 'PERSONAL', accessClosedAt: null },
    select: { id: true },
  });
  return space
    ? { spaceId: space.id, timezone: settings?.timezone ?? 'UTC' }
    : null;
}
export async function sharedNotificationModule(
  tx: Prisma.TransactionClient,
  scopeId: string,
) {
  const scope = await tx.accessScope.findUniqueOrThrow({
    where: { id: scopeId },
    select: { kind: true },
  });
  return scope.kind === 'TEAM'
    ? ('TEAMS' as const)
    : scope.kind === 'COMPANY'
      ? ('COMPANY' as const)
      : ('PROJECTS' as const);
}
/** Identity projection for an already-authorized notification audience only. */
export async function sharedNotificationUsers(
  tx: Prisma.TransactionClient,
  scopeId: string,
  members: { accessId: string; generation: number }[],
) {
  if (!members.length) return [];
  const scope = await tx.accessScope.findUniqueOrThrow({
    where: { id: scopeId },
    select: { spaceId: true },
  });
  const rows = await tx.contextAccess.findMany({
    where: {
      spaceId: scope.spaceId,
      state: 'ACTIVE',
      OR: members.map((m) => ({ id: m.accessId, generation: m.generation })),
    },
    include: { SharedActor: true },
  });
  return rows.flatMap((r) =>
    r.SharedActor.userId
      ? [
          {
            accessId: r.id,
            generation: r.generation,
            userId: r.SharedActor.userId,
          },
        ]
      : [],
  );
}
