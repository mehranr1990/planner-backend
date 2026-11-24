import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import { cursorPage } from '../../../platform/database/cursor-pagination.js';
import {
  adminPageContext,
  type AdminPage,
} from '../../../platform/auth/admin-identity.js';
import type {
  AdminMembershipQuerySchema,
  AdminInvitationQuerySchema,
} from '@mehran/api-contracts';
import type { z } from 'zod';
import { effectiveSuspension } from '../../../platform/admin/management-policy.js';
const projection = Prisma.sql`WITH workspaces AS (
 SELECT p.id,p.id AS "spaceId",CASE WHEN p.kind='PERSONAL' THEN 'PERSONAL' ELSE c.kind END AS type,p."ownerUserId",c."primaryOwnerAccessId" AS "ownerAccessId",COALESCE(c.state,'ACTIVE') AS "lifecycleState",COALESCE(c.revision,1) AS "custodyRevision",p."adminRevision",p."suspendedAt",p."suspensionExpiresAt",p."suspensionReason",p."createdAt",p."updatedAt",NULL::uuid AS "companyId",NULL::uuid AS "parentScopeId"
 FROM "Space" p LEFT JOIN "SharedCustody" c ON c."spaceId"=p.id WHERE p.kind='PERSONAL' OR c.kind IN ('TEAM','COMPANY')
 UNION ALL
 SELECT d."scopeId",d."spaceId",d.kind,NULL::uuid,d."primaryOwnerAccessId",d.state,d.revision,a."adminRevision",a."suspendedAt",a."suspensionExpiresAt",a."suspensionReason",d."createdAt",d."createdAt",d."spaceId",d."parentScopeId" FROM "DomainScopeCustody" d JOIN "AccessScope" a ON a.id=d."scopeId" AND a."spaceId"=d."spaceId" WHERE d.kind='TEAM'
)`;
type Workspace = {
  id: string;
  spaceId: string;
  companyId: string | null;
  parentScopeId: string | null;
  type: 'PERSONAL' | 'TEAM' | 'COMPANY';
  ownerUserId: string | null;
  ownerAccessId: string | null;
  lifecycleState: string;
  custodyRevision: number;
  adminRevision: number;
  suspendedAt: Date | null;
  suspensionExpiresAt: Date | null;
  suspensionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};
