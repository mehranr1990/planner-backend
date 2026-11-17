import { createHash } from 'node:crypto';
// ADR 0060-0062: replaces two CHECK constraints on tables created by 0077;
// every other statement is additive. Reviewed bytes only.
export const socialGapMigrationName = '202611180078_social_gap_closure';
export const socialGapMigrationHash =
  '50a8af79a25c2713581938e328d14785630967267a93faaeb43b5c70ab0fcccd';
export function assertReviewedSocialGapMigration(sql: string) {
  if (createHash('sha256').update(sql).digest('hex') !== socialGapMigrationHash)
    throw new Error('Unreviewed Social gap closure migration');
}
