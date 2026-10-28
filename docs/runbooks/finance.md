# Personal Finance operations

P1-09 uses approved [ADR 0016](../adr/0016-personal-finance-ledger-and-period-semantics.md)
with the currency-authority amendment in [ADR 0017](../adr/0017-iso-currency-minor-unit-authority.md).
All routes below use `/api/v1/finance`, verified authentication and the authorized
Personal Space. Financial accounts track manual personal value; they do not move
money through banks or payment services. OpenAPI defines exact strict bodies.

## Money and balances

Amounts are positive decimal **strings**, at most 18 integral digits, with exactly
permitted ISO minor-unit precision. Inputs may omit trailing zeroes; responses use
fixed currency scale. Numeric JSON amounts, exponents, arbitrary/withdrawn codes,
negative actual amount inputs and silent excess-precision rounding are rejected.
Explicit direction determines signed ADJUSTMENT postings. Zero is valid for
derived balances and manual savings progress; omit a zero opening balance.

The frozen 165-code inventory comes from official SIX List One, published
2026-09-17, retrieved 2026-10-29. Source URL and SHA-256 are exported with the map
in `finance-currencies.ts`. ISO examples: AFN/COP/IDR/IRR=2, JPY=0, KWD=3,
CLF/UYW=4. Codes with N.A. minor units and crypto are unsupported. Intl is used for
calendar calculations, never money precision. No runtime currency download.

Pure domain calculations use BigInt scaled units; persistence uses Decimal(28,4).
Account balance is the exact sum of all signed postings including reversals.
Opening balance creates one ADJUSTMENT posting, not a second balance source.
Negative balances are allowed. Account currency is immutable; metadata changes
use If-Match. Archive retains history and prevents new ordinary postings; reversal
and explicit correction of historical transactions remain possible.

## Posting and corrections

POST `/transactions` accepts INCOME, EXPENSE or ADJUSTMENT; POST `/transfers`
creates one atomic business transaction with source/destination principal legs and
an optional source-currency fee. Same-currency principal amounts must equal.
Cross-currency input must provide a positive recorded rate (up to 12 fractional
digits), conversion date, explicit destination amount and both accounts. Rate
means destination units per one source unit. Destination must equal exact source
times rate rounded HALF_UP once to destination minor units. A zero rounded result
is rejected. ExchangeRateSnapshot retains the rate/date/currencies/rounding.
No live rate lookup or implied cross-currency total is used.

Creates/actions require Idempotency-Key; actions on existing resources also require
the current If-Match. Receipts are actor/Space/operation/body scoped and replay for
the existing 24-hour retention. Durable unique constraints additionally protect
reversals, bill occurrences, budget periods and expense sources after receipt expiry.
Per-Space transaction locks serialize ledger effects across processes. There is
no projected balance read/modify/write race or event-driven split transfer.

POST `/transactions/{id}/reverse` appends exactly negated postings and marks the
original REVERSED once. POST `/transactions/{id}/correct` atomically reverses and
appends a fully validated replacement. No API edits/deletes posted monetary rows.
GET `/transactions/{id}/history` follows the bounded original/reversal/replacement
chain. Original postings, narratives and attribution remain traceable. Reversal
uses original occurrence attribution and its own server creation timestamp.
Corrections may explicitly choose a new actual date; reports restate original
periods by summing all effects. Lists include both original and reversal rows;
clients must not add only positive rows or ignore reversal effects.

Actual postings retain UTC occurredAt plus saved timezone/localDate; an explicit
localDate must agree. Future actual instants are rejected. Preference changes do
not reinterpret historical attribution. Transaction list date filters use saved
attributed dates; report/export windows use their explicitly requested timezone.

## Categories, budgets and periods

`/categories` supports flat INCOME/EXPENSE categories, explicit position, archive
and restore. New assignments require an active matching same-space category.
Historical references survive archival; category kind is immutable. Category lists
order by position and stable ID with scoped cursors.

Budgets save currency, optional EXPENSE category, positive limit, period policy,
timezone, GREGORIAN/JALALI calendar and firstDayOfWeek (Sunday=0). Defaults copy
account preferences at creation and remain unchanged after travel/preferences.
WEEKLY uses the saved week start. MONTHLY uses the saved calendar. CUSTOM requires
an explicit exclusive end date. Transport/storage dates remain Gregorian ISO dates.

POST `/budgets/{id}/periods` explicitly creates a unique period/limit/category/context
snapshot. Budget edits affect new periods. PATCH `/budgets/{id}/periods/{periodId}`
explicitly changes a period limit with its own revision. GET the period list for
exact spent/remaining/overspent values. Expense and FEE effects count; transfer
principal, opening balances and adjustments do not. Reversal reduces original
period spending; negative net spending is returned honestly. Overspend warns and
never blocks posting. Period queries use half-open local-midnight UTC bounds;
midnight gaps use first valid time, repeated midnight uses the earlier instant,
and a skipped local date has an empty interval.

