import { createHash } from 'node:crypto';
export const socialMigrationName = '202611110045_social_foundation';
export const socialMigrationHash =
  '30d00bf27efcda10291f0596b05dc9bee48452c2f0ed5aa431bd90a81278a25e';
export function assertReviewedSocialMigration(name: string, sql: string) {
  if (
    name !== socialMigrationName ||
    createHash('sha256').update(sql).digest('hex') !== socialMigrationHash
  )
    throw Error('Unreviewed Social foundation migration');
}
