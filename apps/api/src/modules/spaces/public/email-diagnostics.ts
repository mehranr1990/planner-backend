import { Prisma } from '../../../generated/prisma/client.js';
import { sourceEmailRows } from '../../../platform/auth/email-query.js';
import type { EmailQuery } from '../../../platform/auth/email-query.js';
export function invitationEmailRows(
  tx: Prisma.TransactionClient,
  q: EmailQuery,
) {
  return sourceEmailRows(
    tx,
    Prisma.sql`SELECT 'CONTEXT_INVITATION'::text "sourceKind",i.id "sourceId",
    CASE WHEN i."companyScopeId" IS NOT NULL THEN 'COMPANY_INVITATION'
      WHEN COALESCE(d.kind,c.kind)='PROJECT' THEN 'PROJECT_INVITATION' WHEN COALESCE(d.kind,c.kind)='TEAM' THEN 'TEAM_INVITATION'
      WHEN COALESCE(d.kind,c.kind)='SOCIAL_GROUP' THEN 'SOCIAL_GROUP_INVITATION' ELSE 'SYSTEM_NOTICE' END category,
    i."createdAt",i."recipientUserId" "userId",COALESCE(i."recipientEmail",u.email) "plannedRecipient",
    COALESCE(d.kind,c.kind)::text "resourceKind",COALESCE(i."companyScopeId",i."scopeId") "resourceId",
    CASE WHEN i."emailDeliveryState"='FAILED' AND i."encryptedDeliveryProof" IS NOT NULL THEN 'RETRY'
      WHEN i."emailDeliveryState"='NONE' AND i."encryptedDeliveryProof" IS NULL THEN 'SUPPRESSED'
      WHEN i."emailDeliveryState"='NONE' THEN 'PENDING' ELSE i."emailDeliveryState" END "rawState",
    i."deliveryAttempts" attempts,CASE WHEN i."encryptedDeliveryProof" IS NOT NULL THEN i."deliveryNotBefore" END "nextAt",
    NULL::timestamptz "leaseUntil"
    FROM "ContextInvitation" i JOIN "SharedCustody" c ON c."spaceId"=i."spaceId"
    LEFT JOIN "DomainScopeCustody" d ON d."scopeId"=i."scopeId" AND d."spaceId"=i."spaceId"
    LEFT JOIN "User" u ON u.id=i."recipientUserId"
    WHERE i."deliveryAttempts">0 OR i."emailDeliveryState"<>'NONE' OR i."encryptedDeliveryProof" IS NOT NULL`,
    q,
  );
}
