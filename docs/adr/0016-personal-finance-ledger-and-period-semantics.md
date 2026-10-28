# 0016: Personal finance ledger, corrections, periods and draft conversion

Status: APPROVED by owner, 2026-10-28, for P1-09 implementation.

## Context

P1-09 requires Transaction plus signed TransactionPosting, exact money,
recorded-rate FX, budgets, recurring previews, bills, savings, private export and
retained expense conversion. It leaves precision, correction/reporting treatment,
calendar periods and recurring identity undefined. PROJECT_INSTRUCTIONS.md
sections 1.6 and 9 and the P1-09 instruction require an explicit decision.

## Approved bounded decision

### Money and account integrity

- Use only the nine registered Finance entities: FinancialAccount, Transaction,
  TransactionPosting, FinanceCategory, Budget, BudgetPeriod, Bill, SavingsGoal and
  ExchangeRateSnapshot. Finance owns all ledger writes. No general accounting
  chart, banking integration, automatic FX, worker or new dependency.
- Currency is an ISO-4217 currency supported by the pinned Node 24 Intl currency
  data. Freeze the supported code/minor-unit map in the contract package rather
  than silently changing it on a runtime update. Crypto and arbitrary codes are
  rejected. Persist currency and its validated scale (0-4) with each account.
  Amount inputs are positive plain decimal strings, at most 18 integral digits
  and the currency's minor-unit precision; zero is allowed only for derived
  balances/totals and omitted opening balances. No exponent notation, implicit
  extra-decimal rounding, NaN, number inputs or binary-float money arithmetic.
- Persist Decimal(28,4) monetary amounts; use BigInt scaled units for pure money
  operations and exact rational FX multiplication. Return canonical fixed-scale
  decimal strings. Rates have at most 12 fractional digits, are positive, and are
  persisted as Decimal(30,12). Only derived FX destination amounts use HALF_UP to
  destination minor units; supplied destination amount must equal that result.
  Persist source/destination currencies, rate, conversion date and rounding policy
  in ExchangeRateSnapshot. No cross-currency grand total without explicit recorded
  conversion; default reports group by currency.
- Account currency is immutable. Opening balance is an optional explicit signed
  ADJUSTMENT transaction (positive amount plus IN/OUT direction); no mutable balance
  column. Current balance is SUM of every signed posting, including reversals.
  Accounts can be archived; retained rows/transactions stay readable. Reject new
  postings to archived accounts. Corrections/reversals of existing transactions
  remain possible against archived accounts to preserve history. Negative balances
  are valid for manual tracking; overspending is advisory, not a posting block.
- Categories are flat, ordered, revisioned INCOME/EXPENSE classifications with
  archive/restore. New assignments require an active same-space matching category;
  historical postings retain references after category changes/archive. No invented
  category hierarchy or shared categories.

### Transactions, transfers, corrections and time

- An immutable posted Transaction owns signed postings. INCOME credits one account;
  EXPENSE debits one; ADJUSTMENT has explicit IN/OUT direction; TRANSFER debits a
  source and credits a distinct destination atomically. Same-currency legs equal;
  cross-currency requires the explicit snapshot above. An optional fee debits the
  source account in source currency, with an optional EXPENSE category. It is a
  separate FEE posting within the same transfer, included as expense in reports
  and budgets. Principal transfer legs and adjustments are excluded from ordinary
  income/expense totals. No silent fee deduction from the requested principal.
- Stable transaction ID, revision and immutable source payload. Reverse once with
  If-Match plus Idempotency-Key by appending a REVERSAL Transaction and exactly
  negated postings; link reversal to original, never overwrite postings. Original
  revision/state changes to REVERSED. Correction appends reversal plus a fully
  validated replacement Transaction atomically and links original/successor IDs.
  Duplicate correction/reversal is rejected or replayed from its receipt. No hard
  financial deletion. GET history follows the bounded original/reversal/replacement
  chain; revisions guard all mutable metadata/lifecycle resources.
- Save occurredAt UTC, immutable recorded timezone and attributed localDate. An
  explicit localDate must equal occurredAt in the saved timezone; default timezone
  comes from account preferences at creation. Reject future actual postings;
  future intentions belong to bills/previews. Corrections may explicitly select a
  different actual date; original history remains. Reversal postings use the
  original occurrence attribution for retrospective reporting, with a separate
  immutable server recordedAt for when correction occurred. Reports sum all signed
  ledger effects, classifying reversal legs by the original posting role. This
  restates the original period deterministically without changing historical rows.
  Account timezone/calendar preference changes never rewrite financial history.
- Serialize finance mutations with a transaction-scoped per-Space lock, plus DB
  scoped FKs, revision conditions, unique reversal/source-period identities and
  validated posting sums. Do not trust read/modify/write projected balances.
  Audit and finance.transaction_posted/reversed v1 outbox contain IDs only/empty
  payload, never amounts, currencies, narratives, account names or draft text.

### Budgets and reports

- Budgets have currency, optional EXPENSE category, positive limit, explicit saved
  timezone, calendar (GREGORIAN/JALALI), firstDayOfWeek, and WEEKLY/MONTHLY/CUSTOM
  period policy. Defaults are copied from account preferences at creation. Weekly
  dates follow saved week start; monthly boundaries follow the selected calendar;
  CUSTOM uses explicit Gregorian date-only start/end. Storage and transport dates
  stay Gregorian ISO dates even for Jalali calculation/presentation.
