# P1-09 completion report

Batch: P1-09 - Personal Finance.
Status: COMPLETE for the approved local development scope.

## P1-08 finalization

Repository-local Git author was explicitly set and verified as
`mehran <mehran.r1990@gmail.com>`; global/system configuration was not changed.
Exactly 89 accepted staged files matched the approved hashes and index bytes.
No secrets, private data, unrelated files or build artifacts were included.
Accepted evidence was verified without unnecessarily rerunning the full suite:
13 quality stages, 494 tests/56 files, compiled restart/replay smoke and fresh
15/15 applied checksums in development and test.

Commit `894c7fb44d3c80e6d80ec9dd0c1d790062b77fe8` uses the requested message
`feat(phase-1): complete P1-08 private writing and capture`.
Normal push to origin/main succeeded. Local main, origin/main and independently
queried remote hash matched, ahead/behind was zero/zero, and both working tree and
index were clean before P1-09 began. The ADR0015 MIME exception remains unchanged.

## Implemented scope and modules

Finance owns exact personal accounts, signed ledger effects, income/expenses,
flat ordered categories, atomic same/cross-currency transfers and explicit fees,
derived balances, reversal/superseding corrections and immutable history.
Saved Gregorian/Jalali budgets and period snapshots expose advisory overspend.
Bills support bounded recurring date previews and explicit unique posting/payment
links. Savings has exclusive account/manual sources and manual correction history.
Private per-currency reports and bounded streaming JSON/CSV exports preserve exact
decimal strings and neutralize formula prefixes in narratives.

Capture's new FinanceCaptures public transaction validates/finalizes retained
expense sources atomically with Finance postings, receipts, safe audit and outbox.
Source identity/text/file and durable target links remain. Old P1-08 Capture inputs,
outputs and triage union are unchanged. Account exposes only FinancePreferences
for saved timezone/calendar/week defaults. No cross-owner persistence is used.
Existing Task/Goal/Habit/Focus/Journal behavior and identities are preserved.

Approved [ADR0016](adr/0016-personal-finance-ledger-and-period-semantics.md) defines
accounting/history/period rules. Approved [ADR0017](adr/0017-iso-currency-minor-unit-authority.md)
replaces the unsuitable Intl money map with official ISO data. The 165-code frozen
SIX inventory includes explicit minor units and URL/publication/retrieval/SHA-256
provenance. No runtime network calls or rate provider. All money calculations use
BigInt scaled units/exact rational FX; Decimal persistence does not use JS floats.

Contracts/OpenAPI, P1-08 compatibility signatures, [traceability](p1-09-traceability.md)
and [runbook](runbooks/finance.md) are included. Empty version-1 outbox events are
finance.transaction_posted/reversed. Dispatch/jobs remain inactive. No dependencies,
banking/payment integrations, double-entry chart, AI, P1-10 or later modules added.

## Entities, constraints and migrations

Nine approved business entities only: FinancialAccount, Transaction,
TransactionPosting, FinanceCategory, Budget, BudgetPeriod, Bill, SavingsGoal and
ExchangeRateSnapshot. Scoped FKs enforce resource containment; aggregate creator
references use the personal Space owner composite constraint. Posting/account and
Bill/Savings account FKs enforce currency/scale agreement. Checks enforce frozen
ISO scales, exact minor units, signed nonzero effects, valid lifecycle/source modes,
period ranges and typed history identities. Unique keys protect reversal,
replacement, bill/key, capture source/target and budget/start-date identities.

- `202610280013_p1_09_finance`: additive nine-table schema, scoped relationships,
  immutable history support, precision and identity checks.
- `202610280014_p1_09_capture_finance`: approved atomic Capture target CHECK
  expansion. Only the exact reviewed SQL/name/hash is accepted; generic destructive
  rejection and ADR0015's separate exact MIME exception remain enforced/tested.

Both migrations are applied to development and isolated test. Deployment preserved
every pre-existing field/row hash; only the new nullable Capture target field is
excluded from old-field comparisons. Earlier 15 migration files and auth-owned
schemas remain unchanged. All 17 applied SQL checksums match in both databases.

The first new 013 attempt failed at its first statement after Prisma returned empty
diff output without an explicit configuration environment. My generation check
missed the absence of CREATE TABLE statements. Zero applied steps, unchanged table
sets and all prior row hashes were verified. Approved ADR0017 recovery marked only
that unsuccessful attempt rolled back, then deployed the corrected new script
with all nine table definitions. The failed ledger record is retained; no prior
successfully applied migration was edited and no configured database was reset.

Matching SHA-256 checksums in development and test:

