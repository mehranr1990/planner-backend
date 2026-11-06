import { createHash } from 'node:crypto';
export const teamCapacityMigrationName = '202611060025_team_capacity';
export const teamCapacityMigrationHash =
  '2581bb85256f1c660045c543d18d1a19a411868eedbbef35d1c40284d619029c';
export function assertReviewedTeamCapacityMigration(name: string, sql: string) {
  if (
    name !== teamCapacityMigrationName ||
    createHash('sha256').update(sql).digest('hex') !== teamCapacityMigrationHash
  )
    throw new Error('Unreviewed Team capacity migration');
}
