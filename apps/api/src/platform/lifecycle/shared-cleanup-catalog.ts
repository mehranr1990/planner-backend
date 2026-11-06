import { createHash } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
// Filled only after the final P2-07 catalog review; future FK changes must extend owner cleanup first.
export const SHARED_CLEANUP_FK_SHA256 =
  'b2d668e8d8b30b376884bb397039d09cfdd758083b8a335aab48fb89c5d924f5';
export async function assertSharedCleanupCatalog(tx: Prisma.TransactionClient) {
  const rows = await tx.$queryRaw<
    { table: string; name: string; target: string; definition: string }[]
  >`SELECT t.relname "table",c.conname name,r.relname target,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_class r ON r.oid=c.confrelid WHERE c.contype='f' AND c.connamespace=(SELECT relnamespace FROM pg_class WHERE oid=to_regclass('"Space"'))`;
  const canonical = rows.map((r) => ({
    table: r.table,
    name: r.name,
    target: r.target,
    definition: r.definition,
  }));
  canonical.sort((a, b) =>
    a.table + '|' + a.name < b.table + '|' + b.name ? -1 : 1,
  );
  const digest = createHash('sha256')
    .update(JSON.stringify(canonical))
    .digest('hex');
  if (digest !== SHARED_CLEANUP_FK_SHA256)
    throw new ConflictException({
      code: 'UNREVIEWED_SHARED_CLEANUP_REFERENCE',
    });
}
