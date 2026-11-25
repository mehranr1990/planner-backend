import type { Prisma } from '../../../generated/prisma/client.js';
import type { RecipientInvitationAuthority } from '../../spaces/public/recipient-invitation-authority.js';
/** Name-only projection for a Company offer already authorized by CompanyAccess. */
export async function companyInvitationDisplay(
  tx: Prisma.TransactionClient,
  authority: RecipientInvitationAuthority,
) {
  const offer = authority.require(tx);
  const scopeId = offer.companyScopeId ?? offer.spaceId;
  if (scopeId === offer.spaceId)
    return (
      await tx.company.findUniqueOrThrow({
        where: { id: offer.spaceId },
        select: { title: true },
      })
    ).title;
  const department = await tx.companyDepartment.findFirst({
    where: { spaceId: offer.spaceId, id: scopeId },
    select: { title: true },
  });
  return (
    department?.title ??
    (
      await tx.companyUnit.findFirstOrThrow({
        where: { spaceId: offer.spaceId, id: scopeId },
        select: { title: true },
      })
    ).title
  );
}
