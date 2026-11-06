import { createHash } from 'node:crypto';
export const teamWorkMigrationName = '202611050023_team_work_planning';
export const teamWorkMigrationHash =
  '39417c30b7c510296b46eb133aa02ebacf170af566e3f79a61eba6e73d124970';
export function assertReviewedTeamWorkMigration(name: string, sql: string) {
  if (
    name !== teamWorkMigrationName ||
    createHash('sha256').update(sql).digest('hex') !== teamWorkMigrationHash
  )
    throw new Error('Unreviewed Team work migration name or bytes');
}

export const teamCalendarOrderName = '202611050024_team_calendar_cascade_order';
export const teamCalendarOrderHash =
  'fcdacd686a41aa15b4ab4732d914a28346e66d5ee0105df747e8c6543de5e9c5';
export function assertReviewedTeamCalendarOrder(name: string, sql: string) {
  if (
    name !== teamCalendarOrderName ||
    createHash('sha256').update(sql).digest('hex') !== teamCalendarOrderHash
  )
    throw new Error('Unreviewed Team Calendar FK timing correction');
}
