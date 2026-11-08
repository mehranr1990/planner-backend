import { createHash } from 'node:crypto';
export const companyScopeCustodyMigrationName =
  '202611070036_company_scope_custody';
export const companyScopeCustodyMigrationHash =
  '206f57105860e51332de6406529fb20f35fdf5ca03fe124c93bbd560986f721f';
export function assertReviewedCompanyScopeCustodyMigration(
  name: string,
  sql: string,
) {
  if (
    name !== companyScopeCustodyMigrationName ||
    createHash('sha256').update(sql).digest('hex') !==
      companyScopeCustodyMigrationHash
  )
    throw new Error('Unreviewed Company scoped custody migration');
}
