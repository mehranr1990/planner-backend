import { createHash } from 'node:crypto';
// ADR 0069: adds Task.restoreUntil, backfills existing deletions with their
// original 30-day deadline and pairs it with deletedAt. Reviewed bytes only.
export const taskRestoreDeadlineMigrationName =
  '202611200086_task_restore_deadline';
export const taskRestoreDeadlineMigrationHash =
  '062973e08a1667985fa2191c37516028fd1079e81e8dfd658dd1ebafa26c2da2';
export function assertReviewedTaskRestoreDeadlineMigration(sql: string) {
  if (
    createHash('sha256').update(sql).digest('hex') !==
    taskRestoreDeadlineMigrationHash
  )
    throw new Error('Unreviewed task restore deadline migration');
}
