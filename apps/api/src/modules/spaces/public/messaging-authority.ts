import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import { SharedKernel } from '../application/shared-kernel.service.js';

/** Spaces owns all identity/admission reads and writes used by Messaging. */
@Injectable()
export class MessagingAuthority {
  constructor(
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
    @Inject(DatabaseService) private readonly db: DatabaseService,
  ) {}
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
  ) {
    const current = await this.scope(tx, scopeId);
    const access = await this.kernel.participantAuthority(
      tx,
      actor,
      userId,
      { spaceId: current.spaceId, scopeId, capability: 'task.read' },
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
  ) {
    const current = await this.scope(tx, spaceId);
    if (current.kind !== 'CONVERSATION') throw new NotFoundException();
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
}
