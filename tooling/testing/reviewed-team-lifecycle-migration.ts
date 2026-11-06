import { createHash } from 'node:crypto';
export const teamLifecycleMigrationName = '202611060027_team_lifecycle';
export const teamLifecycleMigrationHash =
  'eed884d163e8b52a6ca030c06afc20a319852351ddbc7d6082141572bafca4a0';
export function assertReviewedTeamLifecycleMigration(
  name: string,
  sql: string,
) {
  if (
    name !== teamLifecycleMigrationName ||
    createHash('sha256').update(sql).digest('hex') !==
      teamLifecycleMigrationHash
  )
    throw new Error('Unreviewed Team lifecycle migration');
}
