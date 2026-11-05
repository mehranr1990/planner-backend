import type { Prisma } from '../../generated/prisma/client.js';
/** Catalog-only guard: source owners fail closed when a new incoming FK lacks a transfer disposition.
 * Never inspects another module's content or executes caller-supplied identifiers. */
export async function transferCatalog(
  tx: Prisma.TransactionClient,
  table: 'Task' | 'Goal',
  known: readonly string[],
) {
  const rows = await tx.$queryRaw<
    { name: string; definition: string }[]
  >`SELECT conname name,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE contype='f' AND confrelid=to_regclass(${'"' + table + '"'}) ORDER BY conname`;
  return { known: rows.every((r) => known.includes(r.name)), rows };
}
