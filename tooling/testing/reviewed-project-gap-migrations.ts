import { createHash } from 'node:crypto';
/** Additive Project closure; M062 extends notice kinds without changing existing rows or consent guards. */
export const projectGapMigrationHashes: Readonly<Record<string, string>> = {
  '202611160070_project_key_identity_erasure':
    'af54e6a2f67516fcddf449831cc57c93fbca4524666a76f7c8fc65ed33f263f2',
  '202611160069_project_key_uniqueness':
    'f80515db93b95e4274b16e0ae83e3eb8f644a218c97bfb68a6a0215251718964',
  '202611150062_project_assignment_notices':
    '0223de26847b9a2986341ffce640cb745bb59f3c03dfae95fcdc7dbb3cb3bcaf',
  '202611150065_project_register_details':
    '95cfc05c6b71630758518fbc8bef0ab708d93f357a8c85bc62e7310461d437ed',
};
export function assertReviewedProjectGapMigration(name: string, sql: string) {
  if (
    !projectGapMigrationHashes[name] ||
    createHash('sha256').update(sql).digest('hex') !==
      projectGapMigrationHashes[name]
  )
    throw new Error('Unreviewed Project closure migration');
}
