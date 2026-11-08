import { createHash } from 'node:crypto';
export const messagingMediaMigrationName =
  '202611080042_messaging_media_receipts_notifications';
export const messagingMediaMigrationHash =
  '66210c92ed0e06fb7e60afb5041952b868d88553f52c24c647533e16b8f729d9';
export function assertReviewedMessagingMediaMigration(
  name: string,
  sql: string,
) {
  if (
    name !== messagingMediaMigrationName ||
    createHash('sha256').update(sql).digest('hex') !==
      messagingMediaMigrationHash
  )
    throw new Error('Unreviewed messaging media migration');
}
