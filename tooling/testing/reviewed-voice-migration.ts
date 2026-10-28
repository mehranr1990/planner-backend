import { createHash } from 'node:crypto';
/** ADR 0015 explicitly approves only this atomic, data-preserving CHECK expansion. */
export const reviewedVoiceMigrationName = '202610280012_p1_08_private_voice';
export const reviewedVoiceMigrationHash =
  'fdb40cbbdc0fffc5d631fdda67eb0455ac73d689a6e5009172eab6442c63fbbb';
export function assertReviewedVoiceMigration(name: string, sql: string): void {
  if (
    name !== reviewedVoiceMigrationName ||
    createHash('sha256').update(sql).digest('hex') !==
      reviewedVoiceMigrationHash
  )
    throw new Error(
      'Voice migration differs from the exact owner-approved CHECK expansion; review required.',
    );
}
