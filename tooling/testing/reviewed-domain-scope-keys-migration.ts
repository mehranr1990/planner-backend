import { createHash } from 'node:crypto';
export const domainScopeKeysMigrationName = '202611080037_domain_scope_keys';
export const domainScopeKeysMigrationHash =
  '9f0b3c678103554086a065a07f0af8347557f2167e866d9bea8db993d317aa74';
export function assertReviewedDomainScopeKeysMigration(
  name: string,
  sql: string,
) {
  if (
    name !== domainScopeKeysMigrationName ||
    createHash('sha256').update(sql).digest('hex') !==
      domainScopeKeysMigrationHash
  )
    throw new Error('Unreviewed domain scope key migration');
}
