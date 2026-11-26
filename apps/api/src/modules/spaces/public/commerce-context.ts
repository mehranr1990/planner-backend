import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import {
  engagementContext,
  engagementWorkspaceAudience,
} from './engagement-context.js';
import type { SharedKernel } from './index.js';
export async function commerceScope(
  tx: Prisma.TransactionClient,
  selector: string,
  actor?: RequestActor,
  kernel?: SharedKernel,
) {
  const personal = await tx.space.findFirst({
    where: { id: selector, kind: 'PERSONAL', accessClosedAt: null },
  });
  if (personal) {
    if (actor && personal.ownerUserId !== actor.userId)
      throw new NotFoundException();
    return {
      spaceId: personal.id,
      scopeId: null,
      kind: 'PERSONAL' as const,
      owner: !actor || personal.ownerUserId === actor.userId,
      seats: 1,
      ownerUserId: personal.ownerUserId,
    };
  }
  const scope = await tx.accessScope.findUnique({ where: { id: selector } });
  const custody =
    scope &&
    (await tx.sharedCustody.findUnique({ where: { spaceId: scope.spaceId } }));
  const space =
    scope && (await tx.space.findUnique({ where: { id: scope.spaceId } }));
  const domain =
    scope &&
    (await tx.domainScopeCustody.findUnique({ where: { scopeId: scope.id } }));
  const kind =
    domain?.kind ??
    (scope?.id === scope?.spaceId ? custody?.kind : scope?.kind);
  if (
    !scope ||
    !custody ||
    !space ||
    space.accessClosedAt ||
    !['TEAM', 'COMPANY'].includes(kind ?? '') ||
    !['ACTIVE', 'ARCHIVED'].includes(scope.state) ||
    !['ACTIVE', 'ARCHIVED'].includes(custody.state) ||
    (domain && !['ACTIVE', 'ARCHIVED'].includes(domain.state))
  )
    throw new NotFoundException();
  if (actor) {
    await engagementContext(tx, actor, selector);
    if (
      !kernel ||
      !(
        await engagementWorkspaceAudience(tx, selector, kernel, actor.userId)
      ).includes(actor.userId)
    )
      throw new NotFoundException();
  }
  const ownerId = domain?.primaryOwnerAccessId ?? custody.primaryOwnerAccessId;
  const owner =
    ownerId &&
    (await tx.contextAccess.findUnique({
      where: { id: ownerId },
      include: { SharedActor: { select: { userId: true, state: true } } },
    }));
  if (
    !owner ||
    owner.state !== 'ACTIVE' ||
    owner.SharedActor.state !== 'ACTIVE'
  )
    throw new NotFoundException();
  const seats = await tx.contextAccess.count({
    where: {
      scopeId: scope.id,
      state: 'ACTIVE',
      memberRole: { not: null },
      SharedActor: { state: 'ACTIVE' },
    },
  });
  return {
    spaceId: scope.spaceId,
    scopeId: scope.id,
    kind: kind as 'TEAM' | 'COMPANY',
    owner: !actor || owner.SharedActor.userId === actor.userId,
    seats,
    ownerUserId: owner.SharedActor.userId,
  };
}