- BudgetPeriod stores explicit immutable start-inclusive/end-exclusive dates,
  timezone, calendar context and a limit snapshot, unique per budget/start date.
  Create periods only explicitly with a bounded request. Budget edits affect new
  periods only; a separate If-Match period update can explicitly change its limit.
  Historical snapshots and original currency/context are not silently rewritten.
  Spending sums expense/fee ledger effects whose occurredAt falls within the
  period's local-midnight UTC bounds, in matching currency/category. Reversals
  reduce spending in their original attributed period; negative net spending is
  returned honestly. Return spent/remaining/overspent advisory values.
- Finance reports accept explicit saved/view timezone and half-open from/to local
  dates, max 366 days, max 10000 relevant postings; reject excessive density rather
  than truncate totals. Return per-currency income, expense, fee, transfer legs,
  adjustments and net amounts, with explicit definitions. Bounds use deterministic
  first-valid local midnight and earlier fold selection; skipped local dates have
  an empty interval. No arbitrary multi-currency sum or Journal/Mood analytics.
- Private JSON and CSV export uses the same authorized filters and bounds, decimal
  strings and explicit currency/date metadata. Quote/escape CSV safely, neutralize
  spreadsheet formula prefixes in text, stream output, require authentication on
  every request, and record safe export audit metadata. No extra export entity,
  attachment, public link, background job or general data-lifecycle export.

### Bills, recurring previews and savings

- Bill is a manual obligation or recurring financial template, with title, account,
  currency, positive amount, optional category, initial dueDate, saved timezone and
  optional bounded versioned schedule. Support DAILY/WEEKLY/SELECTED_WEEKDAYS/
  MONTHLY/YEARLY/INTERVAL date schedules, explicit exclusions/end/count, default
  skip missing month days/February 29, using date identities (no timed DST gap).
  A Bill may describe EXPENSE or INCOME. Templates and dates are not actual money.
  Preview expands at most 100 dates/request, max 366-day range, with a scoped cursor;
  no background automatic posting, reminder delivery or task creation.
- Explicit pay/post selects an exact due-date occurrence and creates an authorized
  ledger transaction atomically, with unique (billId, occurrenceKey) identity and
  a durable record even when the associated transaction is later reversed. Bill
  occurrence state is derived as UNPAID/PAID/REVERSED using linked transactions;
  do not silently post again after reversal. Optional explicit PAID linking accepts
  only an unreversed same-account/type/currency/amount transaction, linked at most
  once, and performs no duplicate posting. Bill edits preserve posted occurrences;
  changed schedule/amount applies to unpaid future dates only, with saved schedule
  versions inside Bill. No extra template/occurrence entity outside the registry.
- SavingsGoal has immutable currency and exactly one mode: ACCOUNT (current derived
  balance from one same-currency same-space account) or MANUAL (exact explicit
  nonnegative progress value). Manual corrections append typed progress snapshots
  inside the SavingsGoal entity with stable logical ID/revision, preserving history.
  Do not add both sources or count linked account inflows plus its balance. Targets
  may be exceeded; show actual progress and explicit denominator, without floating
  percent arithmetic. Archive retains history; changing mode/account is rejected.

### Retained P1-08 expense drafts and compatibility

- Add finance-owned POST /finance/transactions/from-capture with capture ID/revision
  plus explicit validated EXPENSE payload, not inference from raw text. Capture
  exposes a narrow transactional public command to authorize/lock an INBOX EXPENSE
  source and finalize it atomically after Finance posts. Add a typed optional
  targetTransactionId FK to CaptureItem with a separate finance-specific read
  representation; do not expand the frozen P1-08 CaptureSchema or triage union.
  Existing source UUID/text/file remains, state becomes TRIAGED; old APIs keep their
  exact shape. Existing immutable TRIAGED behavior prevents further conversion.
- Acquire existing Task/Habit/Notes/Journal/Capture locks in their documented order
  before the Finance lock for draft conversion. Finance otherwise never calls or
  mutates these modules. Unique source capture posting plus the immutable Capture
  link protect against duplicate posting even after receipt expiry, reversal or
  different retry keys. Failed posting leaves INBOX and no ledger effect.
- Additive migration may relax the existing CaptureItem target CHECK only through
  an additional exact owner-reviewed atomic replacement that retains all old legal
  shapes and adds precisely one scoped Finance target. Generic destructive SQL
  rejection remains; earlier migrations and the ADR0015 exception are unchanged.
  This explicit approval, if granted, covers only that data-preserving CHECK
  expansion; the actual SQL/hash is recorded and tested before application.

## Verification and alternatives

Test exact minor units and HALF_UP FX, opening/negative balances, sum integrity,
same/cross-currency transfers/fees, concurrent writes/double-submit, reversal and
supersession, budget Gregorian/Jalali/DST boundaries and overspend, recurring keys,
bill link/reversal history, savings source exclusivity, private exports/CSV safety,
foreign nested resources, stale revisions and expense source rollback/replay.
Run mandatory quality, migrations/preservation and compiled restart smoke.

Alternatives needing a different owner decision: mutable financial rows/balances,
current-period reversal reporting, automatic posting, arbitrary currency precision,
implicit FX, combining savings sources, broadening old Capture responses, or adding
unregistered accounting/history/recurrence entities. These are not implemented by
this proposal. No external financial advice or real-money movement is provided.

Owner approval: Explicit approval of this proposal in the P1-09 session.

Currency authority amendment: approved [ADR 0017](0017-iso-currency-minor-unit-authority.md) supersedes only the Intl code/minor-unit source with a frozen official SIX ISO inventory. All other decisions above remain binding.
