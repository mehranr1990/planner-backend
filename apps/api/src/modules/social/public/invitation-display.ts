import type { Prisma } from '../../../generated/prisma/client.js';
import type { RecipientInvitationAuthority } from '../../spaces/public/recipient-invitation-authority.js';
/** Name-only projection for an offer with current recipient/contact authorization. */
export async function socialInvitationDisplay(
  tx: Prisma.TransactionClient,
  authority: RecipientInvitationAuthority,
) {
  const offer = authority.require(tx);
  return (
    await tx.socialGroup.findUniqueOrThrow({
      where: { id: offer.scopeId },
      select: { name: true },
    })
  ).name;
}
