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
    private readonly defaultScopeId?: string,
    private readonly parent?: SharedAuthority,
  ) {}
  private isOpen(): boolean {
    return this.open && (!this.parent || this.parent.isOpen());
  }
  scope(tx: Prisma.TransactionClient, spaceId: string): string {
    const scopeId = this.defaultScopeId ?? spaceId;
    if (
      !this.isOpen() ||
      tx !== this.tx ||
      !this.access.some(
        (a) =>
          (a.spaceId === spaceId || a.scopeId === spaceId) &&
          a.scopeId === scopeId,
      )
    )
      throw new ForbiddenException();
    return scopeId;
  }
  space(tx: Prisma.TransactionClient, selector: string): string {
    const scopeId = this.scope(tx, selector);
    const proof = this.access.find(
      (a) =>
        a.scopeId === scopeId &&
        (a.spaceId === selector || a.scopeId === selector),
    );
    if (!proof) throw new ForbiddenException();
    return proof.spaceId;
  }
  forScope(tx: Prisma.TransactionClient, spaceId: string, scopeId: string) {
    if (!this.isOpen() || tx !== this.tx) throw new ForbiddenException();
    return new SharedAuthority(
      tx,
      this.access.filter((a) => a.spaceId === spaceId && a.scopeId === scopeId),
      scopeId,
      this,
    );
  }
  require(
    tx: Prisma.TransactionClient,
    spaceId: string,
    capability: SharedCapability,
    resource?: { kind: 'PROJECT' | 'TASK' | 'GOAL'; id: string },
    scopeId = this.defaultScopeId ?? spaceId,
  ) {
    const found = this.access.find(
      (a) =>
        (a.spaceId === spaceId || a.scopeId === spaceId) &&
        a.scopeId === scopeId &&
        a.capability === capability &&
        (!a.resource ||
          (resource?.id === a.resource.id &&
            resource.kind === a.resource.kind)),
    );
    if (!this.isOpen() || tx !== this.tx || !found)
      throw new ForbiddenException();
    return found;
  }
  close() {
    this.open = false;
  }
  has(
    tx: Prisma.TransactionClient,
    spaceId: string,
    capability: SharedCapability,
    resource?: { kind: 'PROJECT' | 'TASK' | 'GOAL'; id: string },
    scopeId = this.defaultScopeId ?? spaceId,
  ) {
    try {
      this.require(tx, spaceId, capability, resource, scopeId);
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
    }
  }
}
