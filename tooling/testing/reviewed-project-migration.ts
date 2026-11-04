import { createHash } from 'node:crypto';
export const projectMigrationName = '202611040005_project_core';
export const projectMigrationHash =
  '5a29820af8fcc16750225073b188930395be9c2d75e14f53b48e2f34a9592fca';
export const projectUsageMigrationName = '202611040006_project_usage_features';
export const projectMigrationHashes: Record<string, string> = {
  [projectMigrationName]: projectMigrationHash,
  [projectUsageMigrationName]:
    '0b59cc2b1bf0a859e9e7cfc85c139b609dad845c5c5a66d437a81be124465639',
  '202611040007_project_structure_order':
    'c3cac1e0377aef405e245ae797dec250afa7ee331f9a84cf910a768fde31c35b',
  '202611040008_project_personal_compatibility':
    '1243f18cbe17f1a2a9959f21a16b2332150b8395eec0f067dbdf9a1450569965',
};
/** Exact M05 review: branch-safe source nullability, typed targets and deferred integrity. */
export function assertReviewedProjectMigration(name: string, sql: string) {
  if (
    !Object.hasOwn(projectMigrationHashes, name) ||
    createHash('sha256').update(sql).digest('hex') !==
      projectMigrationHashes[name]
  )
    throw new Error('Unreviewed Project migration name or bytes');
}
