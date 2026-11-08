import { createHash } from 'node:crypto';
export const companyLifecycleMigrationName = '202611070034_company_lifecycle';
export const companyLifecycleMigrationHash =
  '0a455f5a274e3b199c41326f12857d73f518f5d8a4f542c304588dbb26401828';
export function assertReviewedCompanyLifecycleMigration(
  name: string,
  sql: string,
) {
  if (
    name !== companyLifecycleMigrationName ||
    createHash('sha256').update(sql).digest('hex') !==
      companyLifecycleMigrationHash
  )
    throw new Error('Unreviewed Company lifecycle migration');
}
