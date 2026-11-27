import { Prisma } from '../../../generated/prisma/client.js';
import { sourceEmailRows } from '../../../platform/auth/email-query.js';
import type { EmailQuery } from '../../../platform/auth/email-query.js';
export function engagementEmailRows(
  tx: Prisma.TransactionClient,
  q: EmailQuery,
) {
  return sourceEmailRows(
    tx,
    Prisma.sql`SELECT 'COMMUNICATION'::text "sourceKind",d.id "sourceId",
    'COMMUNICATIONS'::text category,d."createdAt",d."userId",u.email "plannedRecipient",
    'COMMUNICATION'::text "resourceKind",d."communicationId" "resourceId",d.state "rawState",d.attempts,
    CASE WHEN d.state='PENDING' THEN d."nextAt" END "nextAt",d."leaseUntil"
    FROM "AdminCommunicationRecipient" d JOIN "User" u ON u.id=d."userId" WHERE d.channel='EMAIL'
    UNION ALL SELECT 'NOTICE',n.id,CASE WHEN n.kind='MODERATION_OUTCOME' THEN 'SECURITY_NOTICE' ELSE 'SUPPORT' END,
    n."createdAt",n."userId",u.email,CASE WHEN n."ticketId" IS NOT NULL THEN 'SUPPORT_TICKET' ELSE 'MODERATION_CASE' END,
    COALESCE(n."ticketId",n."caseId"),n."deliveryState",n.attempts,
    CASE WHEN n."deliveryState"='PENDING' THEN n."nextAt" END,n."leaseUntil"
    FROM "P4Notice" n JOIN "User" u ON u.id=n."userId"`,
    q,
  );
}