@Injectable()
export class AdminSpaces {
  async usageMetrics(from: Date, until: Date) {
    const features = await this.db.client.sharedUsageEntry.groupBy({
      by: ['feature'],
      where: { createdAt: { gte: from, lt: until } },
      _sum: { delta: true },
      orderBy: { feature: 'asc' },
    });
    return {
      available: true as const,
      definition: 'NET_LEDGER_DELTA' as const,
      features: features.map((row) => ({
        feature: row.feature,
        delta: row._sum.delta ?? 0,
      })),
    };
  }
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  async detail(id: string, tx: Prisma.TransactionClient = this.db.client) {
    const [row] = await tx.$queryRaw<Workspace[]>(
      Prisma.sql`${projection} SELECT * FROM workspaces WHERE id=${id}::uuid`,
    );
    if (!row) throw new NotFoundException();
    const owner = row.ownerAccessId
      ? await tx.contextAccess.findUnique({
          where: { id: row.ownerAccessId },
          select: { SharedActor: { select: { userId: true } } },
        })
      : null;
    const activeMembers =
      row.type === 'PERSONAL'
        ? 1
        : await tx.contextAccess.count({
            where: {
              spaceId: row.spaceId,
              scopeId: id,
              state: 'ACTIVE',
              memberRole: { not: null },
              SharedActor: { state: 'ACTIVE' },
            },
          });
    const pendingInvitations =
      row.type === 'PERSONAL'
        ? 0
        : await tx.contextInvitation.count({
            where: {
              spaceId: row.spaceId,
              OR: [
                { companyScopeId: id },
                { companyScopeId: null, scopeId: id },
              ],
              state: 'PENDING',
              expiresAt: { gt: new Date() },
            },
          });
    return {
      id,
      spaceId: row.spaceId,
      companyId: row.companyId,
      parentScopeId: row.parentScopeId,
      type: row.type,
      ownerUserId: row.ownerUserId ?? owner?.SharedActor.userId ?? null,
      ownerAccessId: row.ownerAccessId,
      lifecycleState: row.lifecycleState,
      custodyRevision: row.custodyRevision,
      revision: row.adminRevision,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      status: effectiveSuspension(row)
        ? ('SUSPENDED' as const)
        : ('ACTIVE' as const),
      suspension: row.suspendedAt
        ? {
            publicReason: row.suspensionReason,
            expiresAt: row.suspensionExpiresAt,
            effective: effectiveSuspension(row),
          }
        : null,
      activeMembers,
      pendingInvitations,
      capacity: {
        available: false as const,
        reason: 'No commercial seat limit is active',
      },
      usage: {
        available: false as const,
        reason: 'No privacy-safe resource projection',
      },
    };
  }
  async list(actor: string, q: AdminPage) {
    const { scope, filter, position } = adminPageContext(actor, 'spaces', q),
      desc = q.sort === 'createdAt_desc';
    const rows = await this.db.client.$queryRaw<
      { id: string; createdAt: Date }[]
    >(
      Prisma.sql`${projection} SELECT id,"createdAt" FROM workspaces WHERE (${q.type ?? null}::text IS NULL OR type=${q.type ?? null}) AND (${q.status ?? null}::text IS NULL OR (CASE WHEN "suspendedAt" IS NOT NULL AND ("suspensionExpiresAt" IS NULL OR "suspensionExpiresAt">clock_timestamp()) THEN 'SUSPENDED' ELSE 'ACTIVE' END)=${q.status ?? null}) AND (${q.search ?? null}::text IS NULL OR strpos(id::text,${q.search ?? ''})>0) AND (${q.from ?? null}::timestamptz IS NULL OR "createdAt">=${q.from ?? null}::timestamptz) AND (${q.until ?? null}::timestamptz IS NULL OR "createdAt"<${q.until ?? null}::timestamptz) ${position ? (desc ? Prisma.sql`AND ("createdAt",id)<(${position.createdAt},${position.id}::uuid)` : Prisma.sql`AND ("createdAt",id)>(${position.createdAt},${position.id}::uuid)`) : Prisma.empty} ORDER BY "createdAt" ${desc ? Prisma.sql`DESC` : Prisma.sql`ASC`},id ${desc ? Prisma.sql`DESC` : Prisma.sql`ASC`} LIMIT ${q.limit + 1}`,
    );
    const page = cursorPage(scope, filter, q.limit, rows);
    return {
      ...page,
      items: await Promise.all(page.items.map((r) => this.detail(r.id))),
    };
  }
  async change(
    tx: Prisma.TransactionClient,
    id: string,
    operation: string,
    input: { revision: number; reason: string; expiresAt?: string | undefined },
  ) {
    const before = await this.detail(id, tx);
    if (id === before.spaceId) {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'personal-access:' + id},0))::text`;
      await tx.$queryRaw`SELECT id FROM "Space" WHERE id=${id}::uuid FOR UPDATE`;
    } else
      await tx.$queryRaw`SELECT id FROM "AccessScope" WHERE id=${id}::uuid FOR UPDATE`;
    const now = new Date(),
      expiry = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiry && expiry <= now) throw new BadRequestException();
    const data = {
      adminRevision: { increment: 1 },
      suspendedAt: operation === 'suspend' ? now : null,
      suspensionExpiresAt: operation === 'suspend' ? expiry : null,
      suspensionReason: operation === 'suspend' ? input.reason : null,
    };
    const result =
      id === before.spaceId
        ? await tx.space.updateMany({
            where: { id, adminRevision: input.revision },
            data,
          })
        : await tx.accessScope.updateMany({
            where: {
              id,
              spaceId: before.spaceId,
              adminRevision: input.revision,
            },
            data,
          });
    if (result.count !== 1)
      throw new ConflictException({ code: 'STALE_REVISION' });
    return this.detail(id, tx);
  }
  async memberships(
    actor: string,
    q: z.infer<typeof AdminMembershipQuerySchema>,
    selector: { spaceId?: string; userId?: string },
  ) {
    const { scope, filter, position } = adminPageContext(
      actor,
      'memberships:' + JSON.stringify(selector) + ':' + q.status + ':' + q.role,
      { ...q, status: undefined },
    );
    const context = selector.spaceId
        ? await this.detail(selector.spaceId)
        : null,
      desc = q.sort === 'createdAt_desc';
    type Row = {
      id: string;
      spaceId: string;
      scopeId: string;
      state: string;
      role: string | null;
      revision: number;
      generation: number;
      createdAt: Date;
      endedAt: Date | null;
      userId: string | null;
    };
    const rows = await this.db.client.$queryRaw<Row[]>(
      Prisma.sql`SELECT a.id,a."spaceId",a."scopeId",a.state,CASE WHEN a.id=COALESCE(d."primaryOwnerAccessId",c."primaryOwnerAccessId") THEN 'OWNER' ELSE a."memberRole" END AS role,a.revision,a.generation,a."joinedAt" AS "createdAt",a."endedAt",u."userId" FROM "ContextAccess" a JOIN "SharedActor" u ON u.id=a."actorId" JOIN "SharedCustody" c ON c."spaceId"=a."spaceId" LEFT JOIN "DomainScopeCustody" d ON d."scopeId"=a."scopeId" WHERE a."memberRole" IS NOT NULL AND (${context?.spaceId ?? null}::uuid IS NULL OR a."spaceId"=${context?.spaceId ?? null}::uuid AND a."scopeId"=${selector.spaceId ?? null}::uuid) AND (${selector.userId ?? null}::uuid IS NULL OR u."userId"=${selector.userId ?? null}::uuid) AND (${q.status ?? null}::text IS NULL OR a.state=${q.status ?? null}) AND (${q.role ?? null}::text IS NULL OR CASE WHEN a.id=COALESCE(d."primaryOwnerAccessId",c."primaryOwnerAccessId") THEN 'OWNER' ELSE a."memberRole" END=${q.role ?? null}) AND (${q.search ?? null}::text IS NULL OR strpos(a.id::text,${q.search ?? ''})>0 OR strpos(COALESCE(u."userId"::text,''),${q.search ?? ''})>0) AND (${q.from ?? null}::timestamptz IS NULL OR a."joinedAt">=${q.from ?? null}::timestamptz) AND (${q.until ?? null}::timestamptz IS NULL OR a."joinedAt"<${q.until ?? null}::timestamptz) ${position ? (desc ? Prisma.sql`AND (a."joinedAt",a.id)<(${position.createdAt},${position.id}::uuid)` : Prisma.sql`AND (a."joinedAt",a.id)>(${position.createdAt},${position.id}::uuid)`) : Prisma.empty} ORDER BY a."joinedAt" ${desc ? Prisma.sql`DESC` : Prisma.sql`ASC`},a.id ${desc ? Prisma.sql`DESC` : Prisma.sql`ASC`} LIMIT ${q.limit + 1}`,
    );
    return cursorPage(scope, filter, q.limit, rows);
  }
  async invitations(
    actor: string,
    id: string,
    q: z.infer<typeof AdminInvitationQuerySchema>,
  ) {
    const context = await this.detail(id),
      { scope, filter, position } = adminPageContext(
        actor,
        'invitations:' + id + ':' + q.status,
        { ...q, status: undefined },
      ),
      desc = q.sort === 'createdAt_desc';
    type Row = {
      id: string;
      spaceId: string;
      scopeId: string;
      memberRole: string;
      state: string;
      revision: number;
      createdAt: Date;
      expiresAt: Date;
      endedAt: Date | null;
      recipientUserId: string | null;
    };
    const rows = await this.db.client.$queryRaw<Row[]>(
      Prisma.sql`SELECT i.id,i."spaceId",COALESCE(i."companyScopeId",i."scopeId") AS "scopeId",i."memberRole",CASE WHEN i.state='PENDING' AND i."expiresAt"<=clock_timestamp() THEN 'EXPIRED' ELSE i.state END AS state,i.revision,i."createdAt",i."expiresAt",i."endedAt",i."recipientUserId" FROM "ContextInvitation" i WHERE i."spaceId"=${context.spaceId}::uuid AND COALESCE(i."companyScopeId",i."scopeId")=${id}::uuid AND (${q.status ?? null}::text IS NULL OR CASE WHEN i.state='PENDING' AND i."expiresAt"<=clock_timestamp() THEN 'EXPIRED' ELSE i.state END=${q.status ?? null}) AND (${q.search ?? null}::text IS NULL OR strpos(i.id::text,${q.search ?? ''})>0 OR strpos(COALESCE(i."recipientUserId"::text,''),${q.search ?? ''})>0) AND (${q.from ?? null}::timestamptz IS NULL OR i."createdAt">=${q.from ?? null}::timestamptz) AND (${q.until ?? null}::timestamptz IS NULL OR i."createdAt"<${q.until ?? null}::timestamptz) ${position ? (desc ? Prisma.sql`AND (i."createdAt",i.id)<(${position.createdAt},${position.id}::uuid)` : Prisma.sql`AND (i."createdAt",i.id)>(${position.createdAt},${position.id}::uuid)`) : Prisma.empty} ORDER BY i."createdAt" ${desc ? Prisma.sql`DESC` : Prisma.sql`ASC`},i.id ${desc ? Prisma.sql`DESC` : Prisma.sql`ASC`} LIMIT ${q.limit + 1}`,
    );
    return cursorPage(scope, filter, q.limit, rows);
  }
  async metrics(from: Date, until: Date) {
    const totals = await this.db.client.$queryRaw<
      { type: string; count: number }[]
    >(
      Prisma.sql`${projection} SELECT type,count(*)::int AS count FROM workspaces GROUP BY type`,
    );
    const growth = await this.db.client.$queryRaw<
      { day: string; count: number }[]
    >(
      Prisma.sql`${projection} SELECT to_char("createdAt" AT TIME ZONE 'UTC','YYYY-MM-DD') AS "day",count(*)::int AS count FROM workspaces WHERE "createdAt">=${from} AND "createdAt"<${until} GROUP BY 1 ORDER BY 1`,
    );
    const activeMemberships = await this.db.client.contextAccess.count({
      where: {
        state: 'ACTIVE',
        memberRole: { not: null },
        SharedActor: { state: 'ACTIVE' },
      },
    });
    const invitations = await this.db.client.$queryRaw<
      { state: string; _count: number }[]
    >`SELECT CASE WHEN state='PENDING' AND "expiresAt"<=clock_timestamp() THEN 'EXPIRED' ELSE state END AS state,count(*)::int AS "_count" FROM "ContextInvitation" WHERE "createdAt">=${from} AND "createdAt"<${until} GROUP BY 1 ORDER BY 1`;
    return {
      personal: totals.find((t) => t.type === 'PERSONAL')?.count ?? 0,
      team: totals.find((t) => t.type === 'TEAM')?.count ?? 0,
      company: totals.find((t) => t.type === 'COMPANY')?.count ?? 0,
      activeMemberships,
      invitations,
      growth,
    };
  }
}
