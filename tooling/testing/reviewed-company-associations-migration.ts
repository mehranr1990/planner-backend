import { createHash } from 'node:crypto';
export const companyAssociationsMigrationName =
  '202611070035_company_associations';
export const companyAssociationsMigrationHash =
  'b9a5013c215b65b52e0b139f1d6235deb3a3973ccc9776fffe5c148a3577e154';
export function assertReviewedCompanyAssociationsMigration(
  name: string,
  sql: string,
) {
  if (
    name !== companyAssociationsMigrationName ||
    createHash('sha256').update(sql).digest('hex') !==
      companyAssociationsMigrationHash
  )
    throw new Error('Unreviewed Company associations migration');
}
