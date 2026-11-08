import { createHash } from 'node:crypto';
export const companyDomainRepresentationMigrationName =
  '202611080039_company_domain_representation';
export const companyDomainRepresentationMigrationHash =
  'b5f27c948f77767c8c7cd66088eff98c3d80fefb007d0c13e577f77c9500714b';
export function assertReviewedCompanyDomainRepresentationMigration(
  name: string,
  sql: string,
) {
  if (
    name !== companyDomainRepresentationMigrationName ||
    createHash('sha256').update(sql).digest('hex') !==
      companyDomainRepresentationMigrationHash
  )
    throw new Error('Unreviewed Company domain representation migration');
}
