import { createHash } from 'node:crypto';
export const teamsMigrationName = '202611050021_independent_teams';
export const teamsMigrationHash =
  '48da56fbe30e2c356427bf115ac2ec4e66cbcdf954cede30b456801cf4151fc9';
export function assertReviewedTeamsMigration(name: string, sql: string) {
  if (
    name !== teamsMigrationName ||
    createHash('sha256').update(sql).digest('hex') !== teamsMigrationHash
  )
    throw new Error('Unreviewed Teams migration name or bytes');
}

export const teamReferenceUsageName = '202611050022_team_reference_usage';
export const teamReferenceUsageHash =
  '7a3a95b9a1a9a0f1525efa59a53f555f5f3623c055da95d8cd1427d030fe91f6';
export function assertReviewedTeamReferenceUsage(name: string, sql: string) {
  if (
    name !== teamReferenceUsageName ||
    createHash('sha256').update(sql).digest('hex') !== teamReferenceUsageHash
  )
    throw new Error('Unreviewed Team reference usage migration');
}
