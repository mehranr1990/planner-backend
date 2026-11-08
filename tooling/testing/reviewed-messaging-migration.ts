import { createHash } from 'node:crypto';
export const messagingMigrationName = '202611080040_messaging_foundation';
export const messagingMigrationHash =
  '1547e55d69c31442b7900819a5587036bf304fc0971a4410ac02dda68f9674f5';
export function assertReviewedMessagingMigration(name: string, sql: string) {
  if (
    name !== messagingMigrationName ||
    createHash('sha256').update(sql).digest('hex') !== messagingMigrationHash
  )
    throw new Error('Unreviewed messaging foundation migration');
}
