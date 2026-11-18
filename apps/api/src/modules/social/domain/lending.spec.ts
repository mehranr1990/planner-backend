import { describe, it, expect } from 'vitest';
import {
  claimAllowed,
  claimTransition,
  dueProposal,
  loanAllowed,
  loanAwaits,
  loanOverdue,
  loanTransition,
} from './lending.js';
import type { ClaimSnapshot, LoanSnapshot } from './lending.js';
const L = 'lender',
  B = 'borrower',
  X = 'outsider',
  now = new Date('2030-01-01T00:00:00Z');
const loan = (o: Partial<LoanSnapshot> = {}): LoanSnapshot => ({
  state: 'REQUESTED',
  origin: 'REQUEST',
  lenderUserId: L,
  borrowerUserId: B,
  dueAt: null,
  lenderHandoverAt: null,
  borrowerReceiptAt: null,
  handedOverAt: null,
  pendingOutcome: null,
  pendingOutcomeByUserId: null,
  stateBeforeDispute: null,
  disputedByUserId: null,
  ...o,
});
const code = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return (e as { code: string }).code;
  }
  return 'OK';
};
describe('P6-04 loan rules', () => {
  it('only the counterparty decides a request or offer', () => {
    expect(loanTransition(loan(), L, 'accept', now)).toEqual({
      state: 'ACCEPTED',
    });
    expect(code(() => loanTransition(loan(), B, 'accept', now))).toBe(
      'LOAN_COUNTERPARTY_REQUIRED',
    );
    const offer = loan({ state: 'OFFERED', origin: 'OFFER' });
    expect(code(() => loanTransition(offer, L, 'accept', now))).toBe(
      'LOAN_COUNTERPARTY_REQUIRED',
    );
    expect(loanTransition(offer, B, 'accept', now).state).toBe('ACCEPTED');
    expect(code(() => loanTransition(loan(), X, 'accept', now))).toBe(
      'LOAN_COUNTERPARTY_REQUIRED',
    );
  });
  it("never confirms custody on the lender's statement alone", () => {
    const stated = loan({ state: 'ACCEPTED', lenderHandoverAt: now });
    expect(code(() => loanTransition(stated, L, 'handover', now))).toBe(
      'ALREADY_RECORDED',
    );
    expect(code(() => loanTransition(stated, L, 'receive', now))).toBe(
      'LOAN_COUNTERPARTY_REQUIRED',
    );
    expect(
      loanTransition(loan({ state: 'ACCEPTED' }), L, 'handover', now),
    ).toEqual({ lenderHandoverAt: now });
    expect(loanTransition(stated, B, 'receive', now)).toEqual({
      borrowerReceiptAt: now,
      state: 'HANDED_OVER',
      handedOverAt: now,
    });
  });
  it('lost/damaged outcomes need the other party; disputes need a note', () => {
    const held = loan({ state: 'HANDED_OVER', handedOverAt: now });
    const proposed = {
      ...held,
      ...loanTransition(held, L, 'report-lost', now),
    };
    expect(code(() => loanTransition(proposed, L, 'accept-outcome', now))).toBe(
      'LOAN_COUNTERPARTY_REQUIRED',
    );
    expect(loanTransition(proposed, B, 'accept-outcome', now).state).toBe(
      'LOST',
    );
    expect(code(() => loanTransition(held, B, 'dispute', now, ' '))).toBe(
      'DISPUTE_NOTE_REQUIRED',
    );
    const disputed = {
      ...held,
      ...loanTransition(held, B, 'dispute', now, 'not mine'),
    };
    expect(disputed).toMatchObject({
      state: 'DISPUTED',
      stateBeforeDispute: 'HANDED_OVER',
    });
    expect(code(() => loanTransition(disputed, L, 'resume', now))).toBe(
      'LOAN_COUNTERPARTY_REQUIRED',
    );
    expect(loanTransition(disputed, B, 'resume', now).state).toBe(
      'HANDED_OVER',
    );
    expect(loanTransition(disputed, L, 'confirm-return', now).state).toBe(
      'RETURNED',
    );
    expect(code(() => loanTransition(disputed, B, 'confirm-return', now))).toBe(
      'LOAN_COUNTERPARTY_REQUIRED',
    );
  });
  it('an erased counterparty leaves only the release by the lender', () => {
    const orphan = loan({
      state: 'HANDED_OVER',
      handedOverAt: now,
      borrowerUserId: null,
    });
    expect(loanAllowed(orphan, L, now)).toEqual(['confirm-return']);
    const gone = loan({
      state: 'HANDED_OVER',
      handedOverAt: now,
      lenderUserId: null,
    });
    expect(loanAllowed(gone, B, now)).toEqual([]);
  });
  it('derives overdue only while in custody and flags awaited actions', () => {
    const due = new Date(now.getTime() - 1);
    expect(loanOverdue(loan({ state: 'ACCEPTED', dueAt: due }), now)).toBe(
      false,
    );
    expect(
      loanOverdue(
        loan({ state: 'RETURN_REQUESTED', dueAt: due, handedOverAt: due }),
        now,
      ),
    ).toBe(true);
    expect(loanAwaits(loan(), L)).toBe(true);
    expect(loanAwaits(loan(), B)).toBe(false);
    expect(
      loanAwaits(loan({ state: 'ACCEPTED', lenderHandoverAt: now }), B),
    ).toBe(true);
  });
});
describe('P6-04 Lost & Found claim rules', () => {
  const claim = (o: Partial<ClaimSnapshot> = {}): ClaimSnapshot => ({
    state: 'PENDING',
    claimantUserId: B,
    handoverAt: null,
    receiptAt: null,
    disputedByUserId: null,
    ...o,
  });
  const lost = { kind: 'LOST', reporterUserId: L, state: 'OPEN' },
    found = { kind: 'FOUND', reporterUserId: L, state: 'OPEN' };
  it('acknowledgement is the reporter’s and resolution needs both parties', () => {
    expect(
      code(() => claimTransition(lost, claim(), B, 'acknowledge', now)),
    ).toBe('CLAIM_PARTY_REQUIRED');
    const ack = claim({ state: 'ACKNOWLEDGED' });
    // LOST report: the finder (claimant) hands over; the reporter receives.
    expect(code(() => claimTransition(lost, ack, L, 'handover', now))).toBe(
      'CLAIM_PARTY_REQUIRED',
    );
    const handed = {
      ...ack,
      ...claimTransition(lost, ack, B, 'handover', now),
    };
    expect(handed.state).toBe('ACKNOWLEDGED');
    expect(claimTransition(lost, handed, L, 'receive', now).state).toBe(
      'RESOLVED',
    );
    // FOUND report: the reporter holds the item.
    expect(claimAllowed(found, ack, L, now)).toContain('handover');
    expect(claimAllowed(found, ack, B, now)).toContain('receive');
  });
  it('rejects outsiders and erased counterparties', () => {
    expect(code(() => claimTransition(lost, claim(), X, 'withdraw', now))).toBe(
      'CLAIM_PARTY_REQUIRED',
    );
    const orphan = claim({ state: 'ACKNOWLEDGED', claimantUserId: null });
    expect(claimAllowed(lost, orphan, L, now)).toEqual(['reject']);
  });
});
describe('P6-04 due-date amendments', () => {
  const held = (o: Partial<LoanSnapshot> = {}): LoanSnapshot => ({
    state: 'HANDED_OVER',
    origin: 'REQUEST',
    lenderUserId: L,
    borrowerUserId: B,
    dueAt: new Date('2030-02-01T00:00:00Z'),
    lenderHandoverAt: now,
    borrowerReceiptAt: now,
    handedOverAt: now,
    pendingOutcome: null,
    pendingOutcomeByUserId: null,
    stateBeforeDispute: null,
    disputedByUserId: null,
    ...o,
  });
  const later = new Date('2030-03-01T00:00:00Z');
  it('a proposal never changes the agreed due date until the other party accepts', () => {
    const p = dueProposal(held(), B, later, now);
    expect(p).toEqual({
      proposedDueAt: later,
      dueProposedByUserId: B,
      dueProposedAt: now,
    });
    expect(p).not.toHaveProperty('dueAt');
    const pending = held(p);
    expect(code(() => loanTransition(pending, B, 'accept-due', now))).toBe(
      'LOAN_COUNTERPARTY_REQUIRED',
    );
    expect(loanTransition(pending, L, 'accept-due', now)).toMatchObject({
      dueAt: later,
      proposedDueAt: null,
    });
    expect(loanTransition(pending, L, 'decline-due', now)).not.toHaveProperty(
      'dueAt',
    );
    expect(code(() => loanTransition(pending, L, 'withdraw-due', now))).toBe(
      'LOAN_COUNTERPARTY_REQUIRED',
    );
    expect(loanAwaits(pending, L)).toBe(true);
  });
  it('rejects concurrent, past, unchanged, outsider and closed-state proposals', () => {
    const pending = held(dueProposal(held(), B, later, now));
    expect(code(() => dueProposal(pending, L, later, now))).toBe(
      'DUE_CHANGE_PENDING',
    );
    expect(
      code(() => dueProposal(held(), L, new Date(now.getTime() - 1), now)),
    ).toBe('DUE_IN_PAST');
    expect(code(() => dueProposal(held(), L, held().dueAt!, now))).toBe(
      'DUE_UNCHANGED',
    );
    expect(code(() => dueProposal(held(), X, later, now))).toBe(
      'LOAN_COUNTERPARTY_REQUIRED',
    );
    expect(
      code(() => dueProposal(held({ state: 'RETURNED' }), L, later, now)),
    ).toBe('LOAN_STATE_CONFLICT');
    expect(code(() => loanTransition(held(), L, 'accept-due', now))).toBe(
      'NO_DUE_PROPOSAL',
    );
    const expired = held({
      proposedDueAt: new Date(now.getTime() - 1),
      dueProposedByUserId: B,
    });
    expect(code(() => loanTransition(expired, L, 'accept-due', now))).toBe(
      'DUE_IN_PAST',
    );
  });
});
