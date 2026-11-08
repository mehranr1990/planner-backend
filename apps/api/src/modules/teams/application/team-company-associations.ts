import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import type { SharedCleanupScope } from '../../../platform/lifecycle/shared-cleanup.js';
import { SharedKernel, SharedAuthority } from '../../spaces/public/index.js';
import { TeamsService } from './teams.service.js';
@Injectable()
export class TeamCompanyAssociations {
  constructor(
    @Inject(TeamsService) private readonly sources: TeamsService,
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
  ) {}
  hint(id: string) {
    return this.sources.hint(id);
  }
  async owner(
    tx: Prisma.TransactionClient,
    actor: RequestActor,
    sourceId: string,
    locked: string[],
    userId = actor.userId,
  ) {
    const row = await tx.team.findUnique({ where: { id: sourceId } });
    if (!row || row.spaceId !== row.scopeId || row.id !== row.spaceId)
      throw new NotFoundException();
    const a = await this.kernel.participantAuthority(
      tx,
      actor,
      userId,
      {
        spaceId: row.spaceId,
        scopeId: row.scopeId,
        capability: 'custody.transfer',
      },
      locked,
    );
    const r = await this.kernel.participantAuthority(
      tx,
      actor,
      userId,
      { spaceId: row.spaceId, scopeId: row.scopeId, capability: 'task.read' },
      locked,
    );
    const proof = new SharedAuthority(tx, [r]);
    let epoch: number;
    try {
      epoch = await this.kernel.relationshipEpoch(tx, proof, row.spaceId);
    } finally {
      proof.close();
    }
    return { row, a, epoch };
  }
  rows(
    tx: Prisma.TransactionClient,
    where: Prisma.TeamCompanyAssociationWhereInput,
  ) {
    return tx.teamCompanyAssociation.findMany({
      where,
      orderBy: { id: 'asc' },
      take: 1001,
    });
  }
  row(tx: Prisma.TransactionClient, id: string) {
    return tx.teamCompanyAssociation.findUnique({ where: { id } });
  }
  create(
    tx: Prisma.TransactionClient,
    data: Prisma.TeamCompanyAssociationUncheckedCreateInput,
  ) {
    return tx.teamCompanyAssociation.create({ data });
  }
  update(
    tx: Prisma.TransactionClient,
    id: string,
    data: Prisma.TeamCompanyAssociationUncheckedUpdateInput,
  ) {
    return tx.teamCompanyAssociation.update({ where: { id }, data });
  }
  async cleanupCompany(tx: Prisma.TransactionClient, s: SharedCleanupScope) {
    s.verify(tx);
    return (
      (await tx.$executeRaw`DELETE FROM "TeamCompanyAssociation" WHERE id IN (SELECT id FROM "TeamCompanyAssociation" WHERE "companySpaceId"=${s.spaceId}::uuid ORDER BY id LIMIT 200)`) ===
      0
    );
  }
}
