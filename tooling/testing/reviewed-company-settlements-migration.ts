import { createHash } from 'node:crypto';
export const companySettlementsMigrationName =
  '202611070032_company_reimbursements_and_approvals';
export const companySettlementsMigrationHash =
  '72a7ca37b1d49c825d98b922416385d8d022c15328e1d8d3bff19e642bbb0a96';
export function assertReviewedCompanySettlementsMigration(
  name: string,
  sql: string,
) {
  if (
    name !== companySettlementsMigrationName ||
    createHash('sha256').update(sql).digest('hex') !==
      companySettlementsMigrationHash
  )
    throw new Error('Unreviewed Company settlements migration');
}
