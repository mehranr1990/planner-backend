import { createHash } from 'node:crypto';
// ADR 0065: replaces the SocialNotice kind CHECK to add the P6-05 Social Goal kinds;
// the exactly-one-context CHECK and the LOAN_/CLAIM_ context ties are unchanged.
export const socialGoalNoticesMigrationName =
  '202611180082_social_goal_notices';
export const socialGoalNoticesMigrationHash =
  '75ffbbfe6efa6fc395c9175585b5f8ea0c188ca9aaee45da821248117eccb112';
export function assertReviewedSocialGoalNoticesMigration(sql: string) {
  if (
    createHash('sha256').update(sql).digest('hex') !==
    socialGoalNoticesMigrationHash
  )
    throw new Error('Unreviewed Social goal notices migration');
}
