import { createHash } from 'node:crypto';
export const companyFinanceMigrationName = '202611070031_company_finance';
export const companyFinanceMigrationHash =
  '2ee6190668e6f964fbcf933aad9039141f2226f67c4b08b4fccab8f2f287ad72';
export function assertReviewedCompanyFinanceMigration(
  name: string,
  sql: string,
) {
  if (
    name !== companyFinanceMigrationName ||
    createHash('sha256').update(sql).digest('hex') !==
      companyFinanceMigrationHash
  )
    throw new Error('Unreviewed Company finance migration');
}
