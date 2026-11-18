/**
 * P6-04 lending and Lost & Found state rules. Pure functions: callers hold the
 * row lock, check revisions and persist the returned patch. Custody becomes
 * confirmed only when the lender's handover and the borrower's receipt are both
 * recorded; a lender's statement alone never establishes it.
 */
export class LendingRuleError extends Error {
  constructor(
    readonly code: string,
    readonly status: 403 | 409 | 422,
  ) {
    super(code);
  }
}
export const LOAN_ACTIONS = [
  'accept',
  'reject',
  'cancel',
  'handover',
  'receive',
  'return',
  'confirm-return',
  'report-lost',
  'report-damaged',
  'accept-outcome',
  'dispute',
  'resume',
  'accept-due',
  'decline-due',
  'withdraw-due',
] as const;
export type LoanAction = (typeof LOAN_ACTIONS)[number];
/** States that hold the asset: agreed or in custody. Matches the partial unique index. */
export const OPEN_LOAN_STATES = [
  'ACCEPTED',
  'HANDED_OVER',
  'RETURN_REQUESTED',
  'DISPUTED',
];
export type LoanSnapshot = {
  state: string;
  origin: string;
  lenderUserId: string | null;
  borrowerUserId: string | null;
  dueAt: Date | null;
  lenderHandoverAt: Date | null;
  borrowerReceiptAt: Date | null;
  handedOverAt: Date | null;
  pendingOutcome: string | null;
  pendingOutcomeByUserId: string | null;
  stateBeforeDispute: string | null;
  disputedByUserId: string | null;
  proposedDueAt?: Date | null;
  dueProposedByUserId?: string | null;
};
export type LoanPatch = {
  state?: string;
  lenderHandoverAt?: Date;
  borrowerReceiptAt?: Date;
  handedOverAt?: Date;
  returnRequestedAt?: Date;
  returnedAt?: Date;
  closedAt?: Date;
  pendingOutcome?: string | null;
  pendingOutcomeByUserId?: string | null;
  stateBeforeDispute?: string | null;
  disputedByUserId?: string | null;
  disputeNote?: string | null;
  dueAt?: Date | null;
  proposedDueAt?: Date | null;
  dueProposedByUserId?: string | null;
  dueProposedAt?: Date | null;
};
/** States in which the parties may agree a new due date. */
export const DUE_STATES = ['ACCEPTED', 'HANDED_OVER', 'RETURN_REQUESTED'];
const clearDue = {
  proposedDueAt: null,
  dueProposedByUserId: null,
  dueProposedAt: null,
};
const conflict = (code = 'LOAN_STATE_CONFLICT') =>
  new LendingRuleError(code, 409);
