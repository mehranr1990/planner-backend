import { AnalyticsCatalog } from '@mehran/api-contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import { configurationSubject } from '../configuration/configuration-core.js';

/** Only metadata from a committed, authorized domain operation enters analytics. */
export async function captureAnalytics(
  tx: Prisma.TransactionClient,
  event: {
    id: string;
    type: string;
    version: number;
    userId: string;
    spaceId: string;
    scopeId?: string;
  },
) {
  const catalog = AnalyticsCatalog[event.type as keyof typeof AnalyticsCatalog];
  if (
    !catalog ||
    catalog.version !== event.version ||
    catalog.category !== 'PRODUCT'
  )
    return;
  await tx.$queryRaw`SELECT u.id FROM "User" u JOIN "Space" s ON s.id=${event.spaceId}::uuid WHERE u.id=${event.userId}::uuid FOR KEY SHARE OF u,s`;
  if (event.scopeId)
    await tx.$queryRaw`SELECT id FROM "AccessScope" WHERE id=${event.scopeId}::uuid FOR KEY SHARE`;
  await tx.$queryRaw`SELECT id FROM "ProductAnalyticsPolicy" WHERE id='GLOBAL' FOR SHARE`;
  const subject = await configurationSubject(tx, {
    userId: event.userId,
    workspaceId: event.scopeId ?? event.spaceId,
    clientVersion: 1,
  });
  const workspaceType =
    subject.scopeType ??
    (event.scopeId &&
    (
      await tx.sharedCustody.findUnique({
        where: { spaceId: event.spaceId },
        select: { kind: true },
      })
    )?.kind === 'PROJECT'
      ? 'OTHER'
      : null);
  if (!workspaceType) return;
  await tx.$executeRaw`INSERT INTO "ProductAnalyticsEvent" (id,"userId","spaceId","scopeId","workspaceType",name,version,feature,meaningful,"occurredAt")
    SELECT ${event.id}::uuid,${event.userId}::uuid,${event.spaceId}::uuid,${event.scopeId ?? null}::uuid,${workspaceType},${event.type},1,${catalog.feature},true,clock_timestamp()
    FROM "ProductAnalyticsPolicy" WHERE id='GLOBAL' AND product
    ON CONFLICT (id) DO NOTHING`;
}
