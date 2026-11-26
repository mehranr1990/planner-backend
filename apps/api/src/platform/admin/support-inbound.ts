import { createHash } from 'node:crypto';

export type InboundAttachment = {
  filename: string;
  mediaType: string;
  content: Uint8Array;
};
/** Produced only by a trusted transport after signature/mailbox verification.
 * A From header, SPF alone, or a caller-supplied boolean is not authentication.
 */
export type VerifiedInboundReply = {
  providerMessageId: string;
  messageId: string;
  senderEmail: string;
  envelopeRecipient: string;
  receivedAt: Date;
  subject: string;
  text: string;
  autoSubmitted: string | null;
  precedence: string | null;
  returnPath: string | null;
  attachments: readonly InboundAttachment[];
};

/** No default provider and no public endpoint accepts a VerifiedInboundReply.
 * Adapters must verify the complete raw body before parsing, timestamp/replay
 * evidence, exact configured recipient/domain and authenticated sender alignment.
 * Mailbox implementations must use authenticated TLS and trusted server evidence.
 */
export abstract class SupportInboundAdapter {
  abstract readonly transportId: string;
  abstract verifyConfiguration(): Promise<boolean>;
  abstract authenticate(raw: unknown): Promise<VerifiedInboundReply>;
}

export type InboundReplyClaim = {
  transportId: string;
  providerMessageHash: string;
  messageHash: string;
  fingerprint: string;
  correlationHash: string;
  senderEmail: string;
  receivedAt: Date;
  now: Date;
  text: string;
};
export type StagedSupportEvidence = { id: string; digest: string };
export type InboundReplyResult = {
  state: 'ACCEPTED' | 'DUPLICATE' | 'REJECTED';
  code: string;
};
/** Ticket owner implements one atomic transaction that:
 * - uniquely claims BOTH transport/message identities, rejecting changed replays;
 * - locks the ticket and its expiring, revocable correlation-token generation;
 * - rechecks the sender's current verified email against the ticket owner;
 * - checks ticket availability and existing account/security/reopen policies;
 * - consumes per-sender AND per-ticket limits (10/10min, 100/day defaults);
 * - writes a PUBLIC reply, typed evidence references, receipt and audit together.
 * An accepted inbound reply never queues an automatic email acknowledgement.
 * Duplicate requests return the original result without another reply or limit.
 */
export abstract class SupportInboundStore {
  abstract apply(
    claim: InboundReplyClaim,
    evidence: readonly StagedSupportEvidence[],
  ): Promise<InboundReplyResult>;
  abstract auditRejected(input: {
    transportId: string;
    messageHash: string | null;
    code: string;
  }): Promise<void>;
}
/** Storage owner must inspect actual bytes/type, scan with the existing malware
 * scanner, enforce private storage quotas, randomize keys and stage only the
 * current inbound ticket's evidence. No URL fetching or arbitrary file linking.
 */
export abstract class SupportInboundEvidence {
  abstract stage(
    attachments: readonly InboundAttachment[],
  ): Promise<readonly StagedSupportEvidence[]>;
  /** Removes only unreferenced staged objects. Safe after commit or rollback. */
  abstract cleanup(staged: readonly StagedSupportEvidence[]): Promise<void>;
}

export const inboundSupportLimits = {
  maxAgeMs: 15 * 60_000,
  maxFutureMs: 60_000,
  maxText: 20000,
  maxAttachments: 5,
  maxAttachmentBytes: 5 * 1024 * 1024,
  maxTotalAttachmentBytes: 10 * 1024 * 1024,
} as const;
const digest = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');
const safeId = (id: string) =>
  id.length >= 1 && id.length <= 998 && !/[\r\n\0]/.test(id);
const email = (value: string) => {
  if (value.length > 254 || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value))
    throw new Error('INVALID_INBOUND_SENDER');
  // Provider authentication must already have aligned the full sender address.
  // Preserve local-part spelling; ticket identity owner canonicalizes it.
  const at = value.lastIndexOf('@');
  return value.slice(0, at) + '@' + value.slice(at + 1).toLowerCase();
};

export function validateInboundAttachments(
  attachments: readonly InboundAttachment[],
): void {
  if (attachments.length > inboundSupportLimits.maxAttachments)
    throw new Error('INBOUND_ATTACHMENT_LIMIT');
  let total = 0;
  const names = new Set<string>();
  for (const attachment of attachments) {
    const name = attachment.filename.normalize('NFC');
    if (
      !name ||
      name.length > 200 ||
      /[\x00-\x1f\x7f/\\:]/.test(name) ||
      name === '.' ||
      name === '..' ||
      names.has(name.toLowerCase())
    )
      throw new Error('INVALID_INBOUND_FILENAME');
    names.add(name.toLowerCase());
    if (
      !['text/plain', 'image/png', 'image/jpeg', 'application/pdf'].includes(
        attachment.mediaType,
      )
    )
      throw new Error('INVALID_INBOUND_MEDIA');
    const size = attachment.content.byteLength;
    total += size;
    if (
      !size ||
      size > inboundSupportLimits.maxAttachmentBytes ||
      total > inboundSupportLimits.maxTotalAttachmentBytes
    )
      throw new Error('INBOUND_ATTACHMENT_LIMIT');
  }
}

