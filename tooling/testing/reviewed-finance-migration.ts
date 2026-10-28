import { createHash } from 'node:crypto';
/** ADR0016: exact data-preserving Capture target CHECK expansion only. */ export const reviewedFinanceMigrationName =
  '202610280014_p1_09_capture_finance';
export const reviewedFinanceMigrationHash =
  '03e1cdddf71bafec282fa9ec334453ea0549f55a5a2d4df47c0a15eec97d7448';
export function assertReviewedFinanceMigration(name: string, sql: string) {
  if (
    name !== reviewedFinanceMigrationName ||
    createHash('sha256').update(sql).digest('hex') !==
      reviewedFinanceMigrationHash
  )
    throw new Error(
      'Finance migration differs from the exact owner-approved target CHECK expansion.',
    );
}
