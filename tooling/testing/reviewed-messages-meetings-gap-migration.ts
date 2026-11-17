import { createHash } from 'node:crypto';
export const messagesMeetingsGapMigrationName =
  '202611170075_messages_meetings_gap';
export const messagesMeetingsGapMigrationHash =
  'eee0b1608396ca39305649a60fa572799d5e8e33c45e409779d0f8b51627a5a6';
export function assertReviewedMessagesMeetingsGapMigration(sql: string) {
  if (
    createHash('sha256').update(sql).digest('hex') !==
    messagesMeetingsGapMigrationHash
  )
    throw new Error('Unreviewed Messages/Meetings migration');
}
