import { ConflictException, PayloadTooLargeException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';

/** Issued inside the source/destination fence; never constructed from HTTP input. */
export type CustodyGraphScope = Readonly<{
  sourceSpaceId: string;
  destinationSpaceId: string;
  transferId: string;
  verify: (tx: Prisma.TransactionClient, moving: boolean) => void;
}>;
/** A module supplies only its own fixed table/column identifiers. */
export type CustodyGraphTable = Readonly<{
  table: string;
  select: readonly string[];
  move: readonly string[];
  via?: Readonly<{
    parent: string;
    foreignKey: string;
    parentKey: string;
    parentSpace: string;
  }>;
}>;
export type CustodyGraphPart = Readonly<{
  table: string;
  select: readonly string[];
  move: readonly string[];
  via?: CustodyGraphTable['via'];
  rows: ReadonlyArray<{ key: Prisma.JsonObject; digest: string }>;
}>;
const identifier = (value: string) => {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(value))
    throw new Error('Invalid owned graph identifier');
  return '"' + value + '"';
};
function predicate(spec: CustodyGraphTable) {
  const terms = spec.select.map((c) => 't.' + identifier(c) + '=$1::uuid');
  if (spec.via) {
    const v = spec.via;
    terms.push(
      `EXISTS(SELECT 1 FROM ${identifier(v.parent)} p WHERE p.${identifier(v.parentKey)}=t.${identifier(v.foreignKey)} AND p.${identifier(v.parentSpace)}=$1::uuid)`,
    );
  }
  if (!terms.length) throw new Error('Owned graph selector required');
  return '(' + terms.join(' OR ') + ')';
}
/** Hash in PostgreSQL: private bodies never enter the coordination manifest. */
export async function snapshotCustodyGraph(
  tx: Prisma.TransactionClient,
  scope: CustodyGraphScope,
  tables: readonly CustodyGraphTable[],
): Promise<CustodyGraphPart[]> {
  scope.verify(tx, false);
  const parts: CustodyGraphPart[] = [];
  for (const spec of tables) {
    identifier(spec.table);
    for (const c of [...spec.select, ...spec.move]) identifier(c);
    const keys = await tx.$queryRawUnsafe<{ name: string }[]>(
      `SELECT a.attname name FROM pg_index i JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum,ordinal) ON true JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum WHERE i.indrelid=to_regclass($1) AND i.indisprimary ORDER BY k.ordinal`,
      identifier(spec.table),
    );
    if (!keys.length)
      throw new ConflictException({ code: 'CUSTODY_GRAPH_KEY_UNAVAILABLE' });
    const key = `jsonb_build_object(${keys.map((k) => "'" + k.name + "',t." + identifier(k.name)).join(',')})`;
    const rows = await tx.$queryRawUnsafe<
      { key: Prisma.JsonObject; digest: string }[]
    >(
      `SELECT ${key} key,encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') digest FROM ${identifier(spec.table)} t WHERE ${predicate(spec)} ORDER BY ${key}::text LIMIT 2001`,
      scope.sourceSpaceId,
    );
    if (rows.length > 2000)
      throw new PayloadTooLargeException({ code: 'CUSTODY_GRAPH_LIMIT' });
    parts.push({ ...spec, rows });
  }
  if (parts.reduce((n, p) => n + p.rows.length, 0) > 2000)
    throw new PayloadTooLargeException({ code: 'CUSTODY_GRAPH_LIMIT' });
  return parts;
}
/** Every locator update is also checked by the reviewed manifest SQL guards. */
export async function moveCustodyGraph(
  tx: Prisma.TransactionClient,
  scope: CustodyGraphScope,
  tables: readonly CustodyGraphTable[],
) {
  scope.verify(tx, true);
  for (const spec of tables) {
    if (!spec.move.length) continue;
    const changes = spec.move
      .map(
        (c) =>
          `${identifier(c)}=CASE WHEN t.${identifier(c)}=$1::uuid THEN $2::uuid ELSE t.${identifier(c)} END`,
      )
      .join(',');
    const changed = spec.move
      .map((c) => 't.' + identifier(c) + '=$1::uuid')
      .join(' OR ');
    await tx.$executeRawUnsafe(
      `UPDATE ${identifier(spec.table)} t SET ${changes} WHERE ${predicate(spec)} AND (${changed})`,
      scope.sourceSpaceId,
      scope.destinationSpaceId,
    );
  }
}