const party = () => new LendingRuleError('LOAN_COUNTERPARTY_REQUIRED', 403);
const clearDispute = {
  stateBeforeDispute: null,
  disputedByUserId: null,
  disputeNote: null,
};
const clearOutcome = { pendingOutcome: null, pendingOutcomeByUserId: null };
export function inCustody(
  l: Pick<LoanSnapshot, 'state' | 'stateBeforeDispute'>,
) {
  return (
    l.state === 'HANDED_OVER' ||
    l.state === 'RETURN_REQUESTED' ||
    (l.state === 'DISPUTED' && l.stateBeforeDispute !== 'ACCEPTED')
  );
}
export function loanOverdue(l: LoanSnapshot, now: Date) {
  return !!l.dueAt && l.dueAt <= now && inCustody(l);
}
export function loanTransition(
  l: LoanSnapshot,
  userId: string,
  action: LoanAction,
  now: Date,
  note?: string | null,
): LoanPatch {
  const role =
    userId === l.lenderUserId
      ? 'LENDER'
      : userId === l.borrowerUserId
        ? 'BORROWER'
        : null;
  if (!role) throw party();
  const counterpart = role === 'LENDER' ? l.borrowerUserId : l.lenderUserId;
  // An erased counterparty cannot acknowledge anything; only the lender may
  // still confirm the item is back (it only releases the absent borrower).
  if (
    !counterpart &&
    !(action === 'confirm-return' && role === 'LENDER') &&
    action !== 'cancel'
  )
    throw conflict('COUNTERPARTY_ERASED');
  switch (action) {
    case 'accept':
    case 'reject': {
      const decider =
        l.state === 'REQUESTED'
          ? 'LENDER'
          : l.state === 'OFFERED'
            ? 'BORROWER'
            : null;
      if (!decider) throw conflict();
      if (decider !== role) throw party();
      return action === 'accept'
        ? { state: 'ACCEPTED' }
        : { state: 'REJECTED', closedAt: now, ...clearDue };
    }
    case 'cancel': {
      const initiator = l.state === 'REQUESTED' ? 'BORROWER' : 'LENDER';
      if (l.state === 'REQUESTED' || l.state === 'OFFERED') {
        if (role !== initiator) throw party();
      } else if (l.state !== 'ACCEPTED' || l.borrowerReceiptAt)
        throw conflict();
      return { state: 'CANCELED', closedAt: now, ...clearDue };
    }
    case 'handover':
    case 'receive': {
      const own = action === 'handover' ? 'LENDER' : 'BORROWER';
      if (l.state !== 'ACCEPTED') throw conflict();
      if (role !== own) throw party();
      if (action === 'handover' ? l.lenderHandoverAt : l.borrowerReceiptAt)
        throw conflict('ALREADY_RECORDED');
      const other =
        action === 'handover' ? l.borrowerReceiptAt : l.lenderHandoverAt;
      return {
        ...(action === 'handover'
          ? { lenderHandoverAt: now }
          : { borrowerReceiptAt: now }),
        ...(other ? { state: 'HANDED_OVER', handedOverAt: now } : {}),
      };
    }
    case 'return':
      if (l.state !== 'HANDED_OVER') throw conflict();
      if (role !== 'BORROWER') throw party();
      return { state: 'RETURN_REQUESTED', returnRequestedAt: now };
    case 'confirm-return':
      if (!inCustody(l)) throw conflict();
      if (role !== 'LENDER') throw party();
      return {
        state: 'RETURNED',
        returnedAt: now,
        closedAt: now,
        ...clearOutcome,
        ...clearDispute,
        ...clearDue,
      };
    case 'report-lost':
    case 'report-damaged':
      if (!inCustody(l) || l.pendingOutcome)
        throw conflict(l.pendingOutcome ? 'OUTCOME_PENDING' : undefined);
      return {
        pendingOutcome: action === 'report-lost' ? 'LOST' : 'DAMAGED',
        pendingOutcomeByUserId: userId,
      };
    case 'accept-outcome':
      if (!l.pendingOutcome || !inCustody(l)) throw conflict();
      if (l.pendingOutcomeByUserId === userId) throw party();
      return {
        state: l.pendingOutcome,
        closedAt: now,
        ...(l.pendingOutcome === 'DAMAGED' ? { returnedAt: now } : {}),
        ...clearOutcome,
        ...clearDispute,
        ...clearDue,
      };
    case 'dispute':
      if (!['ACCEPTED', 'HANDED_OVER', 'RETURN_REQUESTED'].includes(l.state))
        throw conflict();
      if (!note?.trim())
        throw new LendingRuleError('DISPUTE_NOTE_REQUIRED', 422);
      return {
        state: 'DISPUTED',
        stateBeforeDispute: l.state,
        disputedByUserId: userId,
        disputeNote: note.trim(),
        ...clearOutcome,
      };
    case 'resume':
      if (l.state !== 'DISPUTED') throw conflict();
      if (l.disputedByUserId !== userId) throw party();
      return { state: l.stateBeforeDispute!, ...clearDispute };
    case 'accept-due':
    case 'decline-due':
    case 'withdraw-due':
      if (!l.proposedDueAt) throw conflict('NO_DUE_PROPOSAL');
      if (
        action === 'withdraw-due'
          ? l.dueProposedByUserId !== userId
          : l.dueProposedByUserId === userId
      )
        throw party();
      if (action !== 'accept-due') return { ...clearDue };
      if (!DUE_STATES.includes(l.state)) throw conflict();
      if (l.proposedDueAt <= now) throw conflict('DUE_IN_PAST');
      return { dueAt: l.proposedDueAt, ...clearDue };
  }
}
/**
 * A due-date change is a proposal: the agreed `dueAt` stays authoritative until
 * the other party accepts. One proposal at a time; the proposer may withdraw it.
 */
export function dueProposal(
  l: LoanSnapshot,
  userId: string,
  dueAt: Date,
  now: Date,
): LoanPatch {
  if (userId !== l.lenderUserId && userId !== l.borrowerUserId) throw party();
  if (!l.lenderUserId || !l.borrowerUserId)
    throw conflict('COUNTERPARTY_ERASED');
  if (!DUE_STATES.includes(l.state)) throw conflict();
  if (l.proposedDueAt) throw conflict('DUE_CHANGE_PENDING');
  if (dueAt <= now) throw new LendingRuleError('DUE_IN_PAST', 422);
  if (l.dueAt && l.dueAt.getTime() === dueAt.getTime())
    throw conflict('DUE_UNCHANGED');
  return {
    proposedDueAt: dueAt,
    dueProposedByUserId: userId,
    dueProposedAt: now,
  };
}
export function loanAllowed(l: LoanSnapshot, userId: string, now: Date) {
  return LOAN_ACTIONS.filter((a) => {
    try {
      loanTransition(l, userId, a, now, 'x');
      return true;
    } catch {
      return false;
    }
  });
}
/** The loan waits for this user's acknowledgement or decision. */
export function loanAwaits(l: LoanSnapshot, userId: string) {
  const lender = l.lenderUserId === userId,
    borrower = l.borrowerUserId === userId;
  return (
    (l.state === 'REQUESTED' && lender) ||
    (l.state === 'OFFERED' && borrower) ||
    (l.state === 'ACCEPTED' &&
      ((lender && !l.lenderHandoverAt) ||
        (borrower && !l.borrowerReceiptAt))) ||
    (l.state === 'RETURN_REQUESTED' && lender) ||
    (!!l.pendingOutcome &&
      (lender || borrower) &&
      l.pendingOutcomeByUserId !== userId) ||
    (!!l.proposedDueAt &&
      (lender || borrower) &&
      l.dueProposedByUserId !== userId)
  );
}

