import { createHash } from 'node:crypto';
export const meetingsMigrationName =
  '202611090043_meetings_decisions_announcements';
export const meetingsMigrationHash =
  '91372e3e8a2db9b3fde0afbff55c89565505fd42260c6b7c1dacac29a5fe5806';
export function assertReviewedMeetingsMigration(name: string, sql: string) {
  if (
    name !== meetingsMigrationName ||
    createHash('sha256').update(sql).digest('hex') !== meetingsMigrationHash
  )
    throw new Error('Unreviewed meetings migration');
}
