import { NotFoundException } from '@nestjs/common';
import type { RequestActor } from '../auth/request-actor.js';
import type { Prisma } from '../../generated/prisma/client.js';
export type SpaceTransactionAuthority = {
  fence(tx: Prisma.TransactionClient): Promise<void>;
  reserve(tx: Prisma.TransactionClient, count: number): Promise<bigint>;
  syncState(
    tx: Prisma.TransactionClient,
  ): Promise<{ epoch: string; sequence: bigint; retained: bigint }>;
  retainFrom(tx: Prisma.TransactionClient, sequence: bigint): Promise<void>;
};

/** Capability created only after checking the authoritative personal-space row. */
export class AuthorizedSpace {
  private readonly authorized = true;
  private constructor(
    readonly actor: RequestActor,
    readonly spaceId: string,
    private readonly transactions?: SpaceTransactionAuthority,
  ) {
    Object.freeze(this);
  }

  static personal(
    actor: RequestActor,
    row: { id: string; kind: string; ownerUserId: string } | null,
    transactions?: SpaceTransactionAuthority,
  ): AuthorizedSpace {
    if (!row || row.kind !== 'PERSONAL' || row.ownerUserId !== actor.userId)
      throw new NotFoundException();
    return new AuthorizedSpace(actor, row.id, transactions);
  }

  async fence(tx: Prisma.TransactionClient): Promise<void> {
    if (!this.transactions) throw new NotFoundException();
    await this.transactions.fence(tx);
  }
  async reserveSync(
    tx: Prisma.TransactionClient,
    count: number,
  ): Promise<bigint> {
    if (
      !this.transactions ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > 10000
    )
      throw new NotFoundException();
    return this.transactions.reserve(tx, count);
  }
  async syncState(tx: Prisma.TransactionClient) {
    if (!this.transactions) throw new NotFoundException();
    return this.transactions.syncState(tx);
  }
  async retainSyncFrom(tx: Prisma.TransactionClient, sequence: bigint) {
    if (!this.transactions) throw new NotFoundException();
    return this.transactions.retainFrom(tx, sequence);
  }

  assertActor(actor: RequestActor): void {
    if (
      !this.authorized ||
      this.actor.userId !== actor.userId ||
      this.actor.requestId !== actor.requestId
    )
      throw new NotFoundException();
  }
}
