export const companyStaffMigrationName =
  '202611070030_company_staff_and_resources';
export const companyStaffMigrationHash =
  '97262820b4eac440eeabff5ea76551554fafce06ddaa6b5b299cd0dc661800e1';
import { createHash } from 'node:crypto';
export function assertReviewedCompanyStaffMigration(name: string, sql: string) {
  if (
    name !== companyStaffMigrationName ||
    createHash('sha256').update(sql).digest('hex') !== companyStaffMigrationHash
  )
    throw new Error('Unreviewed Company staff migration');
}
