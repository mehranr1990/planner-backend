import { expect, it } from 'vitest';
import {
  AtomicSupportInboundStore,
  type InboundTicket,
  type InboundTicketTransaction,
  type InboundReceipt,
} from './support-inbound-store.js';
import type { InboundReplyClaim } from './support-inbound.js';

function fixture() {
  const now = new Date('2026-11-25T12:00:00Z');
  const claim: InboundReplyClaim = {
    transportId: 'provider',
    providerMessageHash: 'provider-id',
    messageHash: 'message-id',
    fingerprint: 'fingerprint',
    correlationHash: 'token-hash',
    senderEmail: 'owner@example.test',
    receivedAt: now,
    now,
    text: 'Reply',
  };
  let ticket: InboundTicket | null = {
    id: 'ticket',
    ownerUserId: 'owner',
    currentEmail: 'owner@example.test',
    emailVerified: true,
    accountAvailable: true,
    acceptsReply: true,
    correlationExpiresAt: new Date(now.getTime() + 1000),
    correlationRevoked: false,
  };
  let prior: InboundReceipt[] = [],
    limited = false,
    replies = 0,
    rates = 0;
  const audits: string[] = [];
  const tx: InboundTicketTransaction = {
    lockIdentities: async () => {},
    receipts: async () => prior,
    ticketForCorrelation: async () => ticket,
    canonicalEmail: (email) => email.toLowerCase(),
    takeRates: async (keys) => {
      expect(keys).toHaveLength(4);
      rates++;
      return !limited;
    },
    appendPublicReply: async () => {
      replies++;
    },
    receipt: async (_claim, result) => {
      prior = [{ fingerprint: claim.fingerprint, result }];
    },
    audit: async ({ code }) => {
      audits.push(code);
    },
  };
  const store = new AtomicSupportInboundStore({
    transaction: async (work) => work(tx),
    auditRejected: async () => {},
  });
  return {
    store,
    claim,
    tx,
    audits,
    ticket: () => ticket!,
    changeTicket: (patch: Partial<InboundTicket>) => {
      ticket = { ...ticket!, ...patch };
    },
    missing: () => {
      ticket = null;
    },
    limit: () => {
      limited = true;
    },
    counts: () => ({ replies, rates }),
    replay: (value: InboundReceipt[]) => {
      prior = value;
    },
  };
}
it('records one public reply and treats exact replay as duplicate without charging limits twice', async () => {
  const f = fixture();
  expect((await f.store.apply(f.claim, [])).state).toBe('ACCEPTED');
  expect((await f.store.apply(f.claim, [])).state).toBe('DUPLICATE');
  expect(f.counts()).toEqual({ replies: 1, rates: 1 });
  expect(f.audits).toEqual(['INBOUND_REPLY_RECORDED', 'INBOUND_DUPLICATE']);
});
it('rejects a changed replay without creating a second reply', async () => {
  const f = fixture();
  await f.store.apply(f.claim, []);
  expect(
    await f.store.apply({ ...f.claim, fingerprint: 'changed' }, []),
  ).toEqual({ state: 'REJECTED', code: 'INBOUND_REPLY_REJECTED' });
  expect(f.counts()).toEqual({ replies: 1, rates: 1 });
  expect(f.audits.at(-1)).toBe('INBOUND_CHANGED_REPLAY');
});
it.each([
  { currentEmail: 'new@example.test' },
  { emailVerified: false },
  { accountAvailable: false },
  { acceptsReply: false },
  { correlationRevoked: true },
  { correlationExpiresAt: new Date('2026-11-25T12:00:00Z') },
])(
  'rechecks current ticket, owner and correlation before accepting: %j',
  async (patch) => {
    const f = fixture();
    f.changeTicket(patch);
    expect(await f.store.apply(f.claim, [])).toEqual({
      state: 'REJECTED',
      code: 'INBOUND_REPLY_REJECTED',
    });
    expect(f.counts()).toEqual({ replies: 0, rates: 0 });
  },
);
it('does not reveal whether an invalid token or sender identifies a ticket', async () => {
  const a = fixture(),
    b = fixture();
  a.missing();
  b.changeTicket({ currentEmail: 'different@example.test' });
  expect(await a.store.apply(a.claim, [])).toEqual(
    await b.store.apply(b.claim, []),
  );
});
it('enforces sender/ticket limits and retains safe rejected-replay evidence', async () => {
  const f = fixture();
  f.limit();
  expect((await f.store.apply(f.claim, [])).state).toBe('REJECTED');
  expect((await f.store.apply(f.claim, [])).state).toBe('REJECTED');
  expect(f.counts()).toEqual({ replies: 0, rates: 1 });
  expect(f.audits).toEqual(['INBOUND_RATE_LIMITED', 'INBOUND_DUPLICATE']);
});
