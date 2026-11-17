# 0061: Explicit Social-to-Personal-Finance posting

Status: **APPROVED product policy** (ADR 0060 decision C, 2026-11-18);
engineering design **implemented and verified locally**. Companion to ADR 0060.

## Boundary

Finance owns the posting. Social calls the Finance public port
`ExternalExpensePosting` (`modules/finance/public/external-posting.ts`), implemented
by Finance's `ExternalPostingService`, which reuses `LedgerService.postInside`,
Finance account/category/currency validation, Finance idempotency receipts and
Finance audit/outbox. No second ledger exists and Social never writes Finance rows.

## Behavior

- Scope: the caller's **own share** of an expense's **current effective approved
  revision**, in the caller's **own** Personal space (`authorizePersonal`). No
  other user, organizer or approver can post into someone else's Finance.
- Two steps: `…/finance-posting/preview` (no write) shows amount, currency,
  source expense/revision, Finance posting date and transaction type `EXPENSE`;
  `…/finance-posting` requires `confirm: true` and the previewed `revisionId`
  (`409 EXPENSE_CHANGED_REVIEW` otherwise).
- The user selects an account (must match the share currency:
  `422 CURRENCY_MISMATCH`, archived: `ACCOUNT_ARCHIVED`) and an optional `EXPENSE`
  category (`CATEGORY_INVALID`).
- Posting date: Finance's "today" in the user's Finance time zone (Finance rejects
  future and inconsistent dates). The expense date is kept in the note.
- One posting per expense per user: the Finance-owned `FinanceExternalPosting`
  row (`spaceId, sourceKind, sourceRef`) is the durable proof; repeats return
  `created: false` with the original transaction. The Finance idempotency key is
  derived server-side from the source.
- Approvals never post. Later revisions never reverse or rewrite a posting; the
  preview reports `alreadyPosted` with the revision that was posted, and the user
  corrects Personal Finance through Finance's own reversal/correction operations.

## Not implemented (needs approval)

Settlement posting. A recorded or confirmed settlement is a person-to-person
transfer, not consumption. Personal Finance has no receivable/payable or external
counterparty transfer contract, and posting it alongside a posted share would
count the same economic event twice. A Finance-owned contract must define it first.
