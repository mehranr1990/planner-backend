import { ConflictException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';

const owned = [
  'Space',
  'SharedCustody',
  'AccessScope',
  'SharedActor',
  'ContextAccess',
  'ContextAccessInterval',
  'ContextCapabilityPolicy',
  'SharedAuditEvent',
  'SharedOutboxEvent',
  'SharedUsageEntry',
  'Team',
  'CompanyCustodyTransfer',
  'CompanyCustodyConsent',
];
const quoted = (s: string) => '"' + s.replaceAll('"', '""') + '"';
/** Metadata-only dependency fence. Unknown or later-module rows are never migrated implicitly. */
export async function assertTeamCustodyEligibility(
  tx: Prisma.TransactionClient,
  source: string,
) {
  const columns = await tx.$queryRaw<{ table: string; column: string }[]>`
    SELECT c.relname AS table,a.attname AS column FROM pg_class c
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    WHERE c.relnamespace=current_schema()::regnamespace AND c.relkind='r'
    AND a.atttypid='uuid'::regtype
    AND a.attname IN ('spaceId','scopeId','sourceSpaceId','teamId','custodyId','originCustodyId')
    AND NOT c.relname=ANY(${owned}::text[]) ORDER BY c.relname,a.attname`;
  for (const c of columns) {
    const [row] = await tx.$queryRawUnsafe<{ present: boolean }[]>(
      `SELECT EXISTS(SELECT 1 FROM ${quoted(c.table)} WHERE ${quoted(c.column)}=$1::uuid) present`,
      source,
    );
    if (row?.present)
      throw new ConflictException({
        code: 'TEAM_CUSTODY_DEPENDENCIES_UNSUPPORTED',
        dependency: c.table,
      });
  }
  // Also catch incoming typed references whose column name is not a scope locator.
  const references = await tx.$queryRaw<
    { table: string; column: string; target: string; key: string }[]
  >`
    SELECT child.relname AS table,ca.attname AS column,parent.relname AS target,pa.attname AS key
    FROM pg_constraint f JOIN pg_class child ON child.oid=f.conrelid JOIN pg_class parent ON parent.oid=f.confrelid
    JOIN LATERAL unnest(f.conkey,f.confkey) k(c,p) ON true
    JOIN pg_attribute ca ON ca.attrelid=child.oid AND ca.attnum=k.c
    JOIN pg_attribute pa ON pa.attrelid=parent.oid AND pa.attnum=k.p
    WHERE f.contype='f' AND child.relnamespace=current_schema()::regnamespace
    AND parent.relname IN ('Team','SharedActor','ContextAccess','SharedAuditEvent')
    AND pa.attname='id' AND NOT child.relname=ANY(${owned}::text[])`;
  for (const r of references) {
    const [row] = await tx.$queryRawUnsafe<{ present: boolean }[]>(
      `SELECT EXISTS(SELECT 1 FROM ${quoted(r.table)} c JOIN ${quoted(r.target)} p ON c.${quoted(r.column)}=p.${quoted(r.key)} WHERE p."spaceId"=$1::uuid) present`,
      source,
    );
    if (row?.present)
      throw new ConflictException({
        code: 'TEAM_CUSTODY_DEPENDENCIES_UNSUPPORTED',
        dependency: r.table,
      });
  }
}