| Migration                                 | SHA-256                                                            |
| ----------------------------------------- | ------------------------------------------------------------------ |
| 202610270001_p0_02_identity_ownership     | `378358fa7e8ce9ea3e88ac0c59e5df5bdefab923d3126ba943b0bb09165f2b55` |
| 202610270002_p0_03_data_api_events        | `c351a30a0b1f55979b6fc2d13d2fb4683ddc5e880541a7774c51d6e0c78ca833` |
| 202610270003_p0_04_private_files          | `1a8b6c10e7681166fce6a84e98355150efe2b58918cdbabc57b9bacb8ef07b07` |
| 202610280001_p1_01_tasks                  | `b756f32a2b578d41172ba3c0cf30d3735535b54d184c513609c83acc66adde68` |
| 202610280002_p1_02_task_recurrence_tools  | `cefe69017ff57383b188960ba734982b140a1eadfffaee4b43e11f758e20afd2` |
| 202610280003_p1_03_personal_planning      | `fba0b1e53da2cb239add7278473230fc695409fa1efab79af9ee7abd51d2c6a4` |
| 202610280004_p1_04_calendar               | `5845390f0af36663781451c88e92d24acf55587d9ed20e44a401e96535333a40` |
| 202610280005_p1_04_calendar_integrity     | `441f7b88dfba3a19c8942a2a4d8c4e1a873ec98f7c0a48f9d227cd65281f2112` |
| 202610280006_p1_05_habits                 | `84ef468f8542a5bc7de152f0c17ab9e9fa4cb1cf36aed021d6977c5b3ce6f78e` |
| 202610280007_p1_05_habit_config_integrity | `31d412b93603e4a7520b37f3c7dae009e626c1f70969b741feb054d0b751087d` |
| 202610280008_p1_06_goals                  | `7bdb92bae5c416c864c2363763a092282fbc7cfa8142049c6b64d928c1d9c7e3` |
| 202610280009_p1_07_focus                  | `5082240f049dd925fff0e50a384322d6bd42a4dff80b51bc256108ad3221e0e0` |
| 202610280010_p1_07_productivity_audit     | `e551139a49771ab809e07f8f53e200137e6ad7b2c05592de347a136689dd6ec3` |
| 202610280011_p1_08_private_writing        | `bb56406efedf8d0e96117e3c98d0e773cecdbce06e7e9414a0e5b29a988de593` |
| 202610280012_p1_08_private_voice          | `fdb40cbbdc0fffc5d631fdda67eb0455ac73d689a6e5009172eab6442c63fbbb` |
| 202610280013_p1_09_finance                | `e31dcb994b477ec6f737ba48d176f23af84ced52bf9cbc7ae7a07d3783fca6c5` |
| 202610280014_p1_09_capture_finance        | `03e1cdddf71bafec282fa9ec334453ea0549f55a5a2d4df47c0a15eec97d7448` |

## Verification

Targeted domain/schema/migration: 25 passing tests in four files. Finance contract:
three passing tests. Expanded Finance API: 41 passing scenarios, including the
10001-posting rejection and exact 10000-posting report/export boundary. Compiled
restart smoke passed for balances, FX/fees, correction history, budget/bill/savings,
expense-source identity, receipt replay, private CSV and cross-user denial.

The density scenario exposed an inefficient repeated transaction scan. Owning
queries now use globally unique transaction IDs plus the scoped posting/composite
FK containment, a bounded density preflight and bounded export hydration batches.
No timeout, data limit, test assertion or security check was weakened.

- `pnpm quality`: PASS, all 13 stages, exit 0.
- Unit/domain/contracts/architecture/compatibility: **282 tests in 47 files**.
- Isolated PostgreSQL integration: **281 tests in 15 files**.
- Total: **563 passing tests across 62 files**, no skips in the final run.
- Official auth schema, Prisma validation/generation, build/typecheck,
  formatting/lint, OpenAPI snapshot and all earlier compatibility baselines: PASS.
- Architecture: zero violations across 218 modules and 1147 dependencies.
- `pnpm db:migrations:check`: PASS from empty schema (56 tables including Prisma's
  ledger), seeded P1-08 upgrade, preservation of writing/mood/capture plus every
  earlier source, and repeat deploy. Configured databases were never reset.
- `pnpm smoke:p1-09`: PASS after the final quality build, including a real API
  process restart, exact balances/FX/fees, correction history, budget/bill/savings
  persistence, expense identity, receipt replay and private CSV/isolation.
- Fresh read-only verification after final quality/smoke: **17/17 applied SQL
  checksums match development and test**, zero unfinished migrations; earlier
  migration bytes and runtime/dependencies remain unchanged.
- Structural database/schema comparison: empty after normalizing only the
  pre-existing equivalent provider UUID function qualification. Auth schema unchanged.
- Runtime: Node.js 24.22.1, PostgreSQL 18.6.

The first full submission attempt passed all 563 tests but found one unformatted
test file. Final review also corrected version closure to preserve original
Bill/Savings revision timestamps; targeted history assertions verify both. The
complete final rerun above passed every stage after those changes. No assertions,
timeouts, row limits or required gates were weakened. The existing writing test's
obsolete Finance-route-absence assertion now checks that retaining/archiving an
expense draft creates zero accounts and zero transactions; all old contracts stay
frozen and verified.

Docker image/startup/deployment checks are NOT RUN / DEFERRED under the approved
local development scope and remain mandatory before Docker release.

## Deviations, blockers and Git

All policy changes are explicitly approved in ADR0016/0017; no unapproved deviation
or unresolved product decision. P1-09 remains unstaged, uncommitted and unpushed;
HEAD remains the pushed P1-08 commit. Review covers exactly 60 changed/new P1-09
files, with no secrets, private/build/database artifacts or unrelated changes;
index is empty and local/tracking main remain zero ahead/behind.
P1-10 is next eligible and NOT STARTED.
