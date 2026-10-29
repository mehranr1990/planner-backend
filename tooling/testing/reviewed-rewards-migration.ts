import { createHash } from 'node:crypto';
/** ADR0021: exact approved catalog seed; not a general DML exception. */
export const reviewedRewardsMigrationName =
  '202610290004_p1_11_analytics_rewards';
export const reviewedRewardsMigrationHash =
  'afd24e0261ca1dafdb6aa71b76c0ed36013e7f11896dfd8ad8d601abcd976b57';
export function assertReviewedRewardsMigration(name: string, sql: string) {
  if (
    name !== reviewedRewardsMigrationName ||
    createHash('sha256').update(sql).digest('hex') !==
      reviewedRewardsMigrationHash
  )
    throw new Error(
      'Rewards migration differs from the exact owner-approved catalog seed.',
    );
}
