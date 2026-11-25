import type { Prisma } from '../../../generated/prisma/client.js';
/** Internal cleanup metadata only. Account retains ownership of export state. */
export async function protectsAccountExportKey(
  tx: Prisma.TransactionClient,
  key: string,
): Promise<boolean> {
  return (
    (await tx.userExportJob.count({
      where: {
        OR: [
          { objectKey: key },
          { attemptKey: key },
          { artifactKeys: { has: key } },
        ],
      },
    })) > 0
  );
}
