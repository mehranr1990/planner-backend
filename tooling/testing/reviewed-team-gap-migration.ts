import { createHash } from 'node:crypto';
export const teamGapMigrationHashes: Readonly<Record<string, string>> = {
  '202611160071_team_gap_configuration':
    '5fb36b8b2faaacc6114340944c702340a03f1df6cd1d86f76916147ca09a835d',
  '202611160072_typed_team_association_requests':
    '2ce0d9e4a5d8585671c56c27f224e8a6b389fb4bd45d137e95e6a4094cbcf99e',
};
export function assertReviewedTeamGapMigration(name: string, sql: string) {
  if (
    !teamGapMigrationHashes[name] ||
    createHash('sha256').update(sql).digest('hex') !==
      teamGapMigrationHashes[name]
  )
    throw new Error('Unreviewed Team gap migration');
}
