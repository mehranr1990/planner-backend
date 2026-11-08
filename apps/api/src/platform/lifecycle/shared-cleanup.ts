import type { Prisma } from '../../generated/prisma/client.js';
export type SharedCleanupScope = {
  spaceId: string;
  /** Present only for a single domain source; absent retains the existing root-wide pass. */
  scopeId?: string;
  jobId: string;
  lockedUsers: readonly string[];
  verify: (tx: Prisma.TransactionClient) => void;
};
export type CleanupFile = { id: string; key: string; attempt: string | null };
type CleanupParents = Readonly<
  Record<string, { table: string; foreignKey: string }>
>;
const identifier = (value: string) => {
  if (!/^[A-Za-z][A-Za-z0-9]{0,79}$/.test(value))
    throw new Error('Invalid owned table');
  return '"' + value + '"';
};
/** Only owner facades pass their fixed table names. No HTTP-selected identifiers. */
export async function sharedDeleteBatch(
  tx: Prisma.TransactionClient,
  s: SharedCleanupScope,
  tables: readonly string[],
  parents: CleanupParents = {},
) {
  s.verify(tx);
  for (const table of tables) {
    identifier(table);
    const parent = parents[table];
    const scope = !s.scopeId
      ? ''
      : parent
        ? ` AND EXISTS(SELECT 1 FROM ${identifier(parent.table)} p WHERE p.id=t.${identifier(parent.foreignKey)} AND p."spaceId"=t."spaceId" AND p."scopeId"=$2::uuid)`
        : ' AND t."scopeId"=$2::uuid';
    const count = await tx.$executeRawUnsafe(
      `DELETE FROM "${table}" WHERE ctid IN (SELECT t.ctid FROM "${table}" t WHERE t."spaceId"=$1::uuid${scope} LIMIT 200)`,
      s.spaceId,
      ...(s.scopeId ? [s.scopeId] : []),
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
  const scope = s.scopeId
    ? ' AND v."scopeId"=$2::uuid AND r."scopeId"=$2::uuid'
    : '';
  const rootScope = s.scopeId ? ' AND "scopeId"=$2::uuid' : '';
  const args = s.scopeId ? [s.spaceId, s.scopeId] : [s.spaceId];
  const removed = await tx.$executeRawUnsafe(
    `DELETE FROM "${versions}" WHERE ctid IN (SELECT v.ctid FROM "${versions}" v JOIN "${root}" r ON r.id=v."${foreignKey}" WHERE v."spaceId"=$1::uuid${scope} AND v.version<>r."${current}" LIMIT 200)`,
    ...args,
  );
  if (removed) return false;
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
    `WITH victims AS (SELECT id FROM "${root}" WHERE "spaceId"=$1::uuid${rootScope} ORDER BY id LIMIT 25), versions AS (DELETE FROM "${versions}" WHERE "spaceId"=$1::uuid${rootScope} AND "${foreignKey}" IN (SELECT id FROM victims) RETURNING "${foreignKey}") DELETE FROM "${root}" WHERE id IN (SELECT id FROM victims) RETURNING id`,
    ...args,
  );
  return rows.length === 0;
}
