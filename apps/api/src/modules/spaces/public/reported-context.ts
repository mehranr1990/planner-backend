import type { Prisma } from '../../../generated/prisma/client.js';
import type { SharedKernel } from './index.js';
import { NotFoundException } from '@nestjs/common';
/** Owner-side availability for an already case-authorized exact source. */
export async function reportedContextAvailable(
  tx: Prisma.TransactionClient,
  spaceId: string,
  scopeId: string | null,
  kernel: SharedKernel,
) {
  const space = await tx.space.findUnique({
    where: { id: spaceId },
    select: { kind: true, accessClosedAt: true },
  });
  if (!space || space.accessClosedAt) throw new NotFoundException();
  if (space.kind === 'PERSONAL') {
    if (scopeId) throw new NotFoundException();
    return;
  }
  const [custody, scope, domain] = await Promise.all([
    tx.sharedCustody.findUnique({ where: { spaceId } }),
    tx.accessScope.findUnique({ where: { id: scopeId ?? '' } }),
    tx.domainScopeCustody.findFirst({
      where: { spaceId, scopeId: scopeId ?? '' },
    }),
  ]);
  if (
    !custody ||
    !scope ||
    scope.spaceId !== spaceId ||
    !['ACTIVE', 'ARCHIVED'].includes(custody.state) ||
    !['ACTIVE', 'ARCHIVED'].includes(scope.state) ||
    (domain && !['ACTIVE', 'ARCHIVED'].includes(domain.state))
  )
    throw new NotFoundException();
  if (custody.kind === 'COMPANY' && scope.id !== spaceId)
    await kernel.assertTeamParentAvailable(
      tx,
      spaceId,
      domain?.parentScopeId ?? scope.id,
      true,
    );
}