## Bills and recurrence

Bill is an unpaid obligation or recurring INCOME/EXPENSE template. Date schedules
support daily, weekly, selected weekdays, monthly, yearly and day intervals,
exclusions, optional end/count, missing month-day and leap-day skipping.
GET `/bills/{id}/preview?from=...&to=...` is read-only, at most 366 dates and
100 results/page. Its cursor binds owner/Space/query/current bill revision.
Count calculations handle long downtime without scanning each elapsed day.

POST `/bills/{id}/pay` explicitly selects occurrenceKey and either posts money or
links an existing transaction with transactionId/transactionRevision. Linking
requires the same account/type/currency/amount, one principal posting, an unreversed
transaction and no existing bill association; it creates no second posting.
Unique bill/key identity persists after payment reversal. Preview returns
UNPAID/PAID/REVERSED; reversed payments do not silently become postable again.

Bill edits require effectiveFrom at or after today and the current version's
boundary. Saved typed versions preserve earlier schedule/price/category context;
changes apply to unpaid future dates. Paid transactions retain their actual money
even if a later schedule excludes that key. History is available at `/bills/{id}/history`.
Archival uses an explicit future/current effective boundary. No automatic posting,
reminder delivery, task creation, sweep or worker is activated.

## Savings and retained expense drafts

SavingsGoal has immutable currency and exclusive ACCOUNT or MANUAL source.
ACCOUNT reads one same-currency account's current balance. MANUAL stores explicit
nonnegative progress; corrections append typed revisions with history at
`/savings-goals/{id}/history`. Do not add inflows plus balance or mix sources.
Targets can be exceeded; progress, target and percent are returned separately.
Percent is an exact two-decimal string truncated toward zero, not money rounding.
Archive retains historical manual values and immutable mode/account identity.

POST `/transactions/from-capture` requires the retained capture ID/revision and
an explicit EXPENSE payload. Raw text is not interpreted. Capture's public
transactional facade locks/authorizes an INBOX EXPENSE, then finalizes its typed
target in the same transaction as Finance posting, receipts, audit and outbox.
Original source UUID/text/file remains. TRIAGED and unique source posting prevent
duplicate conversion after retries, receipt expiry or reversal. Failed conversion
leaves INBOX and no monetary effect. The P1-08 Capture schema/triage union and its
four old target fields remain byte-compatible; the Finance result and transaction
sourceCaptureId expose the new association.

## Reports, export and privacy

GET `/reports` uses half-open from/to local dates, maximum 366 days and 10000
relevant postings. Too much data is rejected, never silently truncated. Results
group currencies independently and define income, expenses including fees, fee
subset, transfer legs, adjustments and net. No unapproved conversion/grand total.
The owning query scopes postings explicitly and uses their composite FK to join
the globally unique transaction ID efficiently; same-Space isolation remains enforced.

GET `/export` uses the same owner/filter/window bounds and streams JSON or CSV.
Amounts remain decimal strings; text cells neutralize spreadsheet formula prefixes,
including leading whitespace. Canonical signed numeric cells keep their exact
decimal value. Responses are private/no-store attachments, not public file links.
All nested resources, filters and export account/category references are authorized.
Finance is excluded from generic personal text search. No Journal/Mood data is used.

Audit records contain only safe action/actor/resource/request metadata. Version-1
finance.transaction_posted and finance.transaction_reversed outbox payloads are
empty; consumers must use future authorized owner contracts. No amounts, currencies,
account names or narratives are logged/broadcast. Dispatch remains inactive.

## Verification and migration operations

Use `pnpm smoke:p1-09` after building for an isolated compiled API restart test.
It verifies exact balances, FX/fees, correction history, periods, recurring payment,
savings, source identity, receipt replay, private CSV and cross-user denial.
Only owned synthetic fixture rows/files are cleaned. Run `pnpm quality` for all
13 local gates; Docker deployment checks remain deferred until release.

Migration 202610280013 adds the nine Finance tables and typed scoped relationships.
Migration 202610280014 atomically expands only CaptureItem_target_values; its exact
name/SQL hash is approved under ADR0016. Generic destructive rejection and ADR0015's
separate MIME exception remain unchanged. Earlier migrations are never rewritten.
The first 013 attempt failed at its first statement because generated table DDL
was empty; schema/row hashes and zero applied steps were verified before approved
rolled-back recovery. The corrected new migration includes all nine CREATE TABLE
statements, official ISO checks and prior-data preservation evidence. No configured
database was reset or destructively recreated.
