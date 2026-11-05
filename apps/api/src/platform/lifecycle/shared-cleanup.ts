import type { Prisma } from '../../generated/prisma/client.js';
export type SharedCleanupScope = {
  spaceId: string;
  jobId: string;
  lockedUsers: readonly string[];
  verify: (tx: Prisma.TransactionClient) => void;
};
export type CleanupFile = { id: string; key: string; attempt: string | null };
/** Only owner facades pass their fixed table names. No HTTP-selected identifiers. */
export async function sharedDeleteBatch(
  tx: Prisma.TransactionClient,
  s: SharedCleanupScope,
  tables: readonly string[],
) {
  s.verify(tx);
  for (const table of tables) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,79}$/.test(table))
      throw new Error('Invalid owned table');
    const count = await tx.$executeRawUnsafe(
      `DELETE FROM "${table}" WHERE ctid IN (SELECT ctid FROM "${table}" WHERE "spaceId"=$1::uuid LIMIT 200)`,
      s.spaceId,
    );
    if (count) return false;
  }
  return true;
}
/** Published current-version cycles are removed together after bounded historical passes. */
export async function sharedVersionedDelete(
  tx: Prisma.TransactionClient,
  s: SharedCleanupScope,
  root: string,
  versions: string,
  foreignKey: string,
  current = 'currentVersion',
) {
  s.verify(tx);
  for (const name of [root, versions, foreignKey, current])
    if (!/^[A-Za-z][A-Za-z0-9]{0,79}$/.test(name))
      throw new Error('Invalid owned version table');
  const removed = await tx.$executeRawUnsafe(
    `DELETE FROM "${versions}" WHERE ctid IN (SELECT v.ctid FROM "${versions}" v JOIN "${root}" r ON r.id=v."${foreignKey}" WHERE v."spaceId"=$1::uuid AND v.version<>r."${current}" LIMIT 200)`,
    s.spaceId,
  );
  if (removed) return false;
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
    `WITH victims AS (SELECT id FROM "${root}" WHERE "spaceId"=$1::uuid ORDER BY id LIMIT 25), versions AS (DELETE FROM "${versions}" WHERE "spaceId"=$1::uuid AND "${foreignKey}" IN (SELECT id FROM victims) RETURNING "${foreignKey}") DELETE FROM "${root}" WHERE id IN (SELECT id FROM victims) RETURNING id`,
    s.spaceId,
  );
  return rows.length === 0;
}
