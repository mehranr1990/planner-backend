import type { Prisma } from '../../../generated/prisma/client.js';
/** Authoritative production timer clock; a narrow seam for deterministic database tests. */
export async function readFocusClock(
  tx: Prisma.TransactionClient,
): Promise<Date> {
  const [row] = await tx.$queryRaw<
    Array<{ now: Date }>
  >`SELECT clock_timestamp() AS now`;
  if (!row) throw new Error('Clock unavailable');
  return row.now;
}
