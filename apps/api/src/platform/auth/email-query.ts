import { Prisma } from '../../generated/prisma/client.js';
import type { AdminEmailQuerySchema } from '@mehran/api-contracts';
import type { z } from 'zod';
export type EmailQuery = z.infer<typeof AdminEmailQuerySchema> & {
  id?: string;
  position?: { createdAt: Date; id: string } | undefined;
};
export type EmailRow = {
  id: string;
  sourceKind: string;
  sourceId: string;
  category: string;
  userId: string | null;
  resourceKind: string | null;
  resourceId: string | null;
  createdAt: Date | null;
  pageAt: Date;
  recipient: string | null;
  observedRecipient: string | null;
  rawState: string;
  status: string;
  attempts: number;
  observedCount: number;
  firstAt: Date | null;
  lastAt: Date | null;
  completedAt: Date | null;
  nextAt: Date | null;
  code: string | null;
  providerReference: string | null;
};
/** Called only by the source owner with its allowlisted projection, never table names from HTTP. */
export async function sourceEmailRows(
  tx: Prisma.TransactionClient,
  projection: Prisma.Sql,
  q: EmailQuery,
): Promise<EmailRow[]> {
  const where: Prisma.Sql[] = [Prisma.sql`true`];
  if (q.id) where.push(Prisma.sql`id=${q.id}::uuid`);
  if (q.sourceKind) where.push(Prisma.sql`"sourceKind"=${q.sourceKind}`);
  if (q.category) where.push(Prisma.sql`category=${q.category}`);
  if (q.status) where.push(Prisma.sql`status=${q.status}`);
  if (q.userId)
    where.push(
      Prisma.sql`COALESCE("userId","observedUserId")=${q.userId}::uuid`,
    );
  if (q.resourceId) where.push(Prisma.sql`"resourceId"=${q.resourceId}::uuid`);
  if (q.from) where.push(Prisma.sql`"createdAt">=${new Date(q.from)}`);
  if (q.until) where.push(Prisma.sql`"createdAt"<${new Date(q.until)}`);
  if (q.search) {
    const term = '%' + q.search.replace(/[\\%_]/g, '\\$&') + '%';
    where.push(
      Prisma.sql`(recipient ILIKE ${term} OR "sourceId"::text ILIKE ${term})`,
    );
  }
  if (q.position)
    where.push(
      Prisma.sql`("pageAt",id)>(${q.position.createdAt},${q.position.id}::uuid)`,
    );
  return tx.$queryRaw<EmailRow[]>(Prisma.sql`
    WITH sources AS (${projection}), observed AS (
      SELECT s.*,overlay(overlay(md5(s."sourceKind"||':'||s."sourceId"::text) placing '8' from 13 for 1) placing '8' from 17 for 1)::uuid id,
        COALESCE(s."createdAt",'epoch'::timestamptz) "pageAt",
        COALESCE(o."userId",CASE WHEN EXISTS(SELECT 1 FROM "User" u WHERE u.id=o."subjectUserId") THEN o."subjectUserId" END) "observedUserId",o.recipient "observedRecipient",o.state "observedState",o."createdAt" "observedAt",
        o."completedAt",o.code,o."providerReference",
        a.n::int "observedCount",a.first_at "firstAt",a.last_at "lastAt"
      FROM sources s
      LEFT JOIN LATERAL (SELECT * FROM "SystemEmailObservation" o
        WHERE o."sourceKind"=s."sourceKind" AND o."sourceId"=s."sourceId"
        ORDER BY o."createdAt" DESC,o.id DESC LIMIT 1) o ON true
      LEFT JOIN LATERAL (SELECT count(*) n,min("createdAt") first_at,max("createdAt") last_at
        FROM "SystemEmailObservation" o WHERE o."sourceKind"=s."sourceKind" AND o."sourceId"=s."sourceId") a ON true
    ), shaped AS (
      SELECT *,COALESCE("observedRecipient",CASE WHEN "rawState" IN ('PENDING','RETRY','SENDING','QUEUED') THEN "plannedRecipient" END) recipient,
        CASE WHEN "observedState" IN ('SMTP_ACCEPTED','SINK_ACCEPTED','BOUNCED') THEN "observedState"
          WHEN "observedState"='PROCESSING' AND "observedAt">clock_timestamp()-interval '120 seconds' THEN 'PROCESSING'
          WHEN "observedState" IN ('UNKNOWN','PROCESSING') THEN 'UNKNOWN'
          WHEN "rawState" IN ('PENDING','RETRY','QUEUED','NONE') THEN 'QUEUED'
          WHEN "rawState" IN ('SENDING','PROCESSING') AND "leaseUntil">clock_timestamp() THEN 'PROCESSING'
          WHEN "rawState"='FAILED' THEN 'FAILED'
          WHEN "rawState" IN ('CANCELED','SUPPRESSED') THEN 'CANCELED'
          ELSE 'UNKNOWN' END status
      FROM observed
    ) SELECT id,"sourceKind","sourceId",category,COALESCE("userId","observedUserId") "userId","resourceKind","resourceId",
      "createdAt","pageAt",recipient,"observedRecipient","rawState",status,
      GREATEST(attempts,"observedCount")::int attempts,"observedCount","firstAt","lastAt",
      "completedAt","nextAt",CASE WHEN "observedState" IN ('FAILED','UNKNOWN') THEN code
        WHEN "rawState"='FAILED' THEN 'MAIL_TRANSPORT_FAILED' ELSE NULL END code,"providerReference"
      FROM shaped WHERE ${Prisma.join(where, ' AND ')}
      ORDER BY "pageAt",id LIMIT ${q.limit + 1}`);
}
export function directEmailRows(tx: Prisma.TransactionClient, q: EmailQuery) {
  return sourceEmailRows(
    tx,
    Prisma.sql`SELECT 'DIRECT'::text "sourceKind",o."sourceId",o.category,
    o."createdAt",o."userId",o.recipient "plannedRecipient",
    CASE WHEN o."userId" IS NOT NULL THEN 'USER' WHEN o."adminUserId" IS NOT NULL THEN 'ADMIN_OPERATOR' END "resourceKind",
    COALESCE(o."userId",o."adminUserId") "resourceId",o.state "rawState",0::int attempts,
    NULL::timestamptz "nextAt",NULL::timestamptz "leaseUntil"
    FROM "SystemEmailObservation" o WHERE o."sourceKind"='DIRECT'`,
    q,
  );
}
