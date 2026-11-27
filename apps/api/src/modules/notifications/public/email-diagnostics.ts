import { Prisma } from '../../../generated/prisma/client.js';
import { sourceEmailRows } from '../../../platform/auth/email-query.js';
import type { EmailQuery } from '../../../platform/auth/email-query.js';
export function notificationEmailRows(
  tx: Prisma.TransactionClient,
  q: EmailQuery,
) {
  return sourceEmailRows(
    tx,
    Prisma.sql`SELECT 'NOTIFICATION'::text "sourceKind",d.id "sourceId",
    'REMINDER'::text category,d."createdAt",d."ownerUserId" "userId",u.email "plannedRecipient",
    'REMINDER'::text "resourceKind",d."reminderId" "resourceId",d.state "rawState",d.attempts,
    CASE WHEN d.state IN ('PENDING','RETRY') THEN d."notBefore" END "nextAt",d."leaseUntil"
    FROM "NotificationDelivery" d JOIN "User" u ON u.id=d."ownerUserId" WHERE d.channel='EMAIL'`,
    q,
  );
}
