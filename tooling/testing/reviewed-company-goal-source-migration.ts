import { createHash } from 'node:crypto';
// Gap closure OD-2 (2026-11-13): project_source_shape() also accepts shared Goal
// rows in an existing Company context; Task rows stay Project/Team only.
export const companyGoalSourceMigrationName =
  '202611130053_company_goal_source';
export const companyGoalSourceMigrationHash =
  'f419de931e84c31eb96cc92d2db6b71638e63873c6b5b35ef940f66888087451';
export function assertReviewedCompanyGoalSourceMigration(
  name: string,
  sql: string,
) {
  if (
    name !== companyGoalSourceMigrationName ||
    createHash('sha256').update(sql).digest('hex') !==
      companyGoalSourceMigrationHash
  )
    throw Error('Unreviewed Company goal source migration');
}
