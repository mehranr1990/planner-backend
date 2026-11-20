import { createHash } from 'node:crypto';
// ADR 0069: replaces only the SharedRetentionPolicy configuration CHECK so a
// policy may declare 604800 or 2592000 recovery seconds. No data changes.
// Reviewed bytes only.
export const retentionPolicyRecoveryMigrationName =
  '202611200087_retention_policy_seven_day_recovery';
export const retentionPolicyRecoveryMigrationHash =
  '375f2df0ecf2ce9146bfe5522e1916d352b6ee38bacacaee85c08941bac89c64';
export function assertReviewedRetentionPolicyRecoveryMigration(sql: string) {
  if (
    createHash('sha256').update(sql).digest('hex') !==
    retentionPolicyRecoveryMigrationHash
  )
    throw new Error('Unreviewed retention policy recovery migration');
}
