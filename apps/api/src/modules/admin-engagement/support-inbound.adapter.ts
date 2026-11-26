import { lockEngagementPersonal } from '../spaces/public/engagement-availability.js';
import { engagementPersonalOpen } from '../spaces/public/engagement-availability.js';
import { Injectable, Inject } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AtomicSupportInboundStore,
  InboundTicketPersistence,
  type InboundTicketTransaction,
} from '../../platform/admin/support-inbound-store.js';
import {
  SupportInboundProcessor,
  type SupportInboundAdapter,
  type InboundReplyResult,
} from '../../platform/admin/support-inbound.js';
import { EngagementCore, hash, json } from './engagement-core.js';
import { SupportService } from './support.service.js';
import { EngagementEvidence } from './engagement-evidence.js';
import { engagementIdentity } from '../account/public/engagement.js';
export const SUPPORT_INBOUND_ADAPTER = Symbol('SUPPORT_INBOUND_ADAPTER');
export const SUPPORT_INBOUND_DOMAIN = Symbol('SUPPORT_INBOUND_DOMAIN');
@Injectable()
export class PostgresSupportInbound extends InboundTicketPersistence {
  constructor(
    @Inject(EngagementCore) private readonly core: EngagementCore,
    @Inject(SupportService) private readonly support: SupportService,
    @Inject(EngagementEvidence) private readonly evidence: EngagementEvidence,
  ) {
    super();
  }
  async auditRejected(input: {
    transportId: string;
    messageHash: string | null;
    code: string;
  }) {
    await this.core.db.client.adminAuditEvent.create({
      data: {
        action: 'SUPPORT_INBOUND_REJECTED',
        requestId: randomUUID(),
        outcome: 'DENIED',
        metadata: input,
      },
    });
  }
  transaction<T>(work: (tx: InboundTicketTransaction) => Promise<T>) {
    this.core.privacy.assert();
    return this.core.db.client.$transaction(async (tx) => {
      const adapter: InboundTicketTransaction = {
        lockIdentities: async (transport, provider, message) => {
          for (const key of [
            'provider:' + transport + ':' + provider,
            'message:' + message,
          ].sort())
            await this.core.lock(tx, 'p4-inbound:' + key);
        },
        receipts: async (transportId, providerMessageHash, messageHash) =>
          (
            await tx.supportInboundReceipt.findMany({
              where: {
                OR: [{ transportId, providerMessageHash }, { messageHash }],
              },
            })
          ).map((r) => ({
            fingerprint: r.fingerprint,
            result: r.result as InboundReplyResult,
          })),
        ticketForCorrelation: async (correlationHash) => {
          const hint = await tx.supportTicket.findUnique({
            where: { correlationHash },
          });
          if (!hint) return null;
          if (!(await lockEngagementPersonal(tx, hint.ownerUserId, false)))
            return null;
          const ticket = await this.core.ticket(tx, hint.id);
          let owner;
          try {
            owner = await engagementIdentity(tx, ticket.ownerUserId);
          } catch {
            return null;
          }
          return {
            id: ticket.id,
            ownerUserId: ticket.ownerUserId,
            currentEmail: owner.email,
            emailVerified: owner.emailVerified,
            accountAvailable:
              owner.active &&
              (await engagementPersonalOpen(tx, ticket.ownerUserId)),
            acceptsReply:
              !ticket.archivedAt &&
              !['RESOLVED', 'CLOSED'].includes(ticket.state),
            correlationExpiresAt: ticket.correlationExpiresAt ?? new Date(0),
            correlationRevoked:
              ticket.correlationHash !== correlationHash ||
              ticket.correlationEmailHash !== hash(owner.email.toLowerCase()),
          };
        },
        canonicalEmail: (email) => email.trim().toLowerCase(),
        takeRates: (keys, now) => this.core.rate(tx, keys, now),
        appendPublicReply: async (ticket, text, staged) => {
          await this.core.restricted(tx, ticket.ownerUserId, 'SUPPORT');
          const row = await this.core.ticket(tx, ticket.id),
            reply = await this.support.reply(
              tx,
              row,
              text,
              { userId: ticket.ownerUserId },
              false,
              'EMAIL',
            );
          await this.evidence.attach(
            tx,
            staged,
            { ticketId: ticket.id, replyId: reply.id },
            null,
          );
        },
        receipt: async (claim, result, ticketId) => {
          await tx.supportInboundReceipt.create({
            data: {
              transportId: claim.transportId,
              providerMessageHash: claim.providerMessageHash,
              messageHash: claim.messageHash,
              fingerprint: claim.fingerprint,
              ticketId,
              result: json(result),
            },
          });
        },
        audit: async (input) => {
          await tx.adminAuditEvent.create({
            data: {
              action: 'SUPPORT_INBOUND',
              requestId: randomUUID(),
              outcome:
                input.code === 'INBOUND_REPLY_RECORDED'
                  ? 'SUCCEEDED'
                  : 'DENIED',
              metadata: input,
            },
          });
        },
      };
      return work(adapter);
    });
  }
}
@Injectable()
export class SupportInboundRuntime extends SupportInboundProcessor {
  constructor(
    @Inject(SUPPORT_INBOUND_ADAPTER) adapter: SupportInboundAdapter | null,
    @Inject(SUPPORT_INBOUND_DOMAIN) domain: string | null,
    @Inject(PostgresSupportInbound) store: PostgresSupportInbound,
    @Inject(EngagementEvidence) evidence: EngagementEvidence,
  ) {
    super(adapter, new AtomicSupportInboundStore(store), evidence, domain);
  }
}
