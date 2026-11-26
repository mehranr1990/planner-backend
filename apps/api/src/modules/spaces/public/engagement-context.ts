import type { SharedKernel } from './index.js';
import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { effectiveSuspension } from '../../../platform/admin/management-policy.js';
/** Metadata-only projection. No content or membership mutation. */
export async function engagementContext(
  tx: Prisma.TransactionClient,
  actor: RequestActor,
  id: string,
) {
  const personal = await tx.space.findFirst({
    where: {
      id,
      kind: 'PERSONAL',
      ownerUserId: actor.userId,
      accessClosedAt: null,
    },
  });
  if (personal) return { spaceId: personal.id, scopeId: null };
  const scope = await tx.accessScope.findUnique({ where: { id } });
  if (!scope || !['ACTIVE', 'ARCHIVED'].includes(scope.state))
    throw new NotFoundException();
  const seat = await tx.contextAccess.findFirst({
    where: {
      scopeId: id,
      state: 'ACTIVE',
      SharedActor: { userId: actor.userId, state: 'ACTIVE' },
    },
  });
  const space = await tx.space.findUnique({ where: { id: scope.spaceId } });
  const custody = await tx.sharedCustody.findUnique({
    where: { spaceId: scope.spaceId },
  });
  if (
    !seat ||
    !space ||
    space.accessClosedAt ||
    !custody ||
    !['ACTIVE', 'ARCHIVED'].includes(custody.state)
  )
    throw new NotFoundException();
  return { spaceId: space.id, scopeId: id };
}
export async function engagementWorkspaceAudience(
  tx: Prisma.TransactionClient,
  id: string,
  kernel: SharedKernel,
  userId?: string,
) {
  const scope = await tx.accessScope.findUnique({ where: { id } });
  if (
    !scope ||
    !['ACTIVE', 'ARCHIVED'].includes(scope.state) ||
    effectiveSuspension(scope)
  )
    throw new NotFoundException();
  const [custody, space, domain] = await Promise.all([
    tx.sharedCustody.findUnique({ where: { spaceId: scope.spaceId } }),
    tx.space.findUnique({ where: { id: scope.spaceId } }),
    tx.domainScopeCustody.findFirst({
      where: { spaceId: scope.spaceId, scopeId: id },
    }),
  ]);
  if (
    !custody ||
    !space ||
    space.accessClosedAt ||
    effectiveSuspension(space) ||
    !['ACTIVE', 'ARCHIVED'].includes(custody.state) ||
    (domain && !['ACTIVE', 'ARCHIVED'].includes(domain.state))
  )
    throw new NotFoundException();
  if (custody.kind === 'COMPANY' && id !== space.id)
    await kernel.assertTeamParentAvailable(
      tx,
      space.id,
      domain?.parentScopeId ?? id,
      true,
    );
  const rows = await tx.contextAccess.findMany({
    where: {
      scopeId: id,
      state: 'ACTIVE',
      memberRole: { not: null },
      SharedActor: {
        state: 'ACTIVE',
        ...(userId ? { userId } : { userId: { not: null } }),
      },
    },
    select: {
      id: true,
      generation: true,
      SharedActor: { select: { userId: true } },
    },
    take: 1001,
    orderBy: { id: 'asc' },
  });
  let permitted = new Set(rows.map((r) => r.id));
  if (custody.kind === 'COMPANY' && id !== space.id) {
    const admissions = await tx.companyContextAdmission.findMany({
      where: {
        scopeId: id,
        OR: rows.map((r) => ({ accessId: r.id, generation: r.generation })),
      },
      include: { Root: { select: { state: true, generation: true } } },
    });
    permitted = new Set(
      admissions
        .filter(
          (r) =>
            r.Root.state === 'ACTIVE' && r.Root.generation === r.rootGeneration,
        )
        .map((r) => r.accessId),
    );
  }
  return [
    ...new Set(
      rows
        .filter((r) => permitted.has(r.id))
        .flatMap((r) => (r.SharedActor.userId ? [r.SharedActor.userId] : [])),
    ),
  ];
}
