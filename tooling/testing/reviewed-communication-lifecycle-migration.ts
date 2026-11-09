import { createHash } from 'node:crypto';
export const communicationLifecycleMigrationName =
  '202611090044_communication_privacy_lifecycle';
export const communicationLifecycleMigrationHash =
  'a05429dd0f87624bd226d510686a30b55266de7834e8142fda5f8f44889d8f96';
export function assertReviewedCommunicationLifecycleMigration(
  name: string,
  sql: string,
) {
  if (
    name !== communicationLifecycleMigrationName ||
    createHash('sha256').update(sql).digest('hex') !==
      communicationLifecycleMigrationHash
  )
    throw Error('Unreviewed communication lifecycle migration');
}
