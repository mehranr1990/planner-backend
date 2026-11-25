import { createHash } from 'node:crypto';
export const adminP3MigrationName = '202611250112_platform_admin_p3_operations';
export const adminP3MigrationHash =
  'b3735fdac10fc413af18de8ae61b2775c8b9725cb889b0320ac89bae7129bf82';
export function assertReviewedAdminP3Migration(sql: string) {
  if (createHash('sha256').update(sql).digest('hex') !== adminP3MigrationHash)
    throw new Error('Unreviewed Platform Admin P3 operational migration');
}
