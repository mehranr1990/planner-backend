import { createHash } from 'node:crypto';
export const assignmentMigrationName = '202611040009_task_assignment';
export const assignmentMigrationHash =
  'c0bc4222627cb82f70cdb85a513f70464575494a456a46f0719113c235063e7c';
/** M06: typed sources/admissions, retained consent, private references and usage. */
export function assertReviewedAssignmentMigration(name: string, sql: string) {
  if (
    name !== assignmentMigrationName ||
    createHash('sha256').update(sql).digest('hex') !== assignmentMigrationHash
  )
    throw new Error('Unreviewed assignment migration name or bytes');
}
