import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
export type ConversationSourceKind = 'SOCIAL_ACTIVITY';
/**
 * ADR 0062: an owning context answers only "may this user participate now, and
 * with which role". Messaging keeps every message, member and admission write.
 */
export abstract class ConversationSourceGuard {
  abstract assert(
    tx: Prisma.TransactionClient,
    sourceId: string,
    userId: string,
  ): Promise<'ADMIN' | 'MEMBER'>;
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
    if (!conv.sourceKind) return null;
    const guard = this.guards.get(conv.sourceKind as ConversationSourceKind);
    if (!guard || !conv.sourceId) throw new NotFoundException();
    return guard.assert(tx, conv.sourceId, userId);
  }
}
