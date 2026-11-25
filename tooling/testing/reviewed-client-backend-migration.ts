import { createHash } from 'node:crypto';
export const clientBackendMigrationName =
  '202611250113_client_backend_completion';
export const clientBackendMigrationHash =
  '8b5d413ea7513c3f96013f8499641d66d8b2f7101b58a91e165fc028596533cb';
export function assertReviewedClientBackendMigration(sql: string) {
  if (
    createHash('sha256').update(sql).digest('hex') !==
    clientBackendMigrationHash
  )
    throw new Error('Unreviewed Client backend completion migration');
}
export const clientMaterializationMigrationName =
  '202611250114_client_invitation_materialization';
export function assertReviewedClientMaterializationMigration(sql: string) {
  if (
    createHash('sha256').update(sql).digest('hex') !==
    '2b38a78f5bf54b23cc2e543df8b844e3ba677cb535f7c8816fc659ad29efa123'
  )
    throw new Error('Unreviewed Client invitation materialization migration');
}
export const clientPushConsentMigrationName =
  '202611250115_client_invitation_push_consent';
export function assertReviewedClientPushConsentMigration(sql: string) {
  if (
    createHash('sha256').update(sql).digest('hex') !==
    'f1afa57517ffad8c02c970149abf69459e8144b8e0f82cc2df3d5c5550eaad84'
  )
    throw new Error('Unreviewed Client invitation push consent migration');
}
