import type { Prisma } from '../../../generated/prisma/client.js';
import type { SharedKernel } from './index.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { NotFoundException } from '@nestjs/common';
export async function withEngagementContext<T>(
  tx: Prisma.TransactionClient,
  kernel: SharedKernel,
  actor: RequestActor,
  id: string,
  work: (inside?: Prisma.TransactionClient) => Promise<T>,
) {
  const personal = await tx.space.findFirst({
    where: {
      id,
      kind: 'PERSONAL',
      ownerUserId: actor.userId,
      accessClosedAt: null,
    },
    select: { id: true },
  });
  if (personal) return work();
  const scope = await tx.accessScope.findUnique({
    where: { id },
    select: { spaceId: true, id: true },
  });
  if (!scope) throw new NotFoundException();
  return kernel.run(
    actor,
    { userIds: [], spaceIds: [scope.spaceId] },
    [
      {
        spaceId: scope.spaceId,
        scopeId: scope.id,
        capability: 'task.read',
        allowArchived: true,
      },
    ],
    (inside) => work(inside),
  );
}
export async function engagementPersonalOpen(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  return !!(await tx.space.findFirst({
    where: { ownerUserId: userId, kind: 'PERSONAL', accessClosedAt: null },
    select: { id: true },
  }));
}

export async function lockEngagementPersonal(
  tx: Prisma.TransactionClient,
  userId: string,
  requireOpen = true,
) {
  const hint = await tx.space.findFirst({
    where: { ownerUserId: userId, kind: 'PERSONAL' },
    select: { id: true },
  });
  if (!hint) {
    if (requireOpen) throw new NotFoundException();
    return false;
  }
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'personal-access:' + hint.id},0))::text`;
  const open = !!(await tx.space.findFirst({
    where: { id: hint.id, ownerUserId: userId, accessClosedAt: null },
  }));
  if (!open && requireOpen) throw new NotFoundException();
  return open;
}
