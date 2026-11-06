import { createHash } from 'node:crypto';
export const teamInteractionsMigrationName =
  '202611060026_team_confidentiality_and_meetings';
export const teamInteractionsMigrationHash =
  '220f3d88c455db608da677c03c9950da686a5b143fa9e901efb56399cbd66523';
export function assertReviewedTeamInteractionsMigration(
  name: string,
  sql: string,
) {
  if (
    name !== teamInteractionsMigrationName ||
    createHash('sha256').update(sql).digest('hex') !==
      teamInteractionsMigrationHash
  )
    throw new Error('Unreviewed Team confidentiality/meeting migration');
}
