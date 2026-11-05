import { createHash } from 'node:crypto';
export const projectExecutionMigrationHashes: Readonly<Record<string, string>> =
  {
    '202611040013_project_execution':
      '1fc290e40f5dba4d0fe5524bbf2ac84d9a1a0ae3c6b9cc953981c8d998cb6937',
    '202611040014_shared_task_work_log':
      '93a738fd9b49b9cebca2fe056af8268cfdedc0bf0479af7c3c4cbeafb3900001',
  };
export function assertReviewedProjectExecutionMigration(
  name: string,
  sql: string,
) {
  if (
    !projectExecutionMigrationHashes[name] ||
    createHash('sha256').update(sql).digest('hex') !==
      projectExecutionMigrationHashes[name]
  )
    throw new Error('Unreviewed Project execution migration name or bytes');
}
