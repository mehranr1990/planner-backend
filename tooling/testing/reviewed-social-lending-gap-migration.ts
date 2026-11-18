import { createHash } from 'node:crypto';
// ADR 0064 decisions B and D: replaces the SocialNotice context and kind CHECKs
// (exactly one typed context, P6-04 kinds); every other statement is additive.
export const socialLendingGapMigrationName =
  '202611180080_social_lending_gap_closure';
export const socialLendingGapMigrationHash =
  '88488ab087bf72ea823ad377d1dbcae911aab604d3f8f25ca148a6ba1a26fcb5';
export function assertReviewedSocialLendingGapMigration(sql: string) {
  if (
    createHash('sha256').update(sql).digest('hex') !==
    socialLendingGapMigrationHash
  )
    throw new Error('Unreviewed Social lending gap closure migration');
}
