import { Inject, Injectable, ForbiddenException } from '@nestjs/common';
import { PersonalSpaceSchema } from '@mehran/api-contracts';
import { SPACES_REPOSITORY } from './spaces.port.js';
import type { SpacesPort } from './spaces.port.js';
import { SpacePolicyService } from '../../../platform/authorization/space-policy.service.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { personalScope } from '../public/personal-scope.js';
import { PrivacyGate } from '../../../platform/authorization/privacy-gate.js';
import { DatabaseService } from '../../../platform/database/database.service.js';

@Injectable()
export class SpacesService {
  async background(
    tx: Prisma.TransactionClient,
    spaceId: string,
    requestId: string,
    correlationId: string,
  ) {
    const row = await tx.space.findUnique({
      where: { id: spaceId },
      select: { id: true, kind: true, ownerUserId: true, accessClosedAt: true },
    });
    if (!row || row.accessClosedAt) return null;
    return personalScope(
      { userId: row.ownerUserId, requestId, correlationId },
      row,
    );
  }
  constructor(
    @Inject(SPACES_REPOSITORY) private readonly repository: SpacesPort,
    @Inject(SpacePolicyService) private readonly policy: SpacePolicyService,
    @Inject(PrivacyGate) private readonly privacy: PrivacyGate,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}
  async personalFor(userId: string) {
    const space = await this.repository.personalFor(userId);
    this.policy.assertOwner(userId, space);
    return PersonalSpaceSchema.parse({
      id: space.id,
      kind: space.kind,
      ownerUserId: space.ownerUserId,
      createdAt: space.createdAt.toISOString(),
      updatedAt: space.updatedAt.toISOString(),
    });
  }
  async assertOwned(userId: string, spaceId: string) {
    const space = await this.repository.findOwned(userId, spaceId);
    this.policy.assertOwner(userId, space);
    return space.id;
  }
  async authorizePersonal(actor: RequestActor) {
    this.privacy.assert();
    const space = await this.repository.personalFor(actor.userId);
    this.policy.assertOwner(actor.userId, space);
    if (space.accessClosedAt)
      throw new ForbiddenException({ code: 'ACCOUNT_CLOSED' });
    return personalScope(actor, space);
  }
  async admit(userId: string) {
    this.privacy.assert();
    const space = await this.database.client.space.findFirst({
      where: { kind: 'PERSONAL', ownerUserId: userId },
    });
    if (!space || space.accessClosedAt)
      throw new ForbiddenException({ code: 'ACCOUNT_CLOSED' });
  }
  async setClosed(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    closed: boolean,
  ) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`personal-access:${scope.spaceId}`},0))::text`;
    const row = await tx.space.findFirst({
      where: {
        id: scope.spaceId,
        ownerUserId: scope.actor.userId,
        kind: 'PERSONAL',
      },
    });
    if (!row) throw new ForbiddenException();
    await tx.space.update({
      where: { id: row.id },
      data: { accessClosedAt: closed ? new Date() : null },
    });
  }
  async erasureScope(
    tx: Prisma.TransactionClient,
    userId: string,
    spaceId: string,
    requestId: string,
  ) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`personal-access:${spaceId}`},0))::text`;
    const row = await tx.space.findFirst({
      where: {
        id: spaceId,
        ownerUserId: userId,
        kind: 'PERSONAL',
        accessClosedAt: { not: null },
      },
    });
    if (!row) throw new ForbiddenException();
    return personalScope({ userId, requestId, correlationId: requestId }, row);
  }
  async erase(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    await this.erasureScope(
      tx,
      scope.actor.userId,
      scope.spaceId,
      scope.actor.requestId,
    );
    await tx.space.delete({ where: { id: scope.spaceId } });
  }
  async isClosed(
    tx: Prisma.TransactionClient,
    userId: string,
    spaceId: string,
  ) {
    const row = await tx.space.findFirst({
      where: { id: spaceId, ownerUserId: userId },
      select: { accessClosedAt: true },
    });
    return !!row?.accessClosedAt;
  }
  restoredPersonal(tx: Prisma.TransactionClient, userId: string) {
    return tx.space.findFirst({
      where: { ownerUserId: userId, kind: 'PERSONAL' },
      select: { id: true, kind: true, ownerUserId: true, accessClosedAt: true },
    });
  }
  async restoreClosure(
    tx: Prisma.TransactionClient,
    userId: string,
    spaceId: string,
    closed: boolean,
    requestId: string,
  ) {
    const row = await this.restoredPersonal(tx, userId);
    if (!row || row.id !== spaceId) throw new ForbiddenException();
    const scope = personalScope(
      { userId, requestId, correlationId: requestId },
      row,
    );
    await this.setClosed(tx, scope, closed);
    return scope;
  }
}
