import {
  Inject,
  Injectable,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  Prisma,
  SharedExitWork,
  ContextAccess,
} from '../../../generated/prisma/client.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import { APP_CONFIG } from '../../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../../bootstrap/environment.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { SharedIdentity } from '../../../platform/auth/shared-identity.js';
import { PrivacyGate } from '../../../platform/authorization/privacy-gate.js';
import { SharedControl } from '../../../platform/storage/shared-control.js';
import type { SharedControlRecord } from '../../../platform/storage/shared-control.js';
import { SharedAuthority } from '../public/shared-authority.js';
import type { SharedCleanupScope } from '../../../platform/lifecycle/shared-cleanup.js';
import { assertSharedCleanupCatalog } from '../../../platform/lifecycle/shared-cleanup-catalog.js';
import { SharedFeaturePolicy } from '../public/shared-features.js';
import type { SharedFeatureKey } from '../public/shared-features.js';
import type { SharedAccess } from '../public/shared-authority.js';
import { SharedRetentionSchema } from './shared-retention.js';
import {
  captureSharedReplay,
  applySharedReplay,
} from './shared-replay-state.js';
import type { SharedRestoreScope } from '../../../platform/lifecycle/shared-replay.js';
import {
  defaultPolicy,
  permits,
  validateRoleDefaults,
  roleAdministration,
} from '../domain/shared-policy.js';
import type {
  SharedCapability,
  MemberRole,
  RoleDefaults,
} from '../domain/shared-policy.js';

