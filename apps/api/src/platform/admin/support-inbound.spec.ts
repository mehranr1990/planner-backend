import { expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  SupportInboundProcessor,
  type SupportInboundAdapter,
  type SupportInboundStore,
  type SupportInboundEvidence,
  type VerifiedInboundReply,
  type InboundReplyClaim,
} from './support-inbound.js';

const now = new Date('2026-11-25T12:00:00Z');
function fixture() {
  const reply: VerifiedInboundReply = {
    providerMessageId: 'provider-1',
    messageId: '<message-1@example.test>',
    senderEmail: 'owner@example.test',
    envelopeRecipient:
      'support+' +
      randomBytes(32).toString('base64url') +
      '@inbound.example.test',
    receivedAt: now,
    subject: 'Reply',
    text: 'User-supplied evidence',
    autoSubmitted: 'no',
    precedence: null,
    returnPath: 'owner@example.test',
    attachments: [],
  };
  const audits: string[] = [],
    claims: InboundReplyClaim[] = [];
  let configured = true,
    staged = 0,
    cleaned = 0,
    authenticated = true;
  const adapter: SupportInboundAdapter = {
    transportId: 'verified-fixture',
    verifyConfiguration: async () => configured,
    authenticate: async () => {
      if (!authenticated) throw new Error('secret-provider-error');
      return reply;
    },
  };
  const store: SupportInboundStore = {
    apply: async (claim) => {
      claims.push(claim);
      return { state: 'ACCEPTED', code: 'REPLY_RECORDED' };
    },
    auditRejected: async (input) => {
      audits.push(input.code);
    },
  };
  const evidence: SupportInboundEvidence = {
    stage: async (attachments) => {
      staged++;
      return attachments.map((_, i) => ({ id: String(i), digest: 'test' }));
    },
    cleanup: async () => {
      cleaned++;
    },
  };
  const processor = new SupportInboundProcessor(
    adapter,
    store,
    evidence,
    'inbound.example.test',
  );
  return {
    reply,
    store,
    evidence,
    processor,
    audits,
    claims,
    adapter,
    configure: (value: boolean) => {
      configured = value;
    },
    authenticate: (value: boolean) => {
      authenticated = value;
    },
    counts: () => ({ staged, cleaned }),
  };
}
it('keeps inbound disabled without a configured verified transport', async () => {
  const f = fixture();
  f.configure(false);
  expect(await f.processor.receive({}, now)).toEqual({
    state: 'REJECTED',
    code: 'INBOUND_DISABLED',
  });
  expect(f.claims).toHaveLength(0);
  expect(
    await new SupportInboundProcessor(null, f.store, f.evidence, null).receive(
      {},
      now,
    ),
  ).toEqual({ state: 'REJECTED', code: 'INBOUND_DISABLED' });
});
it('authenticates raw input before accepting a sender or ticket identity', async () => {
  const f = fixture();
  f.authenticate(false);
  expect(
    await f.processor.receive(
      { senderEmail: 'owner@example.test', trusted: true },
      now,
    ),
  ).toEqual({ state: 'REJECTED', code: 'INBOUND_VERIFICATION_FAILED' });
  expect(f.claims).toHaveLength(0);
  expect(f.audits).toEqual(['INBOUND_VERIFICATION_FAILED']);
});
it('passes hashed correlation and message identities with a stable content fingerprint to the atomic owner', async () => {
  const f = fixture();
  expect((await f.processor.receive({}, now)).state).toBe('ACCEPTED');
  await f.processor.receive({}, now);
  expect(f.claims[0]!.fingerprint).toBe(f.claims[1]!.fingerprint);
  expect(f.claims[0]!.correlationHash).toMatch(/^[a-f0-9]{64}$/);
  expect(f.claims[0]!.messageHash).not.toContain('message-1');
  f.reply.text = 'Changed reply';
  await f.processor.receive({}, now);
  expect(f.claims[2]!.fingerprint).not.toBe(f.claims[0]!.fingerprint);
});
it.each([
  { receivedAt: new Date(now.getTime() - 900001) },
  { receivedAt: new Date(now.getTime() + 60001) },
  { envelopeRecipient: 'support+guess@inbound.example.test' },
  {
    envelopeRecipient:
      'support+' + randomBytes(32).toString('base64url') + '@attacker.test',
  },
  { senderEmail: 'Name <owner@example.test>' },
  { text: '\0' },
  { autoSubmitted: 'auto-replied' },
  { precedence: 'list' },
  { returnPath: '<>' },
])(
  'rejects stale, forged, malformed and automatic replies: %j',
  async (patch) => {
    const f = fixture();
    Object.assign(f.reply, patch);
    expect((await f.processor.receive({}, now)).state).toBe('REJECTED');
    expect(f.claims).toHaveLength(0);
    expect(f.counts().staged).toBe(0);
    expect(f.audits).toHaveLength(1);
  },
);
it('validates untrusted attachment metadata before private scanning/storage', async () => {
  const f = fixture();
  f.reply.attachments = [
    {
      filename: '../secret',
      mediaType: 'text/plain',
      content: new Uint8Array([1]),
    },
  ];
  expect((await f.processor.receive({}, now)).code).toBe(
    'INVALID_INBOUND_FILENAME',
  );
  f.reply.attachments = [
    {
      filename: 'run.exe',
      mediaType: 'application/octet-stream',
      content: new Uint8Array([1]),
    },
  ];
  expect((await f.processor.receive({}, now)).code).toBe(
    'INVALID_INBOUND_MEDIA',
  );
  f.reply.attachments = [
    {
      filename: 'large.txt',
      mediaType: 'text/plain',
      content: new Uint8Array(5 * 1024 * 1024 + 1),
    },
  ];
  expect((await f.processor.receive({}, now)).code).toBe(
    'INBOUND_ATTACHMENT_LIMIT',
  );
  expect(f.counts().staged).toBe(0);
});
it('cleans staged evidence even when the ticket transaction rejects or fails', async () => {
  const f = fixture();
  f.reply.attachments = [
    {
      filename: 'evidence.txt',
      mediaType: 'text/plain',
      content: new Uint8Array([1]),
    },
  ];
  f.store.apply = async () => {
    throw new Error('database-private-detail');
  };
  expect((await f.processor.receive({}, now)).code).toBe(
    'INBOUND_VERIFICATION_FAILED',
  );
  expect(f.counts()).toEqual({ staged: 1, cleaned: 1 });
  expect(f.audits).not.toContain('database-private-detail');
});
