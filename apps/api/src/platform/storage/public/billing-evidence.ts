import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
/** Metadata-only reference validation; never grants bytes or private-file authority. */
export async function assertBillingEvidence(
  tx: Prisma.TransactionClient,
  id: string,
  spaceId: string | null,
  scopeId: string | null,
) {
  const file = await tx.storedFile.findFirst({
    where: { id, spaceId: spaceId ?? '', scopeId, status: 'READY' },
  });
  if (!file) throw new NotFoundException({ code: 'EVIDENCE_UNAVAILABLE' });
  const scan = await tx.storedFileScan.findUnique({ where: { fileId: id } });
  if (!scan || scan.sha256 !== file.sha256)
    throw new NotFoundException({ code: 'EVIDENCE_UNAVAILABLE' });
}
