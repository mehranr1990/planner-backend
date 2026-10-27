import { NotFoundException } from '@nestjs/common';
import type { RequestActor } from '../auth/request-actor.js';

/** Capability created only after checking the authoritative personal-space row. */
export class AuthorizedSpace {
  private readonly authorized = true;
  private constructor(
    readonly actor: RequestActor,
    readonly spaceId: string,
  ) {
    Object.freeze(this);
  }

  static personal(
    actor: RequestActor,
    row: { id: string; kind: string; ownerUserId: string } | null,
  ): AuthorizedSpace {
    if (!row || row.kind !== 'PERSONAL' || row.ownerUserId !== actor.userId)
      throw new NotFoundException();
    return new AuthorizedSpace(actor, row.id);
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
