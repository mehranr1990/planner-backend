import { createHash } from 'node:crypto';
export const collaborationMigrationName =
  '202611040004_shared_invitations_and_handover';
export const collaborationMigrationHash =
  '9d9929cb63f67223b9982214292d823b15399a0a4ee90de3ffb4952a59604453';
/** Exact M04 DDL: typed FKs, hard bounds, partial uniqueness and bounded DDL timeouts. */
export function assertReviewedCollaborationMigration(
  name: string,
  sql: string,
) {
  if (
    name !== collaborationMigrationName ||
    createHash('sha256').update(sql).digest('hex') !==
      collaborationMigrationHash
  )
    throw new Error('Unreviewed collaboration migration name or SQL bytes');
}
