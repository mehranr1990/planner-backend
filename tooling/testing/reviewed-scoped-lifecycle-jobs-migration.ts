import { createHash } from 'node:crypto';
export const scopedLifecycleJobsMigrationName =
  '202611080038_scoped_lifecycle_jobs';
export const scopedLifecycleJobsMigrationHash =
  'c4058a9c2837a45bf5c0b4d776ec0fc3ed22163dd429cdf7e73c122d46f46aef';
export function assertReviewedScopedLifecycleJobsMigration(
  name: string,
  sql: string,
) {
  if (
    name !== scopedLifecycleJobsMigrationName ||
    createHash('sha256').update(sql).digest('hex') !==
      scopedLifecycleJobsMigrationHash
  )
    throw new Error('Unreviewed scoped lifecycle jobs migration');
}
