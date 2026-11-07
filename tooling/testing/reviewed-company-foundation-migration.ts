import { createHash } from 'node:crypto';
export const companyFoundationMigrationName = '202611060028_company_foundation';
export const companyFoundationMigrationHash =
  '5356ececd9ab3e2d3b2c374b65149af6dbc55b5f5ac51eb58a3654d9b3d1c8b4';
export function assertReviewedCompanyFoundationMigration(
  name: string,
  sql: string,
) {
  if (
    name !== companyFoundationMigrationName ||
    createHash('sha256').update(sql).digest('hex') !==
      companyFoundationMigrationHash
  )
    throw new Error('Unreviewed Company foundation migration');
}
