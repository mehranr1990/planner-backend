import { createHash } from 'node:crypto';
/** Exact artifacts inspected and independently rehearsed in docs/p2-07-migration-review.md. */
export const projectCollaborationMigrationHashes: Readonly<
  Record<string, string>
> = {
  '202611050015_project_collaboration':
    'f9180b9d9656df4d51080ff29eaaf7712b7de92e88881d7fb92e3cce33af4f1e',
  '202611050016_shared_files':
    'fcdb605c60a9a3b26d0b23fc514d1fc5d260495b99d39e619fa9a0cdd9c5d3cc',
  '202611050017_content_grants':
    '970b160133f24b3b73143856af68683a4d6de25467a054af9e201b9571af222f',
  '202611050018_personal_project_transfer':
    '3f8240636353ff2baa088b4cdfb4a265c8ece3b3b156d608e51bcb5a03dc06bb',
  '202611050019_shared_lifecycle_effects':
    '4245f472d127bbcfc7d58ca0a4f46029b1b82bd4c579abc05435059441f89c23',
};
export function assertReviewedProjectCollaborationMigration(
  name: string,
  sql: string,
) {
  if (
    !projectCollaborationMigrationHashes[name] ||
    createHash('sha256').update(sql).digest('hex') !==
      projectCollaborationMigrationHashes[name]
  )
    throw new Error('Unreviewed Project collaboration migration name or bytes');
}
