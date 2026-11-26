import { createHash } from 'node:crypto';
export const adminP6MigrationName = '202611260122_platform_admin_p6';
export const adminP6MigrationSha256 =
  'eeebe3b482211b8caca27c231de93424b40e295e3d4a4bc008f860eaf184a462';
export function assertReviewedAdminP6Migration(sql: string) {
  if (createHash('sha256').update(sql).digest('hex') !== adminP6MigrationSha256)
    throw new Error('Unreviewed Platform Admin P6 migration');
}

export const adminP6ScheduleMigrationName =
  '202611260123_p6_maintenance_release_schedule';
export const adminP6ScheduleMigrationSha256 =
  '2febb13ca0e2f3acb020ddf1d820f2b741799a3c8dd61065a88bab8768babbd0';
export function assertReviewedAdminP6ScheduleMigration(sql: string) {
  if (
    createHash('sha256').update(sql).digest('hex') !==
    adminP6ScheduleMigrationSha256
  )
    throw new Error('Unreviewed P6 release schedule migration');
}
