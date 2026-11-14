import { createHash } from 'node:crypto';
// Company completion (2026-11-13): OD-9 currency lock triggers, work-detail
// columns, resource types, versioned approval workflows and request history.
export const companyCompletionMigrationName = '202611130049_company_completion';
export const companyCompletionMigrationHash =
  '1924711aa9a139422919a754214db63cc70b179a5c06066e4ea177a177e82703';
export function assertReviewedCompanyCompletionMigration(
  name: string,
  sql: string,
) {
  if (
    name !== companyCompletionMigrationName ||
    createHash('sha256').update(sql).digest('hex') !==
      companyCompletionMigrationHash
  )
    throw Error('Unreviewed Company completion migration');
}
