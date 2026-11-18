import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
export type ConversationSourceKind = 'SOCIAL_ACTIVITY' | 'SOCIAL_GROUP';
export type SourceRole = 'ADMIN' | 'MEMBER';
/**
 * `since`: start of the user's current authority in the owning context. A
 * Messaging membership admitted before it is stale (e.g. a re-admitted Group
 * member) and must re-join, so history restarts at the new join point.
 */
export type SourceGrant = { role: SourceRole; since: Date | null };
/**
 * ADR 0062: an owning context answers only "may this user participate now, and
 * with which role". Messaging keeps every message, member and admission write.
 */
export abstract class ConversationSourceGuard {
  abstract assert(
    tx: Prisma.TransactionClient,
    sourceId: string,
    userId: string,
  ): Promise<SourceRole | SourceGrant>;
}
@Injectable()
export class ConversationSources {
  private readonly guards = new Map<
    ConversationSourceKind,
    ConversationSourceGuard
  >();
  register(kind: ConversationSourceKind, guard: ConversationSourceGuard) {
    this.guards.set(kind, guard);
  }
  /** Fails closed when a sourced conversation has no registered owner guard. */
  async check(
    tx: Prisma.TransactionClient,
    conv: { sourceKind: string | null; sourceId: string | null },
    userId: string,
  ) {
    return (await this.grant(tx, conv, userId))?.role ?? null;
  }
  async grant(
    tx: Prisma.TransactionClient,
    conv: { sourceKind: string | null; sourceId: string | null },
    userId: string,
  ): Promise<SourceGrant | null> {
    if (!conv.sourceKind) return null;
    const guard = this.guards.get(conv.sourceKind as ConversationSourceKind);
    if (!guard || !conv.sourceId) throw new NotFoundException();
    const g = await guard.assert(tx, conv.sourceId, userId);
    return typeof g === 'string' ? { role: g, since: null } : g;
  }
}
