import type { Prisma } from '../../../generated/prisma/client.js';
import {
  sharedChildDeleteBatch,
  sharedDeleteBatch,
  type SharedCleanupScope,
} from '../../../platform/lifecycle/shared-cleanup.js';
/** Called only with the coordinator's current, policy-claimed PURGING proof. */
export async function purgeMessaging(
  tx: Prisma.TransactionClient,
  s: SharedCleanupScope,
) {
  s.verify(tx);
  const conversation = [
    { table: 'Conversation', foreignKey: 'conversationId' },
  ];
  if (
    !(await sharedChildDeleteBatch(tx, s, 'MessageNoticeAttempt', [
      { table: 'MessageNotice', foreignKey: 'noticeId' },
      ...conversation,
    ]))
  )
    return false;
  for (const table of [
    'ConversationReport',
    'ConversationMemberSetting',
    'ConversationSetting',
    'MessageNotice',
    'MessageActivity',
    'MessagePersonalMutation',
    'MessageProgress',
    'MessageNoticePreference',
    'MessageMutation',
    'MessageChange',
    'MessageModeration',
    'MessageReport',
    'MessagePin',
    'MessageMention',
    'MessageReaction',
    'MessageHidden',
    'MessagePolicy',
    'MessageAttachment',
  ])
    if (!(await sharedChildDeleteBatch(tx, s, table, conversation)))
      return false;
  for (const table of [
    'MessageRevision',
    'MessageMediaRevision',
    'MessageMedia',
  ])
    if (
      !(await sharedChildDeleteBatch(tx, s, table, [
        { table: 'MessageEntry', foreignKey: 'messageId' },
        ...conversation,
      ]))
    )
      return false;
  // Leaves first: reply/thread/live-forward FKs cannot be bypassed by a batch.
  if (
    !(await sharedChildDeleteBatch(
      tx,
      s,
      'MessageEntry',
      conversation,
      'AND NOT EXISTS(SELECT 1 FROM "MessageEntry" r WHERE r."replyToId"=t.id OR r."threadId"=t.id OR r."sourceId"=t.id)',
    ))
  )
    return false;
  if (
    await tx.messageEntry.count({
      where: {
        conversation: {
          spaceId: s.spaceId,
          ...(s.scopeId ? { scopeId: s.scopeId } : {}),
        },
      },
    })
  )
    return false;
  for (const table of [
    'ConversationMessage',
    'ConversationInvitation',
    'ConversationAdmission',
    'ConversationMember',
  ])
    if (!(await sharedChildDeleteBatch(tx, s, table, conversation)))
      return false;
  return sharedDeleteBatch(tx, s, ['Conversation']);
}
