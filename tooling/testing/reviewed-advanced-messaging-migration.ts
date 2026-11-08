import { createHash } from 'node:crypto';
export const advancedMessagingMigrationName = '202611080041_advanced_messaging';
export const advancedMessagingMigrationHash =
  '6de4f5c76e4bea7060a94c7d89771dcb167fb46b2ec549d49f30ee077607a3bb';
export function assertReviewedAdvancedMessagingMigration(
  name: string,
  sql: string,
) {
  if (
    name !== advancedMessagingMigrationName ||
    createHash('sha256').update(sql).digest('hex') !==
      advancedMessagingMigrationHash
  )
    throw new Error('Unreviewed advanced messaging migration');
}
