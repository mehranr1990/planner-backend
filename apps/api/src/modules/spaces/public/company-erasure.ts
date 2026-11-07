import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
/** Narrow lifecycle callback. Companies owns redaction; Spaces owns actor detachment. */
@Injectable()
export class CompanyErasure {
  private owner?: (
    tx: Prisma.TransactionClient,
    spaceId: string,
    actorId: string,
  ) => Promise<void>;
  register(
    owner: (
      tx: Prisma.TransactionClient,
      spaceId: string,
      actorId: string,
    ) => Promise<void>,
  ) {
    if (this.owner) throw new Error('Company erasure owner already registered');
    this.owner = owner;
  }
  erase(tx: Prisma.TransactionClient, spaceId: string, actorId: string) {
    if (!this.owner)
      throw new ServiceUnavailableException(
        'Company erasure owner unavailable',
      );
    return this.owner(tx, spaceId, actorId);
  }
}
