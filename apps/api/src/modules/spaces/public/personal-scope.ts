import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import type { Prisma } from '../../../generated/prisma/client.js';
/** Only Spaces owns authoritative mutation access and its commit-order counter. */
export function personalScope(
  actor: RequestActor,
  row: { id: string; kind: string; ownerUserId: string } | null,
) {
  const scope = AuthorizedSpace.personal(actor, row, {
    async fence(tx: Prisma.TransactionClient) {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'personal-access:' + row!.id},0))::text`;
      const found = await tx.space.findFirst({
        where: { id: row!.id, kind: 'PERSONAL', ownerUserId: actor.userId },
        select: { accessClosedAt: true },
      });
      if (!found) throw new NotFoundException();
      if (found.accessClosedAt)
        throw new ForbiddenException({ code: 'ACCOUNT_CLOSED' });
    },
    async reserve(tx: Prisma.TransactionClient, count: number) {
      await scope.fence(tx);
      const changed = await tx.space.update({
        where: { id: row!.id, ownerUserId: actor.userId },
        data: { syncSequence: { increment: count } },
        select: { syncSequence: true },
      });
      return changed.syncSequence - BigInt(count) + 1n;
    },
    async syncState(tx: Prisma.TransactionClient) {
      const found = await tx.space.findFirst({
        where: { id: row!.id, ownerUserId: actor.userId, accessClosedAt: null },
        select: {
          syncEpoch: true,
          syncSequence: true,
          syncRetainedSequence: true,
        },
      });
      if (!found) throw new ForbiddenException({ code: 'ACCOUNT_CLOSED' });
      return {
        epoch: found.syncEpoch,
        sequence: found.syncSequence,
        retained: found.syncRetainedSequence,
      };
    },
    async retainFrom(tx: Prisma.TransactionClient, sequence: bigint) {
      await scope.fence(tx);
      const state = await scope.syncState(tx);
      if (sequence < state.retained || sequence > state.sequence)
        throw new NotFoundException();
      await tx.space.update({
        where: { id: row!.id, ownerUserId: actor.userId },
        data: { syncRetainedSequence: sequence },
      });
    },
  });
  return scope;
}
