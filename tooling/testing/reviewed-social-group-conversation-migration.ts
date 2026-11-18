import { createHash } from 'node:crypto';
// ADR 0067: adds the Social-owned SocialGroup.conversationId reservation (unique) and
// replaces the Messaging source CHECK to admit 'SOCIAL_GROUP'; existing rows stay valid.
export const socialGroupConversationMigrationName =
  '202611180083_social_group_conversation';
export const socialGroupConversationMigrationHash =
  'd1e64e08e5351b2af43bc4c0c4a9b1aef39a036e54c40c6100b8890ff92b610d';
export function assertReviewedSocialGroupConversationMigration(sql: string) {
  if (
    createHash('sha256').update(sql).digest('hex') !==
    socialGroupConversationMigrationHash
  )
    throw new Error('Unreviewed Social Group conversation migration');
}
