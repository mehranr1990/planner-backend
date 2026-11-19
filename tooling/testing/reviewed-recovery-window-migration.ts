import { createHash } from 'node:crypto';
// ADR 0029 amendment: replaces only the fixed 720-hour recovery CHECK with one
// accepting 168 or 720 hours. No data changes. Reviewed bytes only.
export const recoveryWindowMigrationName =
  '202611190084_company_team_project_recovery_window';
export const recoveryWindowMigrationHash =
  'dd4df22e79549abf777d95f9755f06ba090f24a7d6a9d170682a91a8043ae37e';
export function assertReviewedRecoveryWindowMigration(sql: string) {
  if (
    createHash('sha256').update(sql).digest('hex') !==
    recoveryWindowMigrationHash
  )
    throw new Error('Unreviewed recovery window migration');
}