/** Remains disabled when no adapter is supplied. Transport verification is a
 * prerequisite for each receive; a failed health/identity check closes access.
 * Failures never bounce to an untrusted sender or expose ticket existence.
 */
export class SupportInboundProcessor {
  constructor(
    private readonly adapter: SupportInboundAdapter | null,
    private readonly store: SupportInboundStore,
    private readonly evidence: SupportInboundEvidence,
    private readonly recipientDomain: string | null,
  ) {}
  async receive(raw: unknown, now = new Date()): Promise<InboundReplyResult> {
    if (
      !this.adapter ||
      !this.recipientDomain ||
      !(await this.adapter.verifyConfiguration())
    )
      return { state: 'REJECTED', code: 'INBOUND_DISABLED' };
    let staged: readonly StagedSupportEvidence[] = [];
    let messageHash: string | null = null;
    try {
      const reply = await this.adapter.authenticate(raw);
      if (!safeId(reply.providerMessageId) || !safeId(reply.messageId))
        throw new Error('INVALID_INBOUND_ID');
      messageHash = digest(
        email(reply.senderEmail).toLowerCase() + ':' + reply.messageId,
      );
      if (
        !Number.isFinite(reply.receivedAt.getTime()) ||
        !Number.isFinite(now.getTime()) ||
        now.getTime() - reply.receivedAt.getTime() >
          inboundSupportLimits.maxAgeMs ||
        reply.receivedAt.getTime() - now.getTime() >
          inboundSupportLimits.maxFutureMs
      )
        throw new Error('INBOUND_TIMESTAMP_REJECTED');
      if (
        (reply.autoSubmitted &&
          reply.autoSubmitted.trim().toLowerCase() !== 'no') ||
        (reply.precedence && /^(bulk|junk|list)$/i.test(reply.precedence)) ||
        reply.returnPath === null ||
        reply.returnPath.trim() === '<>' ||
        reply.returnPath === ''
      )
        throw new Error('INBOUND_AUTOMATIC_REJECTED');
      const recipient = reply.envelopeRecipient.match(
        /^support\+([A-Za-z0-9_-]{43})@([^@]+)$/,
      );
      if (
        !recipient ||
        recipient[2]!.toLowerCase() !== this.recipientDomain.toLowerCase() ||
        Buffer.from(recipient[1]!, 'base64url').length !== 32 ||
        Buffer.from(recipient[1]!, 'base64url').toString('base64url') !==
          recipient[1]
      )
        throw new Error('INBOUND_CORRELATION_REJECTED');
      const text = reply.text.trim();
      if (
        !text ||
        text.length > inboundSupportLimits.maxText ||
        text.includes('\0')
      )
        throw new Error('INVALID_INBOUND_TEXT');
      validateInboundAttachments(reply.attachments);
      const senderEmail = email(reply.senderEmail);
      const claim: InboundReplyClaim = {
        transportId: this.adapter.transportId,
        providerMessageHash: digest(reply.providerMessageId),
        messageHash,
        correlationHash: digest(recipient[1]!),
        senderEmail,
        receivedAt: reply.receivedAt,
        now,
        text,
        fingerprint: digest(
          JSON.stringify({
            senderEmail,
            recipient: reply.envelopeRecipient,
            text,
            attachments: reply.attachments.map((a) => ({
              name: a.filename,
              type: a.mediaType,
              digest: digest(a.content),
            })),
          }),
        ),
      };
      staged = await this.evidence.stage(reply.attachments);
      return await this.store.apply(claim, staged);
    } catch (error) {
      const allowed = new Set([
        'INVALID_INBOUND_ID',
        'INBOUND_TIMESTAMP_REJECTED',
        'INBOUND_AUTOMATIC_REJECTED',
        'INBOUND_CORRELATION_REJECTED',
        'INVALID_INBOUND_TEXT',
        'INVALID_INBOUND_SENDER',
        'INBOUND_ATTACHMENT_LIMIT',
        'INVALID_INBOUND_FILENAME',
        'INVALID_INBOUND_MEDIA',
      ]);
      const code =
        error instanceof Error && allowed.has(error.message)
          ? error.message
          : 'INBOUND_VERIFICATION_FAILED';
      await this.store.auditRejected({
        transportId: this.adapter.transportId,
        messageHash,
        code,
      });
      return { state: 'REJECTED', code };
    } finally {
      if (staged.length) await this.evidence.cleanup(staged);
    }
  }
}
