import { createHash } from 'node:crypto';
import { SupportInboundStore } from './support-inbound.js';
import type {
  InboundReplyClaim,
  InboundReplyResult,
  StagedSupportEvidence,
} from './support-inbound.js';

export type InboundTicket = {
  id: string;
  ownerUserId: string;
  currentEmail: string;
  emailVerified: boolean;
  accountAvailable: boolean;
  acceptsReply: boolean;
  correlationExpiresAt: Date;
  correlationRevoked: boolean;
};
export type InboundReceipt = {
  fingerprint: string;
  result: InboundReplyResult;
};
/** All operations use ONE database transaction. Implementations must serialize
 * both dedup identities before lookup and lock the ticket during correlation.
 * Unique constraints remain mandatory even when advisory locks are used.
 */
export interface InboundTicketTransaction {
  lockIdentities(
    transportId: string,
    providerHash: string,
    messageHash: string,
  ): Promise<void>;
  receipts(
    transportId: string,
    providerHash: string,
    messageHash: string,
  ): Promise<readonly InboundReceipt[]>;
  ticketForCorrelation(hash: string): Promise<InboundTicket | null>;
  canonicalEmail(email: string): string;
  /** Returns false without consuming ANY counters if one limit is exceeded. */
  takeRates(
    keys: readonly { key: string; limit: number; windowMs: number }[],
    now: Date,
  ): Promise<boolean>;
  appendPublicReply(
    ticket: InboundTicket,
    text: string,
    evidence: readonly StagedSupportEvidence[],
  ): Promise<void>;
  receipt(
    claim: InboundReplyClaim,
    result: InboundReplyResult,
    ticketId: string | null,
  ): Promise<void>;
  audit(input: {
    transportId: string;
    messageHash: string;
    ticketId: string | null;
    code: string;
  }): Promise<void>;
}
export abstract class InboundTicketPersistence {
  abstract transaction<T>(
    work: (tx: InboundTicketTransaction) => Promise<T>,
  ): Promise<T>;
  abstract auditRejected(input: {
    transportId: string;
    messageHash: string | null;
    code: string;
  }): Promise<void>;
}

/** Durable-store algorithm; persistence is owned by the Support ticket module.
 * Rejections and successful receipts commit with their audit. Exceptions roll
 * back reply, evidence links, limits and receipt together and can be retried.
 */
export class AtomicSupportInboundStore extends SupportInboundStore {
  constructor(private readonly persistence: InboundTicketPersistence) {
    super();
  }
  auditRejected(input: {
    transportId: string;
    messageHash: string | null;
    code: string;
  }) {
    return this.persistence.auditRejected(input);
  }
  apply(
    claim: InboundReplyClaim,
    evidence: readonly StagedSupportEvidence[],
  ): Promise<InboundReplyResult> {
    return this.persistence.transaction(async (tx) => {
      await tx.lockIdentities(
        claim.transportId,
        claim.providerMessageHash,
        claim.messageHash,
      );
      const prior = await tx.receipts(
        claim.transportId,
        claim.providerMessageHash,
        claim.messageHash,
      );
      const audit = (code: string, ticketId: string | null = null) =>
        tx.audit({
          transportId: claim.transportId,
          messageHash: claim.messageHash,
          ticketId,
          code,
        });
      if (prior.length) {
        if (
          prior.some((receipt) => receipt.fingerprint !== claim.fingerprint)
        ) {
          await audit('INBOUND_CHANGED_REPLAY');
          return { state: 'REJECTED', code: 'INBOUND_REPLY_REJECTED' };
        }
        await audit('INBOUND_DUPLICATE');
        return prior[0]!.result.state === 'ACCEPTED'
          ? { state: 'DUPLICATE', code: 'REPLY_ALREADY_RECORDED' }
          : prior[0]!.result;
      }
      const ticket = await tx.ticketForCorrelation(claim.correlationHash);
      const reject = async (code: string): Promise<InboundReplyResult> => {
        const result: InboundReplyResult = {
          state: 'REJECTED',
          code: 'INBOUND_REPLY_REJECTED',
        };
        await audit(code, ticket?.id ?? null);
        await tx.receipt(claim, result, ticket?.id ?? null);
        return result;
      };
      if (
        !ticket ||
        ticket.correlationRevoked ||
        ticket.correlationExpiresAt <= claim.now ||
        !ticket.accountAvailable ||
        !ticket.emailVerified ||
        !ticket.acceptsReply ||
        tx.canonicalEmail(ticket.currentEmail) !==
          tx.canonicalEmail(claim.senderEmail)
      )
        return reject('INBOUND_TICKET_OR_SENDER_UNAVAILABLE');
      const sender = createHash('sha256')
        .update(tx.canonicalEmail(claim.senderEmail))
        .digest('hex');
      const rates = ['sender:' + sender, 'ticket:' + ticket.id].flatMap(
        (key) => [
          { key, limit: 10, windowMs: 10 * 60_000 },
          { key, limit: 100, windowMs: 86400000 },
        ],
      );
      if (!(await tx.takeRates(rates, claim.now)))
        return reject('INBOUND_RATE_LIMITED');
      // Evidence is private staged material supplied by this message; storage
      // validates ownership/staging IDs before linking inside this transaction.
      await tx.appendPublicReply(ticket, claim.text, evidence);
      const result: InboundReplyResult = {
        state: 'ACCEPTED',
        code: 'REPLY_RECORDED',
      };
      await tx.receipt(claim, result, ticket.id);
      await audit('INBOUND_REPLY_RECORDED', ticket.id);
      return result;
    });
  }
}
