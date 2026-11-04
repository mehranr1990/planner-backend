import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { SharedCapability, SharedRole } from '../domain/shared-policy.js';
export type SharedAccess = Readonly<{
  spaceId: string;
  scopeId: string;
  actorId: string;
  accessId: string;
  generation: number;
  role: SharedRole | null;
  resource?: { kind: 'PROJECT' | 'TASK' | 'GOAL'; id: string };
  authorizationVersion: bigint;
  capability: SharedCapability;
}>;
/** Transaction-local, action-specific authority. Never a Personal AuthorizedSpace. */
export class SharedAuthority {
  private open = true;
  constructor(
    private readonly tx: Prisma.TransactionClient,
    private readonly access: SharedAccess[],
  ) {}
  require(
    tx: Prisma.TransactionClient,
    spaceId: string,
    capability: SharedCapability,
    resource?: { kind: 'PROJECT' | 'TASK' | 'GOAL'; id: string },
  ) {
    const found = this.access.find(
      (a) =>
        a.spaceId === spaceId &&
        a.capability === capability &&
        (!a.resource ||
          (resource?.id === a.resource.id &&
            resource.kind === a.resource.kind)),
    );
    if (!this.open || tx !== this.tx || !found) throw new ForbiddenException();
    return found;
  }
  close() {
    this.open = false;
  }
}
