import type { Prisma } from '../../../generated/prisma/client.js';
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
