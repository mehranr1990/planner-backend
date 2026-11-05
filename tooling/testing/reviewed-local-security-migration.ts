import { createHash } from 'node:crypto';
export const localSecurityMigrationName =
  '202611050020_local_security_closeout';
export const localSecurityMigrationHash =
  '7c4d216ab6896f7621f04d3d305c725ae06e20ec94ce8f833b5bfea87d46f101';
export function assertReviewedLocalSecurityMigration(
  name: string,
  sql: string,
) {
  if (
    name !== localSecurityMigrationName ||
    createHash('sha256').update(sql).digest('hex') !==
      localSecurityMigrationHash
  )
    throw new Error('Unreviewed local security closeout artifact');
}
