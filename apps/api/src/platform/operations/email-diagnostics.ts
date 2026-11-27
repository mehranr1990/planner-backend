import { Prisma } from '../../generated/prisma/client.js';
import { sourceEmailRows } from '../auth/email-query.js';
import type { EmailQuery } from '../auth/email-query.js';
export function operationalEmailRows(
  tx: Prisma.TransactionClient,
  q: EmailQuery,
) {
  return sourceEmailRows(
    tx,
    Prisma.sql`SELECT 'SECURITY_ALERT'::text "sourceKind",d.id "sourceId",
    'SECURITY_NOTICE'::text category,d."createdAt",NULL::uuid "userId",u.email "plannedRecipient",
    'SECURITY_ALERT'::text "resourceKind",d."alertId" "resourceId",d.state "rawState",d.attempts,
    CASE WHEN d.state='PENDING' THEN d."nextAt" END "nextAt",d."leaseUntil"
    FROM "AdminSecurityAlertDelivery" d JOIN "AdminUser" u ON u.id=d."adminUserId"
    UNION ALL SELECT 'OPERATIONAL_ALERT',d.id,'SYSTEM_NOTICE',d."createdAt",NULL::uuid,u.email,
    'INCIDENT',d."incidentId",d.state,d.attempts,CASE WHEN d.state='PENDING' THEN d."nextAt" END,d."leaseUntil"
    FROM "AdminOperationalDelivery" d JOIN "AdminUser" u ON u.id=d."adminUserId"`,
    q,
  );
}
