import type { Prisma } from '../../../generated/prisma/client.js';
export async function protectsEngagementEvidence(
  tx: Prisma.TransactionClient,
  key: string,
) {
  return !!(await tx.p4Evidence.findUnique({
    where: { objectKey: key },
    select: { id: true },
  }));
}