// Lost & Found ------------------------------------------------------------------
export const CLAIM_ACTIONS = [
  'acknowledge',
  'reject',
  'withdraw',
  'handover',
  'receive',
  'dispute',
  'resume',
] as const;
export type ClaimAction = (typeof CLAIM_ACTIONS)[number];
export const LIVE_CLAIM_STATES = ['PENDING', 'ACKNOWLEDGED', 'DISPUTED'];
export type ClaimSnapshot = {
  state: string;
  claimantUserId: string | null;
  handoverAt: Date | null;
  receiptAt: Date | null;
  disputedByUserId: string | null;
};
export type ClaimPatch = {
  state?: string;
  handoverAt?: Date;
  receiptAt?: Date;
  resolvedAt?: Date;
  stateBeforeDispute?: string | null;
  disputedByUserId?: string | null;
  disputeNote?: string | null;
};
/**
 * The holder hands over and the other party confirms receipt; both are needed
 * to resolve. For a LOST report the claimant (finder) holds the item, for a
 * FOUND report the reporter does. Resolution never verifies legal ownership.
 */
export function claimTransition(
  report: { kind: string; reporterUserId: string | null; state: string },
  c: ClaimSnapshot,
  userId: string,
  action: ClaimAction,
  now: Date,
  note?: string | null,
): ClaimPatch {
  const role =
    userId === report.reporterUserId
      ? 'REPORTER'
      : userId === c.claimantUserId
        ? 'CLAIMANT'
        : null;
  if (!role) throw new LendingRuleError('CLAIM_PARTY_REQUIRED', 403);
  const counterpart =
    role === 'REPORTER' ? c.claimantUserId : report.reporterUserId;
  if (!counterpart && action !== 'withdraw' && action !== 'reject')
    throw conflict('COUNTERPARTY_ERASED');
  const holder = report.kind === 'LOST' ? 'CLAIMANT' : 'REPORTER';
  const only = (r: string) => {
    if (role !== r) throw new LendingRuleError('CLAIM_PARTY_REQUIRED', 403);
  };
  const states = (...s: string[]) => {
    if (!s.includes(c.state)) throw conflict('CLAIM_STATE_CONFLICT');
  };
  switch (action) {
    case 'acknowledge':
      states('PENDING');
      only('REPORTER');
      if (!['OPEN', 'HIDDEN'].includes(report.state))
        throw conflict('REPORT_CLOSED');
      return { state: 'ACKNOWLEDGED' };
    case 'reject':
      states('PENDING', 'ACKNOWLEDGED');
      only('REPORTER');
      return { state: 'REJECTED' };
    case 'withdraw':
      states('PENDING', 'ACKNOWLEDGED', 'DISPUTED');
      only('CLAIMANT');
      return { state: 'WITHDRAWN', stateBeforeDispute: null };
    case 'handover':
    case 'receive': {
      states('ACKNOWLEDGED');
      const giver = holder,
        taker = holder === 'CLAIMANT' ? 'REPORTER' : 'CLAIMANT';
      only(action === 'handover' ? giver : taker);
      if (action === 'handover' ? c.handoverAt : c.receiptAt)
        throw conflict('ALREADY_RECORDED');
      const other = action === 'handover' ? c.receiptAt : c.handoverAt;
      return {
        ...(action === 'handover' ? { handoverAt: now } : { receiptAt: now }),
        ...(other ? { state: 'RESOLVED', resolvedAt: now } : {}),
      };
    }
    case 'dispute':
      states('ACKNOWLEDGED');
      if (!note?.trim())
        throw new LendingRuleError('DISPUTE_NOTE_REQUIRED', 422);
      return {
        state: 'DISPUTED',
        stateBeforeDispute: 'ACKNOWLEDGED',
        disputedByUserId: userId,
        disputeNote: note.trim(),
      };
    case 'resume':
      states('DISPUTED');
      if (c.disputedByUserId !== userId)
        throw new LendingRuleError('CLAIM_PARTY_REQUIRED', 403);
      return {
        state: 'ACKNOWLEDGED',
        stateBeforeDispute: null,
        disputedByUserId: null,
        disputeNote: null,
      };
  }
}
export function claimAllowed(
  report: { kind: string; reporterUserId: string | null; state: string },
  c: ClaimSnapshot,
  userId: string,
  now: Date,
) {
  return CLAIM_ACTIONS.filter((a) => {
    try {
      claimTransition(report, c, userId, a, now, 'x');
      return true;
    } catch {
      return false;
    }
  });
}
