import type { Prisma } from '../../../generated/prisma/client.js';
import type { RecipientInvitationAuthority } from '../../spaces/public/recipient-invitation-authority.js';
/** Name-only projection for an offer authorized by Spaces in this transaction. */
export async function projectInvitationDisplay(
  tx: Prisma.TransactionClient,
  authority: RecipientInvitationAuthority,
) {
  const offer = authority.require(tx);
  return (
    await tx.project.findUniqueOrThrow({
      where: { id: offer.scopeId },
      select: { title: true },
    })
  ).title;
}