export type SharedRequest = {
  spaceId: string;
  scopeId: string;
  capability: SharedCapability;
  generation?: number;
  authorizationVersion?: bigint;
  resource?: { kind: 'PROJECT' | 'TASK' | 'GOAL'; id: string };
  allowArchived?: boolean;
  guestDeparture?: boolean;
};
type LockSet = { userIds: string[]; spaceIds: string[] };
type AccessChange = {
  spaceId: string;
  scopeId: string;
  accessId: string;
  revision: number;
  state: 'ACTIVE' | 'SUSPENDED' | 'LEFT' | 'REVOKED';
  memberRole: MemberRole;
};
const uuid = z.uuid();
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
function retryable(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const e = error as {
    code?: string;
    meta?: {
      code?: string;
      driverAdapterError?: { cause?: { originalCode?: string } };
    };
  };
  return (
    e.code === 'P2034' ||
    ['40P01', '40001'].includes(
      e.meta?.code ?? e.meta?.driverAdapterError?.cause?.originalCode ?? '',
    )
  );
}
function knownRollback(error: unknown) {
  return (
    error instanceof ForbiddenException ||
    error instanceof NotFoundException ||
    error instanceof ConflictException ||
    error instanceof BadRequestException ||
    retryable(error)
  );
}
@Injectable()
export class SharedKernel {
  // A control view lives only inside one already-fenced DB transaction. Every new transaction reloads it.
  private readonly controlViews = new WeakMap<
    object,
    Promise<Awaited<ReturnType<SharedControl['currentEvidence']>>>
  >();
  private controlView(tx: Prisma.TransactionClient) {
    if (tx === this.db.client) return this.control.currentEvidence();
    let view = this.controlViews.get(tx);
    if (!view) {
      view = this.control.currentEvidence();
      this.controlViews.set(tx, view);
    }
    return view;
  }
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SharedIdentity) private readonly identity: SharedIdentity,
    @Inject(SharedControl) private readonly control: SharedControl,
    @Inject(PrivacyGate) private readonly privacy: PrivacyGate,
    @Inject(SharedFeaturePolicy) private readonly features: SharedFeaturePolicy,
  ) {}
  private enabled() {
    this.privacy.assert();
    if (
      !this.config.SHARED_SECURITY_ACCEPTANCE_REFERENCE ||
      !this.config.SHARED_CONTROL_ACTIVE_KEY_ID
    )
      throw new ForbiddenException({ code: 'SHARED_ACTIVATION_GATED' });
  }
  assertEnabled() {
    this.enabled();
  }
  async contextState(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    spaceId: string,
    projectId: string,
  ) {
    a.require(tx, spaceId, 'task.read', { kind: 'PROJECT', id: projectId });
    return (await tx.sharedCustody.findUniqueOrThrow({ where: { spaceId } }))
      .state;
  }
  async recipientUserHint(userId: string) {
    return (await this.identity.current(this.db.client, userId))?.id ?? null;
  }
  async projectStatus(actor: RequestActor, spaceId: string) {
    this.enabled();
    if (!actor.sessionId) throw new ForbiddenException();
    const users = await this.requiredUsers(actor, [spaceId], []);
    return this.transaction(users, [spaceId], actor, async (tx) => {
      if (!(await this.accountActive(tx, actor.userId)))
        throw new NotFoundException();
      const custody = await tx.sharedCustody.findUniqueOrThrow({
          where: { spaceId },
        }),
        local = await tx.sharedActor.findFirst({
          where: { spaceId, userId: actor.userId, state: 'ACTIVE' },
        });
      const access =
        local &&
        (await tx.contextAccess.findUnique({
          where: {
            spaceId_scopeId_actorId: {
              spaceId,
              scopeId: spaceId,
              actorId: local.id,
            },
          },
        }));
      if (
        !access?.memberRole ||
        !(
          access.id === custody.primaryOwnerAccessId ||
          ['ACTIVE', 'SUSPENDED'].includes(access.state)
        )
      )
        throw new NotFoundException();
      await this.offerControl(tx, spaceId, custody.authorizationVersion);
      const job = await tx.sharedLifecycleJob.findUnique({
        where: {
          custodyId_generation: {
            custodyId: spaceId,
            generation: custody.closureGeneration,
          },
        },
      });
      return {
        spaceId,
        state: custody.state,
        authorizationVersion: String(custody.authorizationVersion),
        closureGeneration: custody.closureGeneration,
        recoveryDeadline: job?.recoveryDeadline?.toISOString() ?? null,
        jobState: job?.state ?? null,
      };
    });
  }
  async exportBounds(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    spaceId: string,
  ) {
    const access = a.require(tx, spaceId, 'export.visible');
    const scope = await tx.accessScope.findUniqueOrThrow({
      where: { id: spaceId },
    });
    const policy = await tx.contextCapabilityPolicy.findUniqueOrThrow({
      where: {
        spaceId_scopeId_version: {
          spaceId,
          scopeId: spaceId,
          version: scope.currentPolicyVersion,
        },
      },
    });
    return {
      maxRecords: Math.min(10000, policy.exportMaxRecords),
      maxBytes: Math.min(10485760, policy.exportMaxBytes),
      authorizationVersion: String(access.authorizationVersion),
    };
  }
  async featureGrowth(
    tx: Prisma.TransactionClient,
    spaceId: string,
    feature: SharedFeatureKey,
    ownerUserId?: string,
  ) {
    const decision = await this.features.decide(
      {
        feature,
        currentUsage: await this.usageCount(tx, spaceId, feature, ownerUserId),
        usageOwner: ownerUserId
          ? { kind: 'PERSONAL_ACCOUNT', userId: ownerUserId }
          : { kind: 'SHARED_CUSTODY', spaceId },
        growth: 1,
      },
      tx,
    );
    if (!decision.allowed)
      throw new ForbiddenException({ code: 'SHARED_FEATURE_UNAVAILABLE' });
  }
  async featureBatchGrowth(
    tx: Prisma.TransactionClient,
    spaceId: string,
    feature: SharedFeatureKey,
    count: number,
  ) {
    if (!Number.isSafeInteger(count) || count < 1 || count > 200)
      throw new BadRequestException();
    const current = await this.usageCount(tx, spaceId, feature);
    for (let i = 0; i < count; i++)
      if (
        !(
          await this.features.decide(
            {
              feature,
              currentUsage: current + i,
              usageOwner: { kind: 'SHARED_CUSTODY', spaceId },
              growth: 1,
            },
            tx,
          )
        ).allowed
      )
        throw new ForbiddenException({ code: 'SHARED_FEATURE_UNAVAILABLE' });
  }
  async offerBatchEffect(
    tx: Prisma.TransactionClient,
    actor: RequestActor,
    spaceId: string,
    actorId: string,
    action: string,
    resourceId: string,
    auditId: string,
    usage: { feature: SharedFeatureKey; delta: number }[],
  ) {
    if (
      usage.some(
        (item) => !Number.isSafeInteger(item.delta) || item.delta < 1,
      ) ||
      usage.reduce((n, item) => n + item.delta, 0) > 200
    )
      throw new BadRequestException();
    // Preserve the existing one-unit, one-audit ledger contract. The entire batch
    // is one atomic transaction covered by the caller's signed minimum-version intent.
    let first = true;
    for (const item of usage)
      for (let i = 0; i < item.delta; i++) {
        await this.offerEffect(
          tx,
          actor,
          spaceId,
          actorId,
          action,
          resourceId,
          first ? auditId : randomUUID(),
          { actorId, feature: item.feature, delta: 1 },
        );
        first = false;
      }
    if (first)
      await this.offerEffect(
        tx,
        actor,
        spaceId,
        actorId,
        action,
        resourceId,
        auditId,
      );
  }
  private async usageCount(
    tx: Prisma.TransactionClient,
    spaceId: string,
    feature: SharedFeatureKey,
    ownerUserId?: string,
  ) {
    if (feature === 'shared.custody')
      return (
        await tx.$queryRaw<
          { count: number }[]
        >`SELECT count(*)::int AS count FROM "SharedCustody" c JOIN "ContextAccess" a ON a.id=c."primaryOwnerAccessId" JOIN "SharedActor" s ON s.id=a."actorId" WHERE s."userId"=${ownerUserId ?? null}::uuid AND c.kind='PROJECT' AND c.state IN ('ACTIVE','ARCHIVED') AND a.state='ACTIVE' AND s.state='ACTIVE'`
      )[0]!.count;
    if (feature === 'shared.membership') {
      let count = 0;
      for (const a of await tx.contextAccess.findMany({
        where: {
          spaceId,
          scopeId: spaceId,
          state: { in: ['ACTIVE', 'SUSPENDED'] },
          memberRole: { not: null },
        },
      })) {
        const local = await tx.sharedActor.findUniqueOrThrow({
          where: { id: a.actorId },
        });
        if (
          local.userId &&
          (await this.accountActive(tx, local.userId)) &&
          !(await this.endedByClosure(tx, local.userId, a.joinedAt))
        )
          count++;
      }
      return count;
    }
    return (
      (
        await tx.sharedUsageEntry.aggregate({
          where: { spaceId, feature },
          _sum: { delta: true },
        })
      )._sum.delta ?? 0
    );
  }
  async offerUserHints(spaceId: string, userId: string) {
    return this.requiredUsers(
      { userId, requestId: randomUUID(), correlationId: randomUUID() },
      [spaceId],
      [],
    );
  }
  async verifiedRecipient(tx: Prisma.TransactionClient, userId: string) {
    const identity = await this.identity.current(tx, userId);
    if (!identity?.emailVerified || !(await this.accountActive(tx, userId)))
      throw new NotFoundException();
    return identity;
  }
  async readableContextHints(actor: RequestActor) {
    this.enabled();
    if (!actor.sessionId) throw new ForbiddenException();
    await this.control.records();
    return this.transaction([actor.userId], [], actor, async (tx) => {
      if (!(await this.accountActive(tx, actor.userId)))
        throw new ForbiddenException();
      const userId = actor.userId;
      const rows = await tx.$queryRaw<
        {
          id: string;
          version: string;
          generation: number;
          actorId: string;
          accessId: string;
          role: string;
        }[]
      >`SELECT s.id,c."authorizationVersion"::text AS version,a.generation,a."actorId",a.id AS "accessId",CASE WHEN a.id=c."primaryOwnerAccessId" THEN 'OWNER' ELSE a."memberRole" END AS role FROM "AccessScope" s
      JOIN "SharedCustody" c ON c."spaceId"=s."spaceId"
      JOIN "ContextAccess" a ON a."spaceId"=s."spaceId" AND a."scopeId"=s.id
      JOIN "SharedActor" u ON u.id=a."actorId"
      JOIN "ContextCapabilityPolicy" p ON p."spaceId"=s."spaceId" AND p."scopeId"=s.id AND p.version=s."currentPolicyVersion"
      JOIN "ContextAccess" owner ON owner.id=c."primaryOwnerAccessId"
      JOIN "SharedActor" custodian ON custodian.id=owner."actorId"
      JOIN "Space" account ON account."ownerUserId"=custodian."userId" AND account.kind='PERSONAL'
      JOIN "Space" ownaccount ON ownaccount."ownerUserId"=u."userId" AND ownaccount.kind='PERSONAL'
      WHERE u."userId"=${userId}::uuid AND u.state='ACTIVE' AND a.state='ACTIVE' AND a."memberRole" IS NOT NULL
      AND c.state IN ('ACTIVE','ARCHIVED') AND s.state IN ('ACTIVE','ARCHIVED') AND account."accessClosedAt" IS NULL AND ownaccount."accessClosedAt" IS NULL
      AND (p."roleDefaults" -> (CASE WHEN a.id=c."primaryOwnerAccessId" THEN 'OWNER' ELSE a."memberRole" END)) ? 'task.read' ORDER BY s.id`;
      return {
        ids: rows.map((r) => r.id),
        members: rows,
        stamp: hash(JSON.stringify(rows)),
      };
    });
  }
  cursorPosition(
    context: string,
    stamp: string,
    userId: string,
    token?: string,
  ) {
    if (token === undefined) return undefined;
    let value: {
      context: string;
      stamp: string;
      userId: string;
      after: string;
    };
    try {
      value = z
        .strictObject({
          context: z.string().max(100),
          stamp: z.string().regex(/^[a-f0-9]{64}$/),
          userId: z.uuid(),
          after: z.uuid(),
        })
        .parse(this.control.verifyCursor(token));
    } catch {
      throw new BadRequestException({ code: 'INVALID_CURSOR' });
    }
    if (value.context !== context || value.userId !== userId)
      throw new BadRequestException({ code: 'INVALID_CURSOR' });
    if (value.stamp !== stamp)
      throw new ConflictException({ code: 'CURSOR_AUTHORITY_CHANGED' });
    return value.after;
  }
  cursorPage<T>(
    context: string,
    stamp: string,
    userId: string,
    page: { items: T[]; nextCursor: string | null },
  ) {
    return {
      ...page,
      nextCursor: page.nextCursor
        ? this.control.signCursor({
            context,
            stamp,
            userId,
            after: page.nextCursor,
          })
        : null,
    };
  }
  scopeCursor(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    r: SharedRequest,
    kind: string,
  ) {
    const access = a.require(tx, r.spaceId, r.capability, r.resource);
    return {
      context: r.scopeId + ':' + kind,
      stamp: hash(
        JSON.stringify({
          actor: access.actorId,
          generation: access.generation,
          version: String(access.authorizationVersion),
          role: access.role,
          capability: r.capability,
        }),
      ),
    };
  }
  async creatorIs(
    tx: Prisma.TransactionClient,
    actorId: string,
    userId: string,
  ) {
    return (
      (await tx.sharedActor.findUnique({ where: { id: actorId } }))?.userId ===
      userId
    );
  }
  async memberUserHint(spaceId: string, accessId: string) {
    const a = await this.db.client.contextAccess.findFirst({
      where: { id: accessId, spaceId },
    });
    return a
      ? ((
          await this.db.client.sharedActor.findUnique({
            where: { id: a.actorId },
          })
        )?.userId ?? null)
      : null;
  }
  async memberUserInTransaction(
    tx: Prisma.TransactionClient,
    spaceId: string,
    accessId: string,
  ) {
    const access = await tx.contextAccess.findFirst({
      where: { id: accessId, spaceId, scopeId: spaceId },
    });
    return access
      ? ((await tx.sharedActor.findUnique({ where: { id: access.actorId } }))
          ?.userId ?? null)
      : null;
  }
  /** Read-only current membership visibility; never issues mutation authority. */
  async visibleWorkMember(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    spaceId: string,
    id: string,
    generation: number,
  ) {
    a.require(tx, spaceId, 'task.read');
    const user = await this.memberUserInTransaction(tx, spaceId, id);
    try {
      await this.toolParticipant(tx, spaceId, id, generation, user, [
        'task.read',
      ]);
      return true;
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof ConflictException
      )
        return false;
      throw error;
    }
  }
  async resourceLockHints(actor: RequestActor, requests: SharedRequest[]) {
    return this.grantIssuerHints(actor.userId, requests);
  }
  async toolParticipant(
    tx: Prisma.TransactionClient,
    spaceId: string,
    accessId: string,
    generation: number,
    lockedUser: string | null,
    capabilities: SharedRequest['capability'][],
  ) {
    await this.eligibleMember(tx, spaceId, accessId, lockedUser);
    const access = await tx.contextAccess.findUniqueOrThrow({
      where: { id: accessId },
    });
    if (access.generation !== generation) throw new ConflictException();
    const custody = await tx.sharedCustody.findUniqueOrThrow({
        where: { spaceId },
      }),
      scope = await tx.accessScope.findUniqueOrThrow({
        where: { id: spaceId },
      });
    const policy = await tx.contextCapabilityPolicy.findUniqueOrThrow({
      where: {
        spaceId_scopeId_version: {
          spaceId,
          scopeId: spaceId,
          version: scope.currentPolicyVersion,
        },
      },
    });
    const role =
      access.id === custody.primaryOwnerAccessId
        ? 'OWNER'
        : (access.memberRole as MemberRole);
    if (
      capabilities.some(
        (cap) => !permits(role, cap, policy.roleDefaults as RoleDefaults),
      )
    )
      throw new ForbiddenException();
    return {
      accessId: access.id,
      generation: access.generation,
      actorId: access.actorId,
    };
  }
  async eligibleMember(
    tx: Prisma.TransactionClient,
    spaceId: string,
    accessId: string,
    lockedUser: string | null,
  ) {
    const a = await tx.contextAccess.findFirst({
      where: {
        id: accessId,
        spaceId,
        scopeId: spaceId,
        state: 'ACTIVE',
        memberRole: { not: null },
      },
    });
    const actor =
      a && (await tx.sharedActor.findUnique({ where: { id: a.actorId } }));
    if (
      !a ||
      !actor?.userId ||
      actor.userId !== lockedUser ||
      actor.state !== 'ACTIVE' ||
      !(await this.accountActive(tx, actor.userId)) ||
      (await this.endedByClosure(tx, actor.userId, a.joinedAt)) ||
      !(await this.identity.current(tx, actor.userId))?.emailVerified
    )
      throw new NotFoundException();
    return { id: a.id, generation: a.generation };
  }
  async assignmentRecipient(
    tx: Prisma.TransactionClient,
    spaceId: string,
    accessId: string,
    generation: number,
    lockedUser: string | null,
  ) {
    await this.eligibleMember(tx, spaceId, accessId, lockedUser);
    const access = await tx.contextAccess.findUniqueOrThrow({
      where: { id: accessId },
    });
    if (access.generation !== generation) throw new ConflictException();
    const custody = await tx.sharedCustody.findUniqueOrThrow({
      where: { spaceId },
    });
    const scope = await tx.accessScope.findUniqueOrThrow({
      where: { id: spaceId },
    });
    const policy = await tx.contextCapabilityPolicy.findUniqueOrThrow({
      where: {
        spaceId_scopeId_version: {
          spaceId,
          scopeId: spaceId,
          version: scope.currentPolicyVersion,
        },
      },
    });
    const role =
      access.id === custody.primaryOwnerAccessId
        ? 'OWNER'
        : (access.memberRole as MemberRole);
    const defaults = policy.roleDefaults as RoleDefaults;
    if (
      !permits(role, 'task.read', defaults) ||
      !permits(role, 'assignment.accept', defaults) ||
      !permits(role, 'assignment.decline', defaults)
    )
      throw new ForbiddenException();
    return {
      accessId: access.id,
      generation: access.generation,
      actorId: access.actorId,
    };
  }
  async localActor(
    tx: Prisma.TransactionClient,
    spaceId: string,
    accessId: string,
  ) {
    return (
      (
        await tx.contextAccess.findFirst({
          where: { id: accessId, spaceId, scopeId: spaceId },
        })
      )?.actorId ?? null
    );
  }
  private async assignmentDefaults(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    spaceId: string,
  ) {
    const access = a.require(tx, spaceId, 'task.read');
    const scope = await tx.accessScope.findUniqueOrThrow({
      where: { id: spaceId },
    });
    const policy = await tx.contextCapabilityPolicy.findUniqueOrThrow({
      where: {
        spaceId_scopeId_version: {
          spaceId,
          scopeId: spaceId,
          version: scope.currentPolicyVersion,
        },
      },
    });
    return {
      access,
      version: scope.currentPolicyVersion,
      defaults: policy.roleDefaults as RoleDefaults,
    };
  }
  async assignmentManager(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    spaceId: string,
  ) {
    const p = await this.assignmentDefaults(tx, a, spaceId);
    return permits(p.access.role, 'assignment.assign', p.defaults);
  }
  async assignmentPolicy(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    spaceId: string,
  ) {
    const p = await this.assignmentDefaults(tx, a, spaceId);
    return {
      mode: 'EXPLICIT_CONSENT' as const,
      automaticAcceptance: false as const,
      policyVersion: p.version,
    };
  }
  async workHints(actor: RequestActor, includeGoals = false) {
    const full = await this.readableContextHints(actor);
    let resources = includeGoals
      ? await this.transaction(
          [actor.userId],
          [],
          actor,
          (tx) => tx.$queryRaw<
            {
              spaceId: string;
              scopeId: string;
              id: string;
              grantId: string;
              generation: number;
              version: string;
              expiresAt: Date;
            }[]
          >`
      SELECT g."spaceId",g."scopeId",t."goalId" AS id,g.id AS "grantId",a.generation,c."authorizationVersion"::text AS version,g."expiresAt"
      FROM "GoalGrant" t JOIN "ResourceGrant" g ON g.id=t."grantId"
      JOIN "ContextAccess" a ON a.id=g."granteeAccessId" JOIN "SharedActor" u ON u.id=a."actorId"
      JOIN "SharedCustody" c ON c."spaceId"=g."spaceId" JOIN "AccessScope" s ON s.id=g."scopeId"
      WHERE u."userId"=${actor.userId}::uuid AND u.state='ACTIVE' AND a.state='ACTIVE' AND a.generation=g."granteeGeneration"
      AND g."revokedAt" IS NULL AND g."expiresAt">clock_timestamp() AND c.state IN ('ACTIVE','ARCHIVED') AND s.state IN ('ACTIVE','ARCHIVED')
      ORDER BY g.id`,
        )
      : [];
    const candidates = resources;
    resources = [];
    for (const r of candidates) {
      if (full.ids.includes(r.spaceId)) continue;
      const request: SharedRequest = {
        spaceId: r.spaceId,
        scopeId: r.scopeId,
        capability: 'task.read',
        resource: { kind: 'GOAL', id: r.id },
        allowArchived: true,
      };
      try {
        await this.run(
          actor,
          { userIds: [], spaceIds: [r.spaceId] },
          [request],
          async () => undefined,
        );
        resources.push(r);
      } catch (error) {
        if (
          !(error instanceof NotFoundException) &&
          !(error instanceof ForbiddenException)
        )
          throw error;
      }
    }
    const requests: SharedRequest[] = full.ids.map((id) => ({
      spaceId: id,
      scopeId: id,
      capability: 'task.read',
      allowArchived: true,
    }));
    for (const r of resources)
      if (!full.ids.includes(r.spaceId))
        requests.push({
          spaceId: r.spaceId,
          scopeId: r.scopeId,
          capability: 'task.read',
          resource: { kind: 'GOAL', id: r.id },
          allowArchived: true,
        });
    return {
      ...full,
      resources,
      requests,
      spaceIds: [...new Set(requests.map((r) => r.spaceId))],
      stamp: hash(JSON.stringify({ full: full.stamp, resources })),
    };
  }
  async personalWork<T>(
    actor: RequestActor,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    this.enabled();
    if (!actor.sessionId) throw new ForbiddenException();
    return this.transaction([actor.userId], [], actor, async (tx) => {
      if (!(await this.accountActive(tx, actor.userId)))
        throw new NotFoundException();
      return work(tx);
    });
  }
  private async offerControl(
    tx: Prisma.TransactionClient,
    spaceId: string,
    version: bigint,
  ) {
    await this.verifyRestoreFloor(tx);
    const view = await this.controlView(tx);
    const records = view.records.filter((r) => r.spaceId === spaceId);
    const terminal = new Set(
      records.filter((r) => r.outcome !== 'INTENT').map((r) => r.id),
    );
    for (const record of records.filter(
      (r) => r.outcome === 'INTENT' && !terminal.has(r.id),
    )) {
      const committed = await tx.sharedOutboxEvent.findUnique({
        where: { auditId: record.id },
        include: { SharedAuditEvent: true },
      });
      const lifecycle = await tx.sharedLifecycleEffect.findUnique({
        where: { id: record.id },
      });
      if (
        (committed?.spaceId === spaceId &&
          committed.authorizationVersion === BigInt(record.version) &&
          committed.action === record.action &&
          committed.SharedAuditEvent.action === record.action &&
          committed.SharedAuditEvent.resourceId === record.resourceId) ||
        (lifecycle?.custodyId === spaceId &&
          lifecycle.authorizationVersion === BigInt(record.version) &&
          lifecycle.action === record.action &&
          lifecycle.jobId === record.resourceId)
      ) {
        const outcome = {
          ...record,
          outcome: 'COMMITTED' as const,
          at: new Date().toISOString(),
        };
        await this.control.append(outcome);
        view.records.push(outcome);
      }
    }
    // Missing atomic evidence never authorizes automatic abort of an unresolved intent.
    try {
      await this.control.assertCurrent(spaceId, version, view.records);
    } catch (error) {
      if (error instanceof ForbiddenException) throw new NotFoundException();
      throw error;
    }
  }
  private async requiredUsers(
    actor: RequestActor,
    spaceIds: string[],
    additional: string[],
  ) {
    const custodians = await this.db.client.sharedCustody.findMany({
      where: { spaceId: { in: spaceIds } },
      select: { primaryOwnerAccessId: true },
    });
    const accesses = await this.db.client.contextAccess.findMany({
      where: {
        id: {
          in: custodians.flatMap((c) =>
            c.primaryOwnerAccessId ? [c.primaryOwnerAccessId] : [],
          ),
        },
      },
      select: { actorId: true },
    });
    const owners = await this.db.client.sharedActor.findMany({
      where: { id: { in: accesses.map((a) => a.actorId) } },
      select: { userId: true },
    });
    return [
      ...new Set([
        actor.userId,
        ...additional,
        ...owners.flatMap((a) => (a.userId ? [a.userId] : [])),
      ]),
    ].sort();
  }
  private async matchingGrants(
    tx: Prisma.TransactionClient,
    userId: string,
    request: SharedRequest,
  ) {
    const target = request.resource;
    if (!target) return [];
    return tx.$queryRaw<
      {
        id: string;
        capabilities: string[];
        issuerAccessId: string;
        issuerGeneration: number;
        granteeGeneration: number;
        expiresAt: Date;
        revokedAt: Date | null;
      }[]
    >`
      SELECT g.id,g.capabilities,g."issuerAccessId",g."issuerGeneration",g."granteeGeneration",g."expiresAt",g."revokedAt"
      FROM "ResourceGrant" g JOIN "ContextAccess" a ON a.id=g."granteeAccessId"
      JOIN "SharedActor" s ON s.id=a."actorId"
      WHERE g."spaceId"=${request.spaceId}::uuid AND g."scopeId"=${request.scopeId}::uuid AND s."userId"=${userId}::uuid
      AND g."revokedAt" IS NULL AND g."expiresAt">clock_timestamp() AND a.generation=g."granteeGeneration" AND a.state='ACTIVE'
      AND (( ${target.kind}='PROJECT' AND EXISTS(SELECT 1 FROM "ProjectGrant" t WHERE t."grantId"=g.id AND t."projectId"=${target.id}::uuid))
        OR (${target.kind}='TASK' AND EXISTS(SELECT 1 FROM "TaskGrant" t WHERE t."grantId"=g.id AND t."taskId"=${target.id}::uuid))
        OR (${target.kind}='GOAL' AND EXISTS(SELECT 1 FROM "GoalGrant" t WHERE t."grantId"=g.id AND t."goalId"=${target.id}::uuid)))`;
  }
  private async grantIssuerHints(userId: string, requests: SharedRequest[]) {
    const users: string[] = [];
    for (const request of requests.filter((r) => r.resource))
      for (const grant of await this.matchingGrants(
        this.db.client,
        userId,
        request,
      )) {
        const issuer = await this.db.client.contextAccess.findUnique({
          where: { id: grant.issuerAccessId },
        });
        const actor =
          issuer &&
          (await this.db.client.sharedActor.findUnique({
            where: { id: issuer.actorId },
          }));
        if (actor?.userId) users.push(actor.userId);
      }
    return users;
  }
  private async grantPermits(
    tx: Prisma.TransactionClient,
    userId: string,
    access: ContextAccess,
    request: SharedRequest,
    policy: RoleDefaults,
    locked: string[],
  ) {
    const needed =
      request.capability === 'comment.create'
        ? 'comment'
        : request.capability === 'file.read'
          ? 'file.read'
          : request.capability === 'task.read'
            ? 'read'
            : request.capability === 'task.update' ||
                request.capability === 'goal.manage'
              ? 'update'
              : request.capability === 'task.complete'
                ? 'complete'
                : null;
    if (!needed) return false;
    const now = (
      await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() now`
    )[0]!.now;
    const custody = await tx.sharedCustody.findUniqueOrThrow({
      where: { spaceId: request.spaceId },
    });
    for (const grant of await this.matchingGrants(tx, userId, request)) {
      if (
        grant.revokedAt ||
        grant.expiresAt <= now ||
        grant.granteeGeneration !== access.generation ||
        !grant.capabilities.includes(needed)
      )
        continue;
      const issuer = await tx.contextAccess.findUnique({
        where: { id: grant.issuerAccessId },
      });
      const local =
        issuer &&
        (await tx.sharedActor.findUnique({ where: { id: issuer.actorId } }));
      if (
        !issuer ||
        issuer.state !== 'ACTIVE' ||
        !issuer.memberRole ||
        issuer.generation !== grant.issuerGeneration ||
        !local?.userId ||
        local.state !== 'ACTIVE'
      )
        continue;
      if (!locked.includes(local.userId))
        throw new ConflictException({ code: 'GRANT_ISSUER_CHANGED_RESTART' });
      if (
        !(await this.accountActive(tx, local.userId)) ||
        (await this.endedByClosure(tx, local.userId, issuer.joinedAt)) ||
        !(await this.identity.current(tx, local.userId))?.emailVerified
      )
        continue;
      const role =
        issuer.id === custody.primaryOwnerAccessId
          ? 'OWNER'
          : (issuer.memberRole as MemberRole);
      if (!permits(role, 'membership.member', policy)) continue;
      if (
        grant.capabilities.every((cap) => {
          if (request.resource!.kind === 'PROJECT')
            return (
              ['read', 'comment', 'file.read'].includes(cap) &&
              permits(
                role,
                cap === 'read'
                  ? 'task.read'
                  : cap === 'comment'
                    ? 'comment.create'
                    : 'file.read',
                policy,
              )
            );
          const action =
            cap === 'comment'
              ? 'comment.create'
              : cap === 'file.read'
                ? 'file.read'
                : cap === 'read'
                  ? 'task.read'
                  : request.resource!.kind === 'GOAL' && cap === 'update'
                    ? 'goal.manage'
                    : cap === 'update'
                      ? 'task.update'
                      : cap === 'complete'
                        ? 'task.complete'
                        : null;
          return action !== null && permits(role, action, policy);
        })
      )
        return true;
    }
    return false;
  }
  /** Verified recipient transaction; this factory grants NO resource or membership authority. */
  async participate<T>(
    actor: RequestActor,
    spaceId: string,
    additionalUsers: string[],
    work: (
      tx: Prisma.TransactionClient,
      now: Date,
      lockedUsers: string[],
    ) => Promise<T>,
    onRetry?: () => Promise<void>,
  ) {
    this.enabled();
    uuid.parse(spaceId);
    if (!actor.sessionId) throw new ForbiddenException();
    const users = await this.requiredUsers(actor, [spaceId], additionalUsers);
    for (const id of [...users, actor.sessionId]) uuid.parse(id);
    return this.transaction(
      users,
      [spaceId],
      actor,
      async (tx) => {
        if (!(await this.accountActive(tx, actor.userId)))
          throw new ForbiddenException({ code: 'ACCOUNT_CLOSED' });
        const custody = await tx.sharedCustody.findUniqueOrThrow({
          where: { spaceId },
        });
        const scope = await tx.accessScope.findUnique({
          where: { id: spaceId },
        });
        if (custody.state !== 'ACTIVE' || scope?.state !== 'ACTIVE')
          throw new NotFoundException();
        const primary =
          custody.primaryOwnerAccessId &&
          (await tx.contextAccess.findUnique({
            where: { id: custody.primaryOwnerAccessId },
          }));
        const owner = primary
          ? await tx.sharedActor.findUnique({ where: { id: primary.actorId } })
          : null;
        if (
          !owner?.userId ||
          !primary ||
          !(await this.accountActive(tx, owner.userId)) ||
          (await this.endedByClosure(tx, owner.userId, primary.joinedAt))
        )
          throw new NotFoundException();
        if (!users.includes(owner.userId))
          throw new ConflictException({ code: 'CUSTODIAN_CHANGED_RESTART' });
        const retention = await tx.sharedRetentionPolicy.findUnique({
          where: { version: custody.retentionPolicyVersion },
        });
        if (
          !retention ||
          !SharedRetentionSchema.safeParse(retention.configuration).success
        )
          throw new NotFoundException();
        await this.offerControl(tx, spaceId, custody.authorizationVersion);
        const now = (
          await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
        )[0]!.now;
        return work(tx, now, users);
      },
      onRetry,
    );
  }
  async participantAuthority(
    tx: Prisma.TransactionClient,
    actor: RequestActor,
    userId: string,
    request: SharedRequest,
    lockedUsers: string[],
  ) {
    const identity = await this.identity.current(tx, userId);
    if (
      !lockedUsers.includes(userId) ||
      !identity?.emailVerified ||
      !(await this.accountActive(tx, userId))
    )
      throw new NotFoundException();
    return this.authorize(tx, { ...actor, userId }, request, lockedUsers);
  }
  /** Spaces-owned offer effect, after the caller's transaction-local proof/delegation checks. */
  async offerEffect(
    tx: Prisma.TransactionClient,
    actor: RequestActor,
    spaceId: string,
    actorId: string,
    action: string,
    resourceId: string,
    auditId: string,
    usage?: { actorId: string; feature: string; delta: number },
  ) {
    const custody = await tx.sharedCustody.findUniqueOrThrow({
      where: { spaceId },
    });
    return this.effects(
      tx,
      actor,
      {
        spaceId,
        scopeId: spaceId,
        actorId,
        accessId: '',
        generation: 0,
        role: 'MEMBER',
        authorizationVersion: custody.authorizationVersion,
        capability: 'membership.leave',
      },
      action,
      resourceId,
      auditId,
      usage,
    );
  }
  /** Short bounded maintenance effects share custody fencing; callers implement only restrictive transitions. */
  async offerMaintenance<T>(
    spaceId: string,
    userIds: string[],
    work: (tx: Prisma.TransactionClient, now: Date) => Promise<T>,
    onRetry?: () => Promise<void>,
  ) {
    this.enabled();
    return this.transaction(
      [...new Set(userIds)].sort(),
      [spaceId],
      null,
      async (tx) => {
        const custody = await tx.sharedCustody.findUniqueOrThrow({
          where: { spaceId },
        });
        await this.offerControl(tx, spaceId, custody.authorizationVersion);
        const now = (
          await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
        )[0]!.now;
        return work(tx, now);
      },
      onRetry,
    );
  }
  async lifecycleParticipant<T>(
    actor: RequestActor,
    spaceId: string,
    additionalUsers: string[],
    work: (
      tx: Prisma.TransactionClient,
      now: Date,
      locked: string[],
    ) => Promise<T>,
    onRetry?: () => Promise<void>,
  ) {
    this.enabled();
    if (!actor.sessionId) throw new ForbiddenException();
    const users = await this.requiredUsers(actor, [spaceId], additionalUsers);
    return this.transaction(
      users,
      [spaceId],
      actor,
      async (tx) => {
        if (!(await this.accountActive(tx, actor.userId)))
          throw new NotFoundException();
        const custody = await tx.sharedCustody.findUniqueOrThrow({
            where: { spaceId },
          }),
          seat = custody.primaryOwnerAccessId
            ? await tx.contextAccess.findUnique({
                where: { id: custody.primaryOwnerAccessId },
              })
            : null;
        const local = seat
          ? await tx.sharedActor.findUnique({ where: { id: seat.actorId } })
          : null;
        if (
          custody.kind !== 'PROJECT' ||
          !local ||
          local.state !== 'ACTIVE' ||
          local.userId !== actor.userId
        )
          throw new NotFoundException();
        await this.offerControl(tx, spaceId, custody.authorizationVersion);
        const now = (
          await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() now`
        )[0]!.now;
        return work(tx, now, users);
      },
      onRetry,
    );
  }
  async auditFileRead(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    actor: RequestActor,
    spaceId: string,
    parent: NonNullable<SharedRequest['resource']>,
    fileId: string,
  ) {
    const proof = a.require(tx, spaceId, 'file.read', parent);
    await tx.sharedAuditEvent.create({
      data: {
        id: randomUUID(),
        spaceId,
        actorId: proof.actorId,
        action: 'file.download',
        resourceId: fileId,
        requestId: actor.requestId,
      },
    });
  }
  async lifecycleMembers(tx: Prisma.TransactionClient, spaceId: string) {
    return this.usageCount(tx, spaceId, 'shared.membership');
  }
  async lifecycleEffect(
    tx: Prisma.TransactionClient,
    spaceId: string,
    jobId: string,
    id: string,
    action: string,
    operatorReference: string,
  ) {
    const custody = await tx.sharedCustody.update({
      where: { spaceId },
      data: {
        authorizationVersion: { increment: 1 },
        revision: { increment: 1 },
      },
    });
    await tx.accessScope.updateMany({
      where: { spaceId },
      data: { authorizationVersion: { increment: 1 } },
    });
    await tx.sharedLifecycleEffect.create({
      data: {
        id,
        jobId,
        custodyId: spaceId,
        generation: custody.closureGeneration,
        action,
        authorizationVersion: custody.authorizationVersion,
        operatorReference,
      },
    });
  }
  async withPurge<T>(
    tx: Prisma.TransactionClient,
    spaceId: string,
    jobId: string,
    leaseId: string,
    lockedUsers: string[],
    work: (scope: SharedCleanupScope) => Promise<T>,
  ) {
    await assertSharedCleanupCatalog(tx);
    const job = await tx.sharedLifecycleJob.findUniqueOrThrow({
        where: { id: jobId },
      }),
      progress = job.progress as Record<string, unknown>;
    if (
      job.spaceId !== spaceId ||
      job.state !== 'PURGING' ||
      progress.leaseId !== leaseId ||
      !(
        await tx.$queryRaw<
          { ok: boolean }[]
        >`SELECT shared_purge_allowed(${spaceId}::uuid) ok`
      )[0]!.ok
    )
      throw new ConflictException({ code: 'PURGE_LEASE_CHANGED' });
    let open = true;
    const scope: SharedCleanupScope = {
      spaceId,
      jobId,
      lockedUsers,
      verify: (client) => {
        if (!open || client !== tx) throw new ForbiddenException();
      },
    };
    try {
      return await work(scope);
    } finally {
      open = false;
    }
  }
  private async accounts(tx: Prisma.TransactionClient, ids: string[]) {
    const rows = await tx.space.findMany({
      where: { kind: 'PERSONAL', ownerUserId: { in: ids } },
      select: { id: true, ownerUserId: true },
    });
    if (rows.length !== ids.length) throw new ForbiddenException();
    // Use exactly the existing Personal keys; lexical key order is global, not caller order.
    for (const row of rows.sort((a, b) => a.id.localeCompare(b.id)))
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'personal-access:' + row.id},0))::text`;
  }
  private async lockCustodies(tx: Prisma.TransactionClient, ids: string[]) {
    for (const id of ids) {
      const found = await tx.$queryRaw<
        { spaceId: string }[]
      >`SELECT "spaceId" FROM "SharedCustody" WHERE "spaceId"=${id}::uuid FOR UPDATE`;
      if (found.length !== 1) throw new NotFoundException();
    }
  }
  private async accountActive(tx: Prisma.TransactionClient, userId: string) {
    const row = await tx.space.findFirst({
      where: { kind: 'PERSONAL', ownerUserId: userId },
      select: { accessClosedAt: true },
    });
    return !!row && !row.accessClosedAt;
  }
  private async authorize(
    tx: Prisma.TransactionClient,
    actor: RequestActor,
    request: SharedRequest,
    lockedUsers: string[],
  ): Promise<SharedAccess> {
    const custody = await tx.sharedCustody.findUnique({
      where: { spaceId: request.spaceId },
    });
    const departure = request.capability === 'membership.leave';
    const archived =
      request.allowArchived === true &&
      ['task.read', 'custody.archive', 'custody.dissolve'].includes(
        request.capability,
      );
    if (
      !custody ||
      (custody.state !== 'ACTIVE' &&
        !(
          (departure &&
            ['ARCHIVED', 'OWNER_EXIT_FROZEN'].includes(custody.state)) ||
          (archived && custody.state === 'ARCHIVED')
        ))
    )
      throw new NotFoundException();
    const scope = await tx.accessScope.findUnique({
      where: { spaceId_id: { spaceId: request.spaceId, id: request.scopeId } },
    });
    if (
      !scope ||
      (scope.state !== 'ACTIVE' &&
        !((departure || archived) && scope.state === 'ARCHIVED'))
    )
      throw new NotFoundException();
    const sharedActor = await tx.sharedActor.findFirst({
      where: {
        spaceId: request.spaceId,
        userId: actor.userId,
        state: 'ACTIVE',
      },
    });
    const access =
      sharedActor &&
      (await tx.contextAccess.findUnique({
        where: {
          spaceId_scopeId_actorId: {
            spaceId: request.spaceId,
            scopeId: request.scopeId,
            actorId: sharedActor.id,
          },
        },
      }));
    if (
      !access ||
      !(
        access.state === 'ACTIVE' ||
        (access.state === 'SUSPENDED' &&
          request.capability === 'membership.leave')
      ) ||
      (!access.memberRole &&
        !request.resource &&
        !(departure && request.guestDeparture)) ||
      !sharedActor ||
      (await this.endedByClosure(tx, actor.userId, access.joinedAt))
    )
      throw new NotFoundException();
    // Only admitted actors may learn why their boundary is frozen.
    const primary = await tx.contextAccess.findUnique({
      where: { id: custody.primaryOwnerAccessId! },
      select: { actorId: true, joinedAt: true },
    });
    const primaryActor =
      primary &&
      (await tx.sharedActor.findUnique({ where: { id: primary.actorId } }));
    if (
      !departure &&
      (!primary ||
        !primaryActor?.userId ||
        !(await this.accountActive(tx, primaryActor.userId)) ||
        (await this.endedByClosure(tx, primaryActor.userId, primary.joinedAt)))
    )
      throw new ForbiddenException({ code: 'OWNER_EXIT_FROZEN' });
    if (
      !departure &&
      primaryActor?.userId &&
      !lockedUsers.includes(primaryActor.userId)
    )
      throw new ConflictException({ code: 'CUSTODIAN_CHANGED_RESTART' });
    if (
      (request.generation !== undefined &&
        request.generation !== access.generation) ||
      (request.authorizationVersion !== undefined &&
        request.authorizationVersion !== custody.authorizationVersion)
    )
      throw new ConflictException({ code: 'SHARED_AUTHORITY_CHANGED' });
    const policy = await tx.contextCapabilityPolicy.findUniqueOrThrow({
      where: {
        spaceId_scopeId_version: {
          spaceId: request.spaceId,
          scopeId: request.scopeId,
          version: scope.currentPolicyVersion,
        },
      },
    });
    if (!validateRoleDefaults(policy.roleDefaults))
      throw new ForbiddenException();
    const role =
      access.id === custody.primaryOwnerAccessId
        ? 'OWNER'
        : (access.memberRole as MemberRole);
    if (
      request.resource &&
      role === 'VIEWER' &&
      !['task.read', 'file.read'].includes(request.capability)
    )
      throw new ForbiddenException();
    let limited = false;
    if (
      !permits(role, request.capability, policy.roleDefaults) &&
      !(departure && request.guestDeparture && role === null)
    ) {
      if (
        !request.resource ||
        !(await this.grantPermits(
          tx,
          actor.userId,
          access,
          request,
          policy.roleDefaults,
          lockedUsers,
        ))
      )
        throw new ForbiddenException();
      limited = true;
    }
    const retention = await tx.sharedRetentionPolicy.findUnique({
      where: { version: custody.retentionPolicyVersion },
    });
    if (
      !retention ||
      !SharedRetentionSchema.safeParse(retention.configuration).success
    )
      throw new ForbiddenException({ code: 'SHARED_RETENTION_UNAVAILABLE' });
    await this.verifyRestoreFloor(tx);
    await this.control.assertCurrent(
      request.spaceId,
      custody.authorizationVersion,
      (await this.controlView(tx)).records,
    );
    return {
      spaceId: request.spaceId,
      scopeId: request.scopeId,
      actorId: sharedActor.id,
      accessId: access.id,
      generation: access.generation,
      role,
      authorizationVersion: custody.authorizationVersion,
      capability: request.capability,
      ...(limited ? { resource: request.resource } : {}),
    };
  }
  /** Predeclare all account/custody locks. Callbacks do DB work only and must use owner facades. */
  async run<T>(
    actor: RequestActor,
    locks: LockSet,
    requests: SharedRequest[],
    work: (
      tx: Prisma.TransactionClient,
      authority: SharedAuthority,
    ) => Promise<T>,
    onRetry?: () => Promise<void>,
    optionalRequests: SharedRequest[] = [],
  ) {
    this.enabled();
    if (!actor.sessionId) throw new ForbiddenException();
    const spaces = [...new Set(locks.spaceIds)].sort();
    // Owner IDs here are hints only. Recheck them after custody locking and reject changes.
    // Prelocking the owner account closes the owner-exit read/commit window without late locks.
    const custodians = await this.db.client.sharedCustody.findMany({
      where: { spaceId: { in: spaces } },
      select: { primaryOwnerAccessId: true },
    });
    const seats = await this.db.client.contextAccess.findMany({
      where: {
        id: {
          in: custodians.flatMap((c) =>
            c.primaryOwnerAccessId ? [c.primaryOwnerAccessId] : [],
          ),
        },
      },
      select: { actorId: true },
    });
    const owners = await this.db.client.sharedActor.findMany({
      where: { id: { in: seats.map((s) => s.actorId) } },
      select: { userId: true },
    });
    const users = [
      ...new Set([
        actor.userId,
        ...locks.userIds,
        ...owners.flatMap((o) => (o.userId ? [o.userId] : [])),
        ...(await this.grantIssuerHints(actor.userId, [
          ...requests,
          ...optionalRequests,
        ])),
      ]),
    ].sort();
    for (const id of [...users, ...spaces, actor.sessionId]) uuid.parse(id);
    if (
      !requests.length ||
      [...requests, ...optionalRequests].some(
        (r) => !spaces.includes(r.spaceId),
      )
    )
      throw new BadRequestException();
    for (const r of [...requests, ...optionalRequests]) uuid.parse(r.scopeId);
    return this.transaction(
      users,
      spaces,
      actor,
      async (tx) => {
        if (!(await this.accountActive(tx, actor.userId)))
          throw new ForbiddenException({ code: 'ACCOUNT_CLOSED' });
        const access: SharedAccess[] = [];
        for (const request of requests)
          access.push(await this.authorize(tx, actor, request, users));
        for (const request of optionalRequests) {
          try {
            access.push(await this.authorize(tx, actor, request, users));
          } catch (error) {
            if (!(error instanceof ForbiddenException)) throw error;
          }
        }
        const authority = new SharedAuthority(tx, access);
        try {
          return await work(tx, authority);
        } finally {
          authority.close();
        }
      },
      onRetry,
    );
  }
  private async transaction<T>(
    users: string[],
    spaces: string[],
    actor: RequestActor | null,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
    onRetry?: () => Promise<void>,
  ) {
    const deadline = performance.now() + 30000;
    for (let attempt = 0; attempt < 3; attempt++) {
      const remaining = Math.floor(deadline - performance.now());
      if (remaining <= 0)
        throw new ConflictException({ code: 'SHARED_TRANSACTION_BUDGET' });
      try {
        return await this.db.client.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT set_config('TimeZone','UTC',true),set_config('lock_timeout','5s',true),set_config('statement_timeout',${String(remaining) + 'ms'},true)`;
            await this.accounts(tx, users);
            await this.identity.lock(tx, users);
            if (actor) await this.identity.require(tx, actor);
            await this.lockCustodies(tx, spaces);
            const baseline = await tx.sharedCustody.findMany({
              where: { spaceId: { in: spaces } },
              select: { spaceId: true, authorizationVersion: true },
            });
            const result = await work(tx);
            for (const b of baseline) {
              const effects = await tx.sharedOutboxEvent.findMany({
                where: {
                  spaceId: b.spaceId,
                  authorizationVersion: { gt: b.authorizationVersion },
                },
                include: { SharedAuditEvent: true },
              });
              const system = await tx.sharedLifecycleEffect.findMany({
                where: {
                  custodyId: b.spaceId,
                  authorizationVersion: { gt: b.authorizationVersion },
                },
              });
              for (const e of effects)
                await this.control.appendReplay(
                  await captureSharedReplay(tx, {
                    id: e.auditId,
                    spaceId: b.spaceId,
                    version: String(e.authorizationVersion),
                    action: e.action,
                    resourceId: e.SharedAuditEvent.resourceId,
                    actorId: e.actorId,
                  }),
                );
              for (const e of system)
                await this.control.appendReplay(
                  await captureSharedReplay(tx, {
                    id: e.id,
                    spaceId: b.spaceId,
                    version: String(e.authorizationVersion),
                    action: e.action,
                    resourceId: e.jobId,
                    actorId: null,
                  }),
                );
            }
            return result;
          },
          {
            isolationLevel: 'ReadCommitted',
            timeout: remaining,
            maxWait: Math.min(5000, remaining),
          },
        );
      } catch (error) {
        if (!retryable(error) || attempt === 2) throw error;
        await onRetry?.();
      }
    }
    throw new ConflictException();
  }
  private async invalidateDelegatedGrants(
    tx: Prisma.TransactionClient,
    spaceId: string,
  ) {
    // Lost delegation is permanent for these grants, even if the issuer is later promoted again.
    await tx.$executeRaw`UPDATE "ResourceGrant" g SET "revokedAt"=clock_timestamp(),revision=g.revision+1
      FROM "ContextAccess" a,"SharedActor" actor,"SharedCustody" c,"AccessScope" s,"ContextCapabilityPolicy" p
      WHERE g."spaceId"=${spaceId}::uuid AND g."revokedAt" IS NULL AND a.id=g."issuerAccessId" AND actor.id=a."actorId" AND c."spaceId"=g."spaceId"
      AND s."spaceId"=g."spaceId" AND s.id=g."scopeId" AND p."spaceId"=s."spaceId" AND p."scopeId"=s.id AND p.version=s."currentPolicyVersion"
      AND (a.state<>'ACTIVE' OR actor.state<>'ACTIVE' OR actor."userId" IS NULL OR a.generation<>g."issuerGeneration" OR a."memberRole" IS NULL OR
        (CASE WHEN a.id=c."primaryOwnerAccessId" THEN 'OWNER' ELSE a."memberRole" END) NOT IN ('OWNER','ADMIN','MANAGER') OR
        EXISTS(SELECT 1 FROM unnest(g.capabilities) cap WHERE
          (cap='read' AND NOT ((p."roleDefaults"->(CASE WHEN a.id=c."primaryOwnerAccessId" THEN 'OWNER' ELSE a."memberRole" END)) ? 'task.read')) OR
          (cap='file.read' AND NOT ((p."roleDefaults"->(CASE WHEN a.id=c."primaryOwnerAccessId" THEN 'OWNER' ELSE a."memberRole" END)) ? 'file.read')) OR
          (cap='update' AND EXISTS(SELECT 1 FROM "TaskGrant" t WHERE t."grantId"=g.id) AND NOT ((p."roleDefaults"->(CASE WHEN a.id=c."primaryOwnerAccessId" THEN 'OWNER' ELSE a."memberRole" END)) ? 'task.update')) OR
          (cap='complete' AND NOT ((p."roleDefaults"->(CASE WHEN a.id=c."primaryOwnerAccessId" THEN 'OWNER' ELSE a."memberRole" END)) ? 'task.complete'))))`;
  }
  private async effects(
    tx: Prisma.TransactionClient,
    actor: RequestActor,
    access: SharedAccess,
    action: string,
    resourceId: string,
    id: string = randomUUID(),
    usage?: { actorId: string; feature: string; delta: number },
  ) {
    if (
      [
        'membership.change',
        'membership.leave',
        'policy.publish',
        'handover.accept',
        'actor.erase',
        'account.exit',
      ].includes(action)
    )
      await this.invalidateDelegatedGrants(tx, access.spaceId);
    const custody = await tx.sharedCustody.update({
      where: { spaceId: access.spaceId },
      data: {
        authorizationVersion: { increment: 1 },
        revision: { increment: 1 },
      },
    });
    await tx.accessScope.update({
      where: { id: access.scopeId },
      data: { authorizationVersion: { increment: 1 } },
    });
    await tx.sharedAuditEvent.create({
      data: {
        id,
        spaceId: access.spaceId,
        actorId: access.actorId,
        action,
        resourceId,
        requestId: actor.requestId,
      },
    });
    await tx.sharedOutboxEvent.create({
      data: {
        id: randomUUID(),
        spaceId: access.spaceId,
        actorId: access.actorId,
        auditId: id,
        action,
        authorizationVersion: custody.authorizationVersion,
      },
    });
    if (usage)
      await tx.sharedUsageEntry.create({
        data: {
          id: randomUUID(),
          spaceId: access.spaceId,
          subjectActorId: usage.actorId,
          auditId: id,
          feature: usage.feature,
          delta: usage.delta,
        },
      });
    return custody;
  }
  async restrictive<T>(
    actor: RequestActor,
    request: SharedRequest,
    action: string,
    target: string,
    work: (
      tx: Prisma.TransactionClient,
      a: SharedAccess,
      id: string,
    ) => Promise<T>,
  ) {
    const intents: SharedControlRecord[] = [];
    let committed = false;
    try {
      const result = await this.run(
        actor,
        { userIds: [], spaceIds: [request.spaceId] },
        [request],
        async (tx, authority) => {
          const access = authority.require(
            tx,
            request.spaceId,
            request.capability,
          );
          const record: SharedControlRecord = {
            id: randomUUID(),
            spaceId: request.spaceId,
            version: String(access.authorizationVersion + 1n),
            action,
            resourceId: target,
            outcome: 'INTENT',
            at: new Date().toISOString(),
          };
          await this.control.append(record);
          intents.push(record);
          return work(tx, access, record.id);
        },
        async () => {
          for (const record of intents)
            await this.control.append({
              ...record,
              outcome: 'ABORTED',
              at: new Date().toISOString(),
            });
          intents.length = 0;
        },
      );
      committed = true;
      for (const record of intents)
        await this.control.append({
          ...record,
          outcome: 'COMMITTED',
          at: new Date().toISOString(),
        });
      return result;
    } catch (error) {
      if (!committed && knownRollback(error))
        for (const record of intents)
          await this.control.append({
            ...record,
            outcome: 'ABORTED',
            at: new Date().toISOString(),
          });
      throw error;
    }
  }
  async departGuest(actor: RequestActor, spaceId: string, revision: number) {
    return this.restrictive(
      actor,
      {
        spaceId,
        scopeId: spaceId,
        capability: 'membership.leave',
        guestDeparture: true,
      },
      'collaborator.leave',
      spaceId,
      async (tx, a, id) => {
        const access = await tx.contextAccess.findUniqueOrThrow({
          where: { id: a.accessId },
        });
        if (access.memberRole !== null)
          throw new ConflictException({
            code: 'FULL_MEMBER_DEPARTURE_REQUIRED',
          });
        if (access.revision !== revision) throw new ConflictException();
        const now = (
          await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() now`
        )[0]!.now;
        await tx.contextAccess.update({
          where: { id: access.id },
          data: { state: 'LEFT', endedAt: now, revision: { increment: 1 } },
        });
        await tx.contextAccessInterval.update({
          where: {
            accessId_generation: {
              accessId: access.id,
              generation: access.generation,
            },
          },
          data: { endedAt: now },
        });
        await tx.resourceGrant.updateMany({
          where: {
            spaceId,
            granteeAccessId: access.id,
            granteeGeneration: access.generation,
            revokedAt: null,
          },
          data: { revokedAt: now, revision: { increment: 1 } },
        });
        await tx.resourceGrantOffer.updateMany({
          where: {
            spaceId,
            recipientActorId: access.actorId,
            state: 'PENDING',
          },
          data: {
            state: 'REVOKED',
            proofHash: null,
            endedAt: now,
            revision: { increment: 1 },
          },
        });
        await this.effects(tx, actor, a, 'collaborator.leave', spaceId, id);
        return { id: access.id, revision: access.revision + 1 };
      },
    );
  }
  async projectLifecycle<T>(
    actor: RequestActor,
    spaceId: string,
    action: 'archive' | 'restore' | 'delete',
    write: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    return this.restrictive(
      actor,
      {
        spaceId,
        scopeId: spaceId,
        capability:
          action === 'delete' ? 'custody.dissolve' : 'custody.archive',
        allowArchived: true,
      },
      'project.' + action,
      spaceId,
      async (tx, a, auditId) => {
        const custody = await tx.sharedCustody.findUniqueOrThrow({
          where: { spaceId },
        });
        if (
          (action === 'archive' && custody.state !== 'ACTIVE') ||
          (action === 'restore' && custody.state !== 'ARCHIVED')
        )
          throw new ConflictException();
        const now = (
          await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() now`
        )[0]!.now;
        if (action === 'delete') {
          // A deletion request is the sole full custodian's explicit last departure.
          const members = await tx.contextAccess.findMany({
            where: {
              spaceId,
              scopeId: spaceId,
              memberRole: { not: null },
              state: { in: ['ACTIVE', 'SUSPENDED'] },
              id: { not: a.accessId },
            },
          });
          for (const member of members) {
            const local = await tx.sharedActor.findUniqueOrThrow({
              where: { id: member.actorId },
            });
            if (
              local.userId &&
              (await this.accountActive(tx, local.userId)) &&
              !(await this.endedByClosure(tx, local.userId, member.joinedAt))
            )
              throw new ConflictException({
                code: 'CUSTODIAN_SUCCESSION_REQUIRED',
              });
          }
        }
        const result = await write(tx);
        if (action === 'delete') {
          const generation = custody.closureGeneration + 1,
            deadline = new Date(now.getTime() + 2592000000);
          await tx.contextAccess.update({
            where: { id: a.accessId },
            data: { state: 'LEFT', endedAt: now, revision: { increment: 1 } },
          });
          await tx.contextAccessInterval.update({
            where: {
              accessId_generation: {
                accessId: a.accessId,
                generation: a.generation,
              },
            },
            data: { endedAt: now },
          });
          await tx.sharedLifecycleJob.create({
            data: {
              id: randomUUID(),
              spaceId,
              custodyId: spaceId,
              generation,
              state: 'CLOSING_GRACE',
              effectiveDepartureAt: now,
              recoveryDeadline: deadline,
              retentionPolicyVersion: custody.retentionPolicyVersion,
              nextAt: deadline,
            },
          });
          await tx.sharedCustody.update({
            where: { spaceId },
            data: { state: 'CLOSING_GRACE', closureGeneration: generation },
          });
          await this.invalidateOffers(tx, spaceId, now);
        } else {
          await tx.sharedCustody.update({
            where: { spaceId },
            data: { state: action === 'archive' ? 'ARCHIVED' : 'ACTIVE' },
          });
          await tx.accessScope.update({
            where: { id: spaceId },
            data: { state: action === 'archive' ? 'ARCHIVED' : 'ACTIVE' },
          });
          if (action === 'archive')
            await this.invalidateOffers(tx, spaceId, now);
        }
        await this.effects(
          tx,
          actor,
          a,
          'project.' + action,
          spaceId,
          auditId,
          action === 'delete'
            ? { actorId: a.actorId, feature: 'shared.membership', delta: -1 }
            : undefined,
        );
        return result;
      },
    );
  }
  async readPolicy(actor: RequestActor, spaceId: string) {
    return this.run(
      actor,
      { userIds: [], spaceIds: [spaceId] },
      [{ spaceId, scopeId: spaceId, capability: 'settings.manage' }],
      async (tx) => {
        const scope = await tx.accessScope.findUniqueOrThrow({
            where: { id: spaceId },
          }),
          policy = await tx.contextCapabilityPolicy.findUniqueOrThrow({
            where: {
              spaceId_scopeId_version: {
                spaceId,
                scopeId: spaceId,
                version: scope.currentPolicyVersion,
              },
            },
          });
        return {
          version: policy.version,
          roleDefaults: policy.roleDefaults,
          exportMaxRecords: policy.exportMaxRecords,
          exportMaxBytes: policy.exportMaxBytes,
        };
      },
    );
  }
  async publishPolicy(
    actor: RequestActor,
    input: {
      spaceId: string;
      scopeId: string;
      expectedVersion: number;
      roleDefaults: RoleDefaults;
      exportMaxRecords: number;
      exportMaxBytes: number;
    },
  ) {
    if (
      !validateRoleDefaults(input.roleDefaults) ||
      !Number.isInteger(input.exportMaxRecords) ||
      input.exportMaxRecords < 1 ||
      input.exportMaxRecords > 10000 ||
      !Number.isInteger(input.exportMaxBytes) ||
      input.exportMaxBytes < 1 ||
      input.exportMaxBytes > 10485760
    )
      throw new BadRequestException();
    return this.restrictive(
      actor,
      { ...input, capability: 'policy.publish' },
      'policy.publish',
      input.scopeId,
      async (tx, a, id) => {
        const scope = await tx.accessScope.findUniqueOrThrow({
          where: { id: input.scopeId },
        });
        if (scope.currentPolicyVersion !== input.expectedVersion)
          throw new ConflictException();
        const version = scope.currentPolicyVersion + 1;
        await tx.contextCapabilityPolicy.create({
          data: {
            spaceId: input.spaceId,
            scopeId: input.scopeId,
            version,
            roleDefaults: input.roleDefaults,
            exportMaxRecords: input.exportMaxRecords,
            exportMaxBytes: input.exportMaxBytes,
            publishedByActorId: a.actorId,
            auditId: id,
          },
        });
        await tx.accessScope.update({
          where: { id: input.scopeId },
          data: { currentPolicyVersion: version },
        });
        await this.effects(tx, actor, a, 'policy.publish', input.scopeId, id);
        return { version };
      },
    );
  }
  async changeAccess(
    actor: RequestActor,
    input: AccessChange,
  ): Promise<{ id: string; revision: number }>;
  async changeAccess<T>(
    actor: RequestActor,
    input: AccessChange,
    present: (
      tx: Prisma.TransactionClient,
      access: ContextAccess,
    ) => Promise<T>,
  ): Promise<T>;
  async changeAccess<T>(
    actor: RequestActor,
    input: AccessChange,
    present?: (
      tx: Prisma.TransactionClient,
      access: ContextAccess,
    ) => Promise<T>,
  ) {
    uuid.parse(input.accessId);
    if (
      !['ADMIN', 'MANAGER', 'MEMBER', 'VIEWER'].includes(input.memberRole) ||
      !['ACTIVE', 'SUSPENDED', 'LEFT', 'REVOKED'].includes(input.state)
    )
      throw new BadRequestException();
    // Authorization for the OLD and NEW roles is checked under the same custody lock.
    return this.restrictive(
      actor,
      { ...input, capability: roleAdministration(input.memberRole) },
      'membership.change',
      input.accessId,
      async (tx, a, id) => {
        const target = await tx.contextAccess.findFirst({
          where: {
            id: input.accessId,
            spaceId: input.spaceId,
            scopeId: input.scopeId,
          },
        });
        if (!target) throw new NotFoundException();
        if (target.revision !== input.revision) throw new ConflictException();
        if (
          !target.memberRole ||
          !['ACTIVE', 'SUSPENDED'].includes(target.state)
        )
          throw new ConflictException({
            code: 'EXPLICIT_READMISSION_REQUIRED',
          });
        if (
          !permits(
            a.role,
            roleAdministration(target.memberRole as MemberRole),
            defaultPolicy,
          ) ||
          target.id === a.accessId
        )
          throw new ForbiddenException();
        const custody = await tx.sharedCustody.findUniqueOrThrow({
          where: { spaceId: input.spaceId },
        });
        if (target.id === custody.primaryOwnerAccessId)
          throw new ConflictException({
            code: 'CUSTODIAN_SUCCESSION_REQUIRED',
          });
        const now = (
          await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
        )[0]!.now;
        const ending = ['LEFT', 'REVOKED'].includes(input.state);
        const changed = await tx.contextAccess.update({
          where: { id: target.id },
          data: {
            state: input.state,
            memberRole: input.memberRole,
            endedAt: ending ? now : null,
            revision: { increment: 1 },
          },
        });
        if (ending)
          await tx.contextAccessInterval.update({
            where: {
              accessId_generation: {
                accessId: target.id,
                generation: target.generation,
              },
            },
            data: { endedAt: now },
          });
        await this.effects(
          tx,
          actor,
          a,
          'membership.change',
          target.id,
          id,
          ending
            ? {
                actorId: target.actorId,
                feature: 'shared.membership',
                delta: -1,
              }
            : undefined,
        );
        return present
          ? present(tx, changed)
          : { id: target.id, revision: target.revision + 1 };
      },
    );
  }
  /** No usable target exists in P2-01; DB independently enforces the same denial. */
  issueGrant(): never {
    throw new ConflictException({ code: 'TYPED_GRANT_TARGET_NOT_IMPLEMENTED' });
  }
  async depart(
    actor: RequestActor,
    input: { spaceId: string; scopeId: string; revision: number },
  ) {
    return this.restrictive(
      actor,
      { ...input, capability: 'membership.leave' },
      'membership.leave',
      input.scopeId,
      async (tx, a, id) => {
        const access = await tx.contextAccess.findUniqueOrThrow({
          where: { id: a.accessId },
        });
        if (access.revision !== input.revision) throw new ConflictException();
        const members = await tx.contextAccess.findMany({
          where: {
            spaceId: input.spaceId,
            scopeId: input.scopeId,
            id: { not: a.accessId },
            memberRole: { not: null },
            state: { in: ['ACTIVE', 'SUSPENDED'] },
          },
        });
        let remaining = 0;
        for (const member of members) {
          const sa = await tx.sharedActor.findUniqueOrThrow({
            where: { id: member.actorId },
          });
          if (
            sa.userId &&
            (await this.accountActive(tx, sa.userId)) &&
            !(await this.endedByClosure(tx, sa.userId, member.joinedAt))
          )
            remaining++;
        }
        if (a.role === 'OWNER' && remaining > 0)
          throw new ConflictException({
            code: 'CUSTODIAN_SUCCESSION_REQUIRED',
          });
        const now = (
          await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
        )[0]!.now;
        await tx.contextAccess.update({
          where: { id: access.id },
          data: { state: 'LEFT', endedAt: now, revision: { increment: 1 } },
        });
        await tx.contextAccessInterval.update({
          where: {
            accessId_generation: {
              accessId: access.id,
              generation: access.generation,
            },
          },
          data: { endedAt: now },
        });
        if (remaining === 0) {
          const custody = await tx.sharedCustody.findUniqueOrThrow({
              where: { spaceId: input.spaceId },
            }),
            generation = custody.closureGeneration + 1,
            deadline = new Date(now.getTime() + 2592000000);
          await tx.sharedLifecycleJob.create({
            data: {
              id: randomUUID(),
              custodyId: input.spaceId,
              spaceId: input.spaceId,
              generation,
              state: 'CLOSING_GRACE',
              effectiveDepartureAt: now,
              recoveryDeadline: deadline,
              retentionPolicyVersion: custody.retentionPolicyVersion,
              nextAt: deadline,
            },
          });
          await tx.sharedCustody.update({
            where: { spaceId: input.spaceId },
            data: { state: 'CLOSING_GRACE', closureGeneration: generation },
          });
          if (custody.state === 'OWNER_EXIT_FROZEN')
            await tx.sharedLifecycleJob.updateMany({
              where: {
                custodyId: input.spaceId,
                generation: custody.closureGeneration,
                state: 'OWNER_EXIT_FROZEN',
              },
              data: {
                state: 'CANCELED',
                recoveryHash: null,
                leaseUntil: null,
                revision: { increment: 1 },
              },
            });
          await this.invalidateOffers(tx, input.spaceId, now);
        }
        await this.effects(tx, actor, a, 'membership.leave', access.id, id, {
          actorId: a.actorId,
          feature: 'shared.membership',
          delta: -1,
        });
        return { id: access.id, revision: access.revision + 1 };
      },
    );
  }
  /** Internal creation port for P2-03. No HTTP route and no automatic policy provisioning. */
  async provision(
    actor: RequestActor,
    spaceId: string,
    retentionVersion: string,
    write?: (
      tx: Prisma.TransactionClient,
      boundary: {
        spaceId: string;
        scopeId: string;
        actorId: string;
        accessId: string;
      },
    ) => Promise<void>,
  ) {
    this.enabled();
    uuid.parse(spaceId);
    await this.control.records();
    return this.transaction([actor.userId], [], actor, async (tx) => {
      if (!(await this.accountActive(tx, actor.userId)))
        throw new ForbiddenException();
      const retention = await tx.sharedRetentionPolicy.findUnique({
        where: { version: retentionVersion },
      });
      const parsed =
        retention && SharedRetentionSchema.safeParse(retention.configuration);
      if (
        !retention ||
        !parsed ||
        !parsed.success ||
        parsed.data.policyVersion !== retention.version ||
        parsed.data.approvalReference !== retention.approvalReference
      )
        throw new ForbiddenException({ code: 'SHARED_RETENTION_UNAVAILABLE' });
      if (await tx.space.findUnique({ where: { id: spaceId } }))
        throw new ConflictException();
      if (
        await tx.sharedLifecycleJob.findFirst({ where: { custodyId: spaceId } })
      )
        throw new ConflictException({ code: 'CUSTODY_ID_RETIRED' });
      await this.verifyRestoreFloor(tx);
      await this.control.assertCurrent(
        spaceId,
        0n,
        (await this.controlView(tx)).records,
      );
      if (
        Object.values(parsed.data.classRules).some(
          (rule) => rule.disposalAction !== 'PURGE',
        )
      )
        throw new ForbiddenException({
          code: 'SHARED_RETENTION_DISPOSITION_UNAVAILABLE',
        });
      await this.featureGrowth(tx, spaceId, 'shared.custody', actor.userId);
      const actorId = randomUUID(),
        accessId = randomUUID(),
        auditId = randomUUID();
      const now = (
        await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
      )[0]!.now;
      await tx.space.create({
        data: { id: spaceId, kind: 'SHARED', ownerUserId: null },
      });
      await tx.sharedCustody.create({
        data: {
          spaceId,
          kind: 'PROJECT',
          state: 'ACTIVE',
          primaryOwnerAccessId: accessId,
          retentionPolicyVersion: retentionVersion,
        },
      });
      await tx.accessScope.create({
        data: { id: spaceId, spaceId, kind: 'ROOT' },
      });
      await tx.sharedActor.create({
        data: { id: actorId, spaceId, userId: actor.userId, state: 'ACTIVE' },
      });
      await tx.contextAccess.create({
        data: {
          id: accessId,
          spaceId,
          scopeId: spaceId,
          actorId,
          state: 'ACTIVE',
          memberRole: 'ADMIN',
          joinedAt: now,
        },
      });
      await tx.contextAccessInterval.create({
        data: { accessId, generation: 1, joinedAt: now },
      });
      await tx.contextCapabilityPolicy.create({
        data: {
          spaceId,
          scopeId: spaceId,
          version: 1,
          roleDefaults: defaultPolicy,
          exportMaxRecords: 10000,
          exportMaxBytes: 10485760,
          publishedByActorId: actorId,
          auditId,
        },
      });
      await tx.sharedAuditEvent.create({
        data: {
          id: auditId,
          spaceId,
          actorId,
          action: 'custody.create',
          resourceId: spaceId,
          requestId: actor.requestId,
        },
      });
      await tx.sharedOutboxEvent.create({
        data: {
          id: randomUUID(),
          spaceId,
          actorId,
          auditId,
          action: 'custody.create',
          authorizationVersion: 1n,
        },
      });
      await tx.sharedUsageEntry.create({
        data: {
          id: randomUUID(),
          spaceId,
          subjectActorId: actorId,
          auditId,
          feature: 'shared.custody',
          delta: 1,
        },
      });
      const admissionAuditId = randomUUID();
      await tx.sharedAuditEvent.create({
        data: {
          id: admissionAuditId,
          spaceId,
          actorId,
          action: 'membership.admit',
          resourceId: accessId,
          requestId: actor.requestId,
        },
      });
      await tx.sharedOutboxEvent.create({
        data: {
          id: randomUUID(),
          spaceId,
          actorId,
          auditId: admissionAuditId,
          action: 'membership.admit',
          authorizationVersion: 1n,
        },
      });
      await tx.sharedUsageEntry.create({
        data: {
          id: randomUUID(),
          spaceId,
          subjectActorId: actorId,
          auditId: admissionAuditId,
          feature: 'shared.membership',
          delta: 1,
        },
      });
      const boundary = { spaceId, scopeId: spaceId, actorId, accessId };
      await write?.(tx, boundary);
      return boundary;
    });
  }
  /** Called atomically by Spaces under the existing exclusive Personal closure fence. */
  async enqueueExit(
    tx: Prisma.TransactionClient,
    userId: string,
    closedAt: Date,
  ) {
    if (!(await tx.sharedActor.findFirst({ where: { userId } }))) return;
    await tx.sharedExitWork.upsert({
      where: { userId },
      create: { userId, closedAt },
      update: {
        closedAt,
        afterActorId: null,
        completedAt: null,
        attempts: 0,
        failureCode: null,
        nextAt: new Date(),
        revision: { increment: 1 },
      },
    });
  }
  private async invalidateOffers(
    tx: Prisma.TransactionClient,
    spaceId: string,
    now: Date,
  ) {
    await tx.resourceGrantOffer.updateMany({
      where: { spaceId, state: 'PENDING' },
      data: {
        state: 'REVOKED',
        endedAt: now,
        proofHash: null,
        revision: { increment: 1 },
      },
    });
    await tx.contextInvitation.updateMany({
      where: { spaceId, state: 'PENDING' },
      data: {
        state: 'REVOKED',
        endedAt: now,
        proofHash: null,
        recipientUserId: null,
        recipientEmail: null,
        revision: { increment: 1 },
      },
    });
    await tx.ownerHandover.updateMany({
      where: { spaceId, state: 'PENDING' },
      data: { state: 'REVOKED', endedAt: now, revision: { increment: 1 } },
    });
  }
  private async endedByClosure(
    tx: Prisma.TransactionClient,
    userId: string,
    joinedAt: Date,
  ) {
    const exit = await tx.sharedExitWork.findUnique({ where: { userId } });
    return !!exit && exit.closedAt >= joinedAt;
  }
  private async exitActor(
    userId: string,
    actorId: string,
    spaceId: string,
    closedAt: Date,
    erase: boolean,
  ) {
    const intents: SharedControlRecord[] = [];
    try {
      await this.transaction(
        [userId],
        [spaceId],
        null,
        async (tx) => {
          const actor = await tx.sharedActor.findFirst({
            where: { id: actorId, userId, spaceId },
          });
          if (!actor) return;
          if (erase && (await this.accountActive(tx, userId)))
            throw new ForbiddenException({
              code: 'ACCOUNT_ERASURE_NOT_AUTHORIZED',
            });
          if (
            !erase &&
            !(await tx.contextAccess.findFirst({
              where: {
                spaceId,
                actorId,
                state: { in: ['ACTIVE', 'SUSPENDED'] },
                joinedAt: { lte: closedAt },
              },
            }))
          )
            return;
          const custody = await tx.sharedCustody.findUniqueOrThrow({
            where: { spaceId },
          });
          const record: SharedControlRecord = {
            id: randomUUID(),
            spaceId,
            version: String(custody.authorizationVersion + 1n),
            action: erase ? 'actor.erase' : 'account.exit',
            resourceId: actorId,
            outcome: 'INTENT',
            at: new Date().toISOString(),
          };
          await this.control.append(record);
          intents.push(record);
          const accesses = await tx.contextAccess.findMany({
            where: {
              spaceId,
              actorId,
              state: { in: ['ACTIVE', 'SUSPENDED'] },
              ...(erase ? {} : { joinedAt: { lte: closedAt } }),
            },
          });
          for (const access of accesses) {
            const endedAt = new Date(
              Math.max(closedAt.getTime(), access.joinedAt.getTime()),
            );
            await tx.contextAccess.update({
              where: { id: access.id },
              data: {
                state: erase ? 'ERASED' : 'LEFT',
                endedAt,
                revision: { increment: 1 },
              },
            });
            await tx.contextAccessInterval.update({
              where: {
                accessId_generation: {
                  accessId: access.id,
                  generation: access.generation,
                },
              },
              data: { endedAt },
            });
          }
          const members = await tx.contextAccess.findMany({
            where: {
              spaceId,
              memberRole: { not: null },
              state: { in: ['ACTIVE', 'SUSPENDED'] },
            },
          });
          let remaining = 0;
          for (const member of members) {
            const sa = await tx.sharedActor.findUniqueOrThrow({
              where: { id: member.actorId },
            });
            if (
              sa.userId &&
              (await this.accountActive(tx, sa.userId)) &&
              !(await this.endedByClosure(tx, sa.userId, member.joinedAt))
            )
              remaining++;
          }
          const primary = custody.primaryOwnerAccessId
            ? await tx.contextAccess.findUnique({
                where: { id: custody.primaryOwnerAccessId },
              })
            : null;
          const primaryActor =
            primary &&
            (await tx.sharedActor.findUnique({
              where: { id: primary.actorId },
            }));
          const primaryGone =
            !primary ||
            primary.state !== 'ACTIVE' ||
            !primaryActor?.userId ||
            !(await this.accountActive(tx, primaryActor.userId)) ||
            (await this.endedByClosure(
              tx,
              primaryActor.userId,
              primary.joinedAt,
            ));
          const state = [
            'CLEANUP_PENDING',
            'WAITING_OBLIGATIONS',
            'BLOCKED_POLICY',
            'PURGING',
            'FAILED',
            'DELETED',
          ].includes(custody.state)
            ? custody.state
            : remaining === 0
              ? 'CLOSING_GRACE'
              : primaryGone
                ? 'OWNER_EXIT_FROZEN'
                : custody.state;
          if (
            state !== custody.state &&
            ['CLOSING_GRACE', 'OWNER_EXIT_FROZEN'].includes(state)
          ) {
            const all = await tx.contextAccess.findMany({
              where: { spaceId, memberRole: { not: null } },
            });
            let effective = closedAt;
            for (const entry of all) {
              if (entry.endedAt && entry.endedAt > effective)
                effective = entry.endedAt;
              const sa = await tx.sharedActor.findUniqueOrThrow({
                where: { id: entry.actorId },
              });
              const exit =
                sa.userId &&
                (await tx.sharedExitWork.findUnique({
                  where: { userId: sa.userId },
                }));
              if (
                exit &&
                exit.closedAt >= entry.joinedAt &&
                exit.closedAt > effective
              )
                effective = exit.closedAt;
            }
            const generation = custody.closureGeneration + 1,
              deadline = new Date(effective.getTime() + 2592000000);
            await tx.sharedLifecycleJob.create({
              data: {
                id: randomUUID(),
                custodyId: spaceId,
                spaceId,
                generation,
                state,
                effectiveDepartureAt: effective,
                recoveryDeadline: deadline,
                retentionPolicyVersion: custody.retentionPolicyVersion,
                nextAt: state === 'CLOSING_GRACE' ? deadline : effective,
              },
            });
            await tx.sharedCustody.update({
              where: { spaceId },
              data: { state, closureGeneration: generation },
            });
            await this.invalidateOffers(tx, spaceId, effective);
          }
          if (erase) {
            await tx.contextAccess.updateMany({
              where: { actorId, spaceId, state: { in: ['LEFT', 'REVOKED'] } },
              data: { state: 'ERASED', revision: { increment: 1 } },
            });
            await tx.sharedActor.update({
              where: { id: actorId },
              data: { userId: null, state: 'ERASED', erasedAt: new Date() },
            });
          }
          await this.effects(
            tx,
            { userId, requestId: record.id, correlationId: record.id },
            {
              spaceId,
              scopeId: spaceId,
              actorId,
              accessId: '',
              generation: 0,
              role: 'OWNER',
              authorizationVersion: custody.authorizationVersion,
              capability: 'membership.member',
            },
            record.action,
            actorId,
            record.id,
          );
        },
        async () => {
          for (const record of intents)
            await this.control.append({
              ...record,
              outcome: 'ABORTED',
              at: new Date().toISOString(),
            });
          intents.length = 0;
        },
      );
      for (const record of intents)
        await this.control.append({
          ...record,
          outcome: 'COMMITTED',
          at: new Date().toISOString(),
        });
    } catch (error) {
      if (knownRollback(error))
        for (const record of intents)
          await this.control.append({
            ...record,
            outcome: 'ABORTED',
            at: new Date().toISOString(),
          });
      throw error;
    }
  }
  /** Durable, keyset-bounded fanout. Claim locks never wait for custody locks. */
  async consumeExit() {
    const work = (
      await this.db.client.$queryRaw<
        SharedExitWork[]
      >`SELECT * FROM "SharedExitWork" WHERE "completedAt" IS NULL AND attempts<5 AND "nextAt"<=clock_timestamp() ORDER BY "nextAt","userId" LIMIT 1`
    )[0];
    if (!work) return false;
    try {
      const actors = await this.db.client.sharedActor.findMany({
        where: {
          userId: work.userId,
          ...(work.afterActorId ? { id: { gt: work.afterActorId } } : {}),
        },
        orderBy: { id: 'asc' },
        take: 25,
      });
      for (const actor of actors) {
        await this.exitActor(
          work.userId,
          actor.id,
          actor.spaceId,
          work.closedAt,
          false,
        );
        const result = await this.db.client.sharedExitWork.updateMany({
          where: { userId: work.userId, revision: work.revision },
          data: { afterActorId: actor.id },
        });
        if (result.count !== 1) return true;
      }
      if (actors.length < 25)
        await this.db.client.sharedExitWork.updateMany({
          where: { userId: work.userId, revision: work.revision },
          data: { completedAt: new Date(), failureCode: null, attempts: 0 },
        });
    } catch {
      await this.db.client.sharedExitWork.updateMany({
        where: {
          userId: work.userId,
          revision: work.revision,
          attempts: work.attempts,
        },
        data: {
          attempts: { increment: 1 },
          revision: { increment: 1 },
          failureCode: 'SHARED_EXIT_REQUIRES_REVIEW',
          nextAt: new Date(
            Date.now() + Math.min(3600000, 1000 * 2 ** work.attempts),
          ),
        },
      });
    }
    return true;
  }
  /** Bounded erasure pass BEFORE Personal owner locks; shared obligations never gate this pass. */
  async prepareIdentityErasure(userId: string, closedAt: Date) {
    const identity = await this.identity.current(this.db.client, userId);
    const invitations = await this.db.client.contextInvitation.findMany({
      where: {
        state: 'PENDING',
        OR: [
          { recipientUserId: userId },
          ...(identity
            ? [{ recipientEmail: this.identity.canonicalEmail(identity.email) }]
            : []),
        ],
      },
      orderBy: { id: 'asc' },
      take: 25,
    });
    for (const invitation of invitations) {
      const records: SharedControlRecord[] = [];
      const abort = async () => {
        for (const r of records)
          await this.control.append({
            ...r,
            outcome: 'ABORTED',
            at: new Date().toISOString(),
          });
        records.length = 0;
      };
      try {
        await this.transaction(
          [userId],
          [invitation.spaceId],
          null,
          async (tx) => {
            if (await this.accountActive(tx, userId))
              throw new ForbiddenException();
            const currentIdentity = await this.identity.current(tx, userId),
              row = await tx.contextInvitation.findUniqueOrThrow({
                where: { id: invitation.id },
              });
            if (
              row.state !== 'PENDING' ||
              (row.recipientUserId !== userId &&
                row.recipientEmail !==
                  (currentIdentity
                    ? this.identity.canonicalEmail(currentIdentity.email)
                    : null))
            )
              return;
            const custody = await tx.sharedCustody.findUniqueOrThrow({
              where: { spaceId: row.spaceId },
            });
            const record: SharedControlRecord = {
              id: randomUUID(),
              spaceId: row.spaceId,
              version: String(custody.authorizationVersion + 1n),
              action: 'invitation.recipient.erase',
              resourceId: row.id,
              outcome: 'INTENT',
              at: new Date().toISOString(),
            };
            await this.control.append(record);
            records.push(record);
            const actor =
              (await tx.sharedActor.findFirst({
                where: { spaceId: row.spaceId, userId },
              })) ??
              (await tx.sharedActor.create({
                data: {
                  id: randomUUID(),
                  spaceId: row.spaceId,
                  userId,
                  state: 'ACTIVE',
                },
              }));
            await tx.contextInvitation.update({
              where: { id: row.id },
              data: {
                state: 'REVOKED',
                endedAt: (
                  await tx.$queryRaw<
                    { now: Date }[]
                  >`SELECT clock_timestamp() AS now`
                )[0]!.now,
                recipientUserId: null,
                recipientEmail: null,
                proofHash: null,
                revision: { increment: 1 },
              },
            });
            await this.offerEffect(
              tx,
              { userId, requestId: record.id, correlationId: record.id },
              row.spaceId,
              actor.id,
              record.action,
              row.id,
              record.id,
            );
          },
          abort,
        );
        for (const r of records)
          await this.control.append({
            ...r,
            outcome: 'COMMITTED',
            at: new Date().toISOString(),
          });
      } catch (error) {
        if (knownRollback(error)) await abort();
        throw error;
      }
    }
    const actors = await this.db.client.sharedActor.findMany({
      where: { userId },
      orderBy: { id: 'asc' },
      take: 25,
    });
    for (const actor of actors)
      await this.exitActor(userId, actor.id, actor.spaceId, closedAt, true);
    return actors.length === 0 && invitations.length === 0;
  }
  /** Explicit reconciliation under the same custody fence, including lost-connection outcomes. */
  async reconcileControl(spaceId: string) {
    uuid.parse(spaceId);
    const records = (await this.control.records()).filter(
      (r) => r.spaceId === spaceId,
    );
    const terminal = new Set(
      records.filter((r) => r.outcome !== 'INTENT').map((r) => r.id),
    );
    const live = await this.db.client.sharedCustody.findUnique({
      where: { spaceId },
    });
    return this.transaction([], live ? [spaceId] : [], null, async (tx) => {
      if (!live) {
        const retired = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM "SharedLifecycleJob" WHERE "custodyId"=${spaceId}::uuid AND state='DELETED' AND "spaceId" IS NULL ORDER BY id FOR UPDATE`;
        if (
          !retired.length ||
          (await tx.sharedCustody.findUnique({ where: { spaceId } }))
        )
          throw new NotFoundException();
      }
      for (const record of records.filter(
        (r) => r.outcome === 'INTENT' && !terminal.has(r.id),
      )) {
        const effect = await tx.sharedOutboxEvent.findUnique({
          where: { auditId: record.id },
          include: { SharedAuditEvent: true },
        });
        const lifecycle = await tx.sharedLifecycleEffect.findUnique({
          where: { id: record.id },
        });
        if (
          effect &&
          (effect.spaceId !== spaceId ||
            effect.authorizationVersion !== BigInt(record.version) ||
            effect.action !== record.action ||
            effect.SharedAuditEvent.resourceId !== record.resourceId)
        )
          throw new ConflictException();
        if (
          lifecycle &&
          (lifecycle.custodyId !== spaceId ||
            lifecycle.authorizationVersion !== BigInt(record.version) ||
            lifecycle.action !== record.action ||
            lifecycle.jobId !== record.resourceId)
        )
          throw new ConflictException();
        if (
          !effect &&
          !lifecycle &&
          (await this.control.replayEvidence()).some((e) => e.id === record.id)
        )
          throw new ConflictException({ code: 'UNCERTAIN_RESTORE_OUTCOME' });
        if (!live && !effect && !lifecycle)
          throw new ConflictException({ code: 'LIFECYCLE_EFFECT_REQUIRED' });
        await this.control.append({
          ...record,
          outcome: effect || lifecycle ? 'COMMITTED' : 'ABORTED',
          at: new Date().toISOString(),
        });
      }
    });
  }
  async verifyRestoreFloor(
    tx: Prisma.TransactionClient = this.db.client,
    allowNewInstallation = false,
  ) {
    if (!this.config.SHARED_CONTROL_ACTIVE_KEY_ID) return;
    const rows = await tx.$queryRaw<
      { seconds: number }[]
    >`SELECT EXTRACT(EPOCH FROM "before")::float8 AS seconds FROM "SharedEvidenceFloor" WHERE id=1`;
    if (
      allowNewInstallation &&
      rows[0]?.seconds === 0 &&
      !(await tx.sharedCustody.count()) &&
      !(await tx.sharedLifecycleJob.count())
    )
      return;
    const floor = (await this.controlView(tx)).floor;
    if (!rows[0] || Math.round(rows[0].seconds * 1000) !== Date.parse(floor))
      throw new ForbiddenException({
        code: 'SHARED_BACKUP_CUTOFF_REPLAY_REQUIRED',
      });
  }
  async restoreRestrictions(
    spaceId: string,
    fileEffect: (
      tx: Prisma.TransactionClient,
      scope: SharedRestoreScope,
      fileId: string | null,
    ) => Promise<void>,
  ) {
    this.enabled();
    uuid.parse(spaceId);
    const records = (await this.control.records()).filter(
        (r) => r.spaceId === spaceId,
      ),
      evidence = await this.control.replayEvidence();
    const terminal = new Map(
      records
        .filter((r) => r.outcome !== 'INTENT')
        .map((r) => [r.id, r.outcome]),
    );
    if (records.some((r) => r.outcome === 'INTENT' && !terminal.has(r.id)))
      throw new ConflictException({ code: 'UNRESOLVED_RESTORE_INTENT' });
    const committed = [
      ...new Map(
        records.filter((r) => r.outcome === 'COMMITTED').map((r) => [r.id, r]),
      ).values(),
    ].sort((a, b) => (BigInt(a.version) < BigInt(b.version) ? -1 : 1));
    const actorHints = await this.db.client.sharedActor.findMany({
      where: { spaceId, userId: { not: null } },
      select: { userId: true },
    });
    const users = [
      ...new Set(actorHints.flatMap((a) => (a.userId ? [a.userId] : []))),
    ].sort();
    return this.transaction(users, [spaceId], null, async (tx) => {
      await this.verifyRestoreFloor(tx);
      let c = await tx.sharedCustody.findUniqueOrThrow({ where: { spaceId } }),
        count = 0;
      for (const record of committed
        .filter((r) => BigInt(r.version) > c.authorizationVersion)
        .slice(0, 25)) {
        const candidates = evidence.filter((e) => e.id === record.id);
        if (
          !candidates.length ||
          candidates.some(
            (e) => JSON.stringify(e) !== JSON.stringify(candidates[0]),
          )
        )
          throw new ConflictException({
            code: 'MISSING_OR_CONFLICTING_REPLAY_EVIDENCE',
          });
        const r = candidates[0]!;
        if (
          r.spaceId !== spaceId ||
          r.version !== record.version ||
          r.action !== record.action ||
          r.resourceId !== record.resourceId
        )
          throw new ConflictException();
        if (r.action === 'file.delete' && r.resourceId) {
          let open = true;
          const scope: SharedRestoreScope = {
            spaceId,
            verify: (client) => {
              if (!open || client !== tx) throw new ForbiddenException();
            },
          };
          try {
            await fileEffect(tx, scope, r.resourceId);
          } finally {
            open = false;
          }
        }
        await applySharedReplay(tx, r);
        c = await tx.sharedCustody.findUniqueOrThrow({ where: { spaceId } });
        count++;
      }
      const complete = !committed.some(
        (r) => BigInt(r.version) > c.authorizationVersion,
      );
      if (complete)
        await this.control.assertCurrent(spaceId, c.authorizationVersion);
      let open = true;
      const scope: SharedRestoreScope = {
        spaceId,
        verify: (client) => {
          if (!open || client !== tx) throw new ForbiddenException();
        },
      };
      try {
        await fileEffect(tx, scope, null);
      } finally {
        open = false;
      }
      return { processed: count, complete };
    });
  }
  async restoredFileEffect(
    spaceId: string,
    work: (
      tx: Prisma.TransactionClient,
      scope: SharedRestoreScope,
    ) => Promise<void>,
  ) {
    this.enabled();
    return this.transaction([], [spaceId], null, async (tx) => {
      await this.verifyRestoreFloor(tx);
      const c = await tx.sharedCustody.findUniqueOrThrow({
        where: { spaceId },
      });
      await this.control.assertCurrent(spaceId, c.authorizationVersion);
      let open = true;
      const scope: SharedRestoreScope = {
        spaceId,
        verify: (client) => {
          if (!open || client !== tx) throw new ForbiddenException();
        },
      };
      try {
        await work(tx, scope);
      } finally {
        open = false;
      }
    });
  }
  /** Owner facades use this AFTER current authority; payload bodies never enter the receipt. */
  async receipt(
    tx: Prisma.TransactionClient,
    authority: SharedAuthority,
    request: SharedRequest,
    input: { operation: string; key: string; fingerprint: string },
    work: () => Promise<{ id: string; statusCode: number }>,
  ) {
    const access = authority.require(
      tx,
      request.spaceId,
      request.capability,
      request.resource,
    );
    z.string()
      .regex(/^[a-z][a-z0-9.]{0,79}$/)
      .parse(input.operation);
    z.string().min(1).max(200).parse(input.key);
    z.string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(input.fingerprint);
    const now = (
        await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
      )[0]!.now,
      keyHash = hash(input.key);
    const unique = {
      spaceId: access.spaceId,
      scopeId: access.scopeId,
      actorId: access.actorId,
      operation: input.operation,
      keyHash,
    };
    const old = await tx.sharedMutationReceipt.findUnique({
      where: { spaceId_scopeId_actorId_operation_keyHash: unique },
    });
    if (old && old.expiresAt > now) {
      if (old.fingerprint !== input.fingerprint) throw new ConflictException();
      return { id: old.resultId, statusCode: old.statusCode };
    }
    if (old) await tx.sharedMutationReceipt.delete({ where: { id: old.id } });
    const result = await work();
    uuid.parse(result.id);
    await tx.sharedMutationReceipt.create({
      data: {
        id: randomUUID(),
        ...unique,
        fingerprint: input.fingerprint,
        resultId: result.id,
        statusCode: result.statusCode,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 86400000),
      },
    });
    return result;
  }
}
