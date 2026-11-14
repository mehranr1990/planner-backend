import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import { SharedKernel } from '../application/shared-kernel.service.js';
import type { SharedRequest } from '../application/shared-kernel.service.js';
import { CollaborationService } from '../application/collaboration.service.js';
export type IndependentSeatHint = {
  id: string;
  spaceId: string;
  actorId: string;
  generation: number;
  userId: string;
};

/** Spaces owns all identity/admission reads and writes used by Messaging. */
@Injectable()
export class MessagingAuthority {
  constructor(
    @Inject(CollaborationService)
    private readonly collaboration: CollaborationService,
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
    @Inject(DatabaseService) private readonly db: DatabaseService,
  ) {}
  displayName(tx: Prisma.TransactionClient, spaceId: string, actorId: string) {
    return this.collaboration.displayName(tx, spaceId, actorId);
  }
  async personal(tx: Prisma.TransactionClient, userId: string) {
    await this.kernel.verifiedRecipient(tx, userId);
    const space = await tx.space.findFirst({
      where: { kind: 'PERSONAL', ownerUserId: userId, accessClosedAt: null },
    });
    if (!space) throw new NotFoundException();
    const settings = await tx.userSettings.findUnique({
      where: { userId },
      select: { timezone: true },
    });
    return {
      spaceId: space.id,
      userId,
      timezone: settings?.timezone ?? 'UTC',
      verify: (current: Prisma.TransactionClient) => {
        if (current !== tx) throw new NotFoundException();
      },
    };
  }
  identityPresent(tx: Prisma.TransactionClient, userId: string) {
    return this.kernel.identityPresent(tx, userId);
  }
  async ownedActors(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    after?: string,
  ) {
    return (
      await tx.sharedActor.findMany({
        where: {
          userId: scope.actor.userId,
          ...(after ? { id: { gt: after } } : {}),
        },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: 1000,
      })
    ).map((v) => v.id);
  }
  async operator(scopeId: string) {
    const scope = await this.db.client.accessScope.findUnique({
      where: { id: scopeId },
    });
    if (!scope) return null;
    const root = await this.db.client.sharedCustody.findUnique({
        where: { spaceId: scope.spaceId },
      }),
      domain = await this.db.client.domainScopeCustody.findUnique({
        where: { scopeId },
      }),
      accessId = domain?.primaryOwnerAccessId ?? root?.primaryOwnerAccessId;
    const seat = accessId
      ? await this.db.client.contextAccess.findUnique({
          where: { id: accessId },
        })
      : null;
    return seat
      ? ((
          await this.db.client.sharedActor.findUnique({
            where: { id: seat.actorId },
          })
        )?.userId ?? null)
      : null;
  }
  /** Opaque invalidation hint only; never substitutes for participantAuthority. */
  async frame(tx: Prisma.TransactionClient, scopeId: string, userId: string) {
    const scope = await tx.accessScope.findUnique({ where: { id: scopeId } });
    if (!scope) return 'missing';
    const custody = await tx.sharedCustody.findUnique({
      where: { spaceId: scope.spaceId },
    });
    const domain = await tx.domainScopeCustody.findUnique({
      where: { scopeId },
    });
    const actors = await tx.sharedActor.findMany({
      where: { spaceId: scope.spaceId, userId },
      orderBy: { id: 'asc' },
    });
    const access = await tx.contextAccess.findMany({
      where: { scopeId, actorId: { in: actors.map((v) => v.id) } },
      orderBy: { id: 'asc' },
    });
    const seats = await tx.contextAccess.findMany({
      where: {
        id: {
          in: [
            custody?.primaryOwnerAccessId,
            domain?.primaryOwnerAccessId,
          ].filter((v): v is string => !!v),
        },
      },
      select: { actorId: true },
    });
    const custodians = await tx.sharedActor.findMany({
      where: { id: { in: seats.map((v) => v.actorId) } },
      select: { userId: true, state: true },
      orderBy: { id: 'asc' },
    });
    const accounts = await tx.space.findMany({
      where: {
        kind: 'PERSONAL',
        ownerUserId: {
          in: [
            userId,
            ...custodians.flatMap((v) => (v.userId ? [v.userId] : [])),
          ],
        },
      },
      select: { ownerUserId: true, accessClosedAt: true },
      orderBy: { id: 'asc' },
    });
    const exits = await tx.sharedExitWork.findMany({
      where: {
        userId: {
          in: accounts.flatMap((v) => (v.ownerUserId ? [v.ownerUserId] : [])),
        },
      },
      select: { userId: true, closedAt: true },
      orderBy: { userId: 'asc' },
    });
    // Ordinary writes in a sibling channel advance authorizationVersion too.
    // Invalidate on actual authority/lifecycle epochs, not unrelated content writes.
    return createHash('sha256')
      .update(
        JSON.stringify(
          {
            scope,
            custody,
            domain,
            actors,
            access,
            custodians,
            accounts,
            exits,
          },
          (k, v: unknown) =>
            ['authorizationVersion', 'revision'].includes(k)
              ? undefined
              : typeof v === 'bigint'
                ? String(v)
                : v,
        ),
      )
      .digest('hex');
  }
  async hints(ids: string[]) {
    return (
      await this.db.client.sharedActor.findMany({
        where: { id: { in: ids } },
        select: { userId: true },
      })
    ).flatMap((row) => (row.userId ? [row.userId] : []));
  }
  /** Lock hints only; `user` re-resolves inside the fenced operation. */
  async spaceHints(spaceId: string, actorIds: string[]) {
    if (!actorIds.length) return [];
    return (
      await this.db.client.sharedActor.findMany({
        where: { id: { in: actorIds }, spaceId, state: 'ACTIVE' },
        select: { userId: true },
      })
    ).flatMap((row) => (row.userId ? [row.userId] : []));
  }
  actors(actor: RequestActor) {
    return this.kernel.personalWork(actor, async (tx) =>
      (
        await tx.sharedActor.findMany({
          where: { userId: actor.userId, state: 'ACTIVE' },
          select: { id: true },
        })
      ).map((row) => row.id),
    );
  }
  async user(tx: Prisma.TransactionClient, spaceId: string, actorId: string) {
    const row = await tx.sharedActor.findFirst({
      where: { id: actorId, spaceId, state: 'ACTIVE' },
    });
    if (!row?.userId) throw new NotFoundException();
    await this.kernel.verifiedRecipient(tx, row.userId);
    return row.userId;
  }
  async actor(tx: Prisma.TransactionClient, spaceId: string, userId: string) {
    await this.kernel.verifiedRecipient(tx, userId);
    return (
      (await tx.sharedActor.findFirst({
        where: { spaceId, userId, state: 'ACTIVE' },
      })) ??
      tx.sharedActor.create({
        data: { id: randomUUID(), spaceId, userId, state: 'ACTIVE' },
      })
    );
  }
  async scope(tx: Prisma.TransactionClient, scopeId: string) {
    const scope = await tx.accessScope.findUniqueOrThrow({
      where: { id: scopeId },
    });
    const custody = await tx.sharedCustody.findUniqueOrThrow({
      where: { spaceId: scope.spaceId },
    });
    const domain = await tx.domainScopeCustody.findUnique({
      where: { scopeId },
    });
    return {
      spaceId: scope.spaceId,
      kind: domain?.kind ?? custody.kind,
      restoreGeneration: scope.restoreGeneration,
      policyVersion: scope.currentPolicyVersion,
    };
  }
  async proof(
    tx: Prisma.TransactionClient,
    actor: RequestActor,
    scopeId: string,
    userId: string,
    locked: string[],
    capability: SharedRequest['capability'] = 'task.read',
  ) {
    const current = await this.scope(tx, scopeId);
    const access = await this.kernel.participantAuthority(
      tx,
      actor,
      userId,
      { spaceId: current.spaceId, scopeId, capability },
      locked,
    );
    if (!access.role) throw new NotFoundException();
    return { ...access, ...current };
  }
  /** Accepted independent participation needs a custody-local attribution/admission,
   * distinct from conversation content authority. Never enrolls a work member. */
  async independentSeat(
    tx: Prisma.TransactionClient,
    spaceId: string,
    userId: string,
    now: Date,
    kind: 'CONVERSATION' | 'MEETING' = 'CONVERSATION',
  ) {
    const current = await this.scope(tx, spaceId);
    if (current.kind !== kind) throw new NotFoundException();
    const local = await this.actor(tx, spaceId, userId);
    let access = await tx.contextAccess.findUnique({
      where: {
        spaceId_scopeId_actorId: {
          spaceId,
          scopeId: spaceId,
          actorId: local.id,
        },
      },
    });
    if (!access) {
      access = await tx.contextAccess.create({
        data: {
          id: randomUUID(),
          spaceId,
          scopeId: spaceId,
          actorId: local.id,
          state: 'ACTIVE',
          memberRole: 'MEMBER',
          joinedAt: now,
        },
      });
      await tx.contextAccessInterval.create({
        data: {
          accessId: access.id,
          generation: access.generation,
          joinedAt: now,
        },
      });
    } else if (access.state !== 'ACTIVE') {
      access = await tx.contextAccess.update({
        where: { id: access.id },
        data: {
          state: 'ACTIVE',
          generation: { increment: 1 },
          revision: { increment: 1 },
          joinedAt: now,
          endedAt: null,
        },
      });
      await tx.contextAccessInterval.create({
        data: {
          accessId: access.id,
          generation: access.generation,
          joinedAt: now,
        },
      });
    }
    return access;
  }
  endIndependentSeat(
    tx: Prisma.TransactionClient,
    spaceId: string,
    actorId: string,
    now: Date,
  ) {
    return this.kernel.endCommunicationSeat(tx, spaceId, actorId, now);
  }
  independentSeatHints(kind: 'CONVERSATION' | 'MEETING', after?: string) {
    return this.db.client.$queryRaw<
      IndependentSeatHint[]
    >`SELECT a.id,a."spaceId",a."actorId",a.generation,u."userId" FROM "ContextAccess" a JOIN "SharedCustody" c ON c."spaceId"=a."spaceId" JOIN "SharedActor" u ON u.id=a."actorId" WHERE a."scopeId"=a."spaceId" AND c.kind=${kind} AND c.state IN ('ACTIVE','OWNER_EXIT_FROZEN') AND a.state='ACTIVE' AND u.state='ACTIVE' AND u."userId" IS NOT NULL AND (${after ?? null}::uuid IS NULL OR a.id>${after ?? null}::uuid) ORDER BY a.id LIMIT 25`;
  }
  async reconcileIndependentSeat(
    kind: 'CONVERSATION' | 'MEETING',
    hint: IndependentSeatHint,
    validate: (tx: Prisma.TransactionClient) => Promise<Date | null>,
  ) {
    const action = 'lifecycle.communication.reconcile';
    return this.collaboration.signed(
      null,
      hint.spaceId,
      await this.kernel.offerUserHints(hint.spaceId, hint.userId),
      action,
      hint.id,
      async (tx, _now, _locked, begin) => {
        const current = await this.scope(tx, hint.spaceId),
          seat = await tx.contextAccess.findUnique({ where: { id: hint.id } });
        if (
          current.kind !== kind ||
          !seat ||
          seat.state !== 'ACTIVE' ||
          seat.generation !== hint.generation ||
          seat.actorId !== hint.actorId
        )
          return false;
        const endedAt = await validate(tx);
        if (!endedAt || endedAt < seat.joinedAt) return false;
        await this.kernel.endCommunicationSeat(
          tx,
          hint.spaceId,
          hint.actorId,
          endedAt,
        );
        const audit = await begin();
        await this.kernel.offerEffect(
          tx,
          { userId: hint.userId, requestId: audit, correlationId: audit },
          hint.spaceId,
          hint.actorId,
          action,
          hint.id,
          audit,
        );
        return true;
      },
    );
  }
  /** Meeting's owner invokes this only after its current organizer/delegation check.
   * This changes no work-source membership or custody. */
  async meetingOrganizerSeat(
    tx: Prisma.TransactionClient,
    scopeId: string,
    actorId: string,
    organizer: boolean,
  ) {
    if ((await this.scope(tx, scopeId)).kind !== 'MEETING')
      throw new NotFoundException();
    const seat = await tx.contextAccess.findFirst({
      where: { spaceId: scopeId, scopeId, actorId, state: 'ACTIVE' },
    });
    if (!seat) throw new NotFoundException();
    const memberRole = organizer ? 'ADMIN' : 'MEMBER';
    if (seat.memberRole !== memberRole)
      await tx.contextAccess.update({
        where: { id: seat.id },
        data: { memberRole, revision: { increment: 1 } },
      });
  }
  /** Location/lock hints only. Domain readers must still obtain current proof. */
  sourceMembers(
    scopeId: string,
    tx: Prisma.TransactionClient = this.db.client,
  ) {
    return tx.contextAccess.findMany({
      where: { scopeId, state: 'ACTIVE', memberRole: { not: null } },
      select: {
        id: true,
        actorId: true,
        generation: true,
        spaceId: true,
        scopeId: true,
      },
      orderBy: { id: 'asc' },
      take: 1001,
    });
  }
  sourceMemberUser(
    tx: Prisma.TransactionClient,
    scopeId: string,
    accessId: string,
  ) {
    return this.kernel.memberUserInTransaction(tx, scopeId, accessId);
  }
}
