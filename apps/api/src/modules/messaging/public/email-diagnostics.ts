import { Prisma } from '../../../generated/prisma/client.js';
import { sourceEmailRows } from '../../../platform/auth/email-query.js';
import type { EmailQuery } from '../../../platform/auth/email-query.js';
export function conversationEmailRows(
  tx: Prisma.TransactionClient,
  q: EmailQuery,
) {
  return sourceEmailRows(
    tx,
    Prisma.sql`SELECT 'CONVERSATION_INVITATION'::text "sourceKind",i.id "sourceId",
    'CONVERSATION_INVITATION'::text category,i."createdAt",NULL::uuid "userId",i.email "plannedRecipient",
    'CONVERSATION'::text "resourceKind",i."conversationId" "resourceId",
    CASE WHEN i."emailDeliveryState"='FAILED' AND i."encryptedDeliveryProof" IS NOT NULL THEN 'RETRY'
      WHEN i."emailDeliveryState"='NONE' AND i."encryptedDeliveryProof" IS NOT NULL THEN 'PENDING'
      WHEN i."emailDeliveryState"='NONE' THEN 'SUPPRESSED' ELSE i."emailDeliveryState" END "rawState",
    i."deliveryAttempts" attempts,CASE WHEN i."encryptedDeliveryProof" IS NOT NULL THEN i."deliveryNotBefore" END "nextAt",NULL::timestamptz "leaseUntil"
    FROM "ConversationEmailInvitation" i`,
    q,
  );
}
