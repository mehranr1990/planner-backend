import { createHash } from 'node:crypto';
export const adminP4MigrationName = '202611260116_platform_admin_p4';
export function assertReviewedAdminP4Migration(sql: string) {
  if (
    createHash('sha256').update(sql).digest('hex') !==
    '3118358bb1cada13f77f35b33d2ff99de861c57befcb594a57b834368b0be71a'
  )
    throw new Error('Unreviewed Platform Admin P4 migration');
}

export const adminP4PreferencesMigrationName =
  '202611260117_p4_delivery_preferences';
export function assertReviewedAdminP4PreferencesMigration(sql: string) {
  if (
    createHash('sha256').update(sql).digest('hex') !==
    '08a17230fe9cdd043dce1fe6932e3c20b7ae4ae7f5af4e669a2cf4bd10aca557'
  )
    throw new Error('Unreviewed P4 delivery preferences migration');
}

export const adminP4AudienceMigrationName = '202611260118_p4_audience_scope';
export function assertReviewedAdminP4AudienceMigration(sql: string) {
  if (
    createHash('sha256').update(sql).digest('hex') !==
    'ec12f0821e8025f07d6e380badec84701d7a45abc99db63d0485382a6bb6608b'
  )
    throw new Error('Unreviewed P4 audience and scope migration');
}
