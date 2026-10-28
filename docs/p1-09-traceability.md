# P1-09 requirements traceability

Baseline P1-08: `894c7fb44d3c80e6d80ec9dd0c1d790062b77fe8`, normally pushed;
clean tree/index and independently checked remote hash before P1-09 preparation.
Status: COMPLETE under approved ADRs 0016 and 0017. Final quality: 13/13 stages,
563 passing tests across 62 files; compiled restart/replay smoke and all 17
applied migration checksums verified in development and test.

| Binding requirement                                  | Owner / implemented boundary                                | Executable verification                                                        |
| ---------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Tracking accounts, opening posting, derived balances | Finance / FinancialAccount and signed TransactionPosting    | exact opening, negative balances, archive, cross-user account IDs              |
| Income, expenses and categories                      | Finance / Transaction and FinanceCategory                   | strict currency/type/category matching, stale revisions, ownership             |
| Atomic internal and cross-currency transfers         | Finance / Transaction, postings, ExchangeRateSnapshot       | balanced same-currency legs, exact FX/fee rounding, missing rate, rollback     |
| Exact amounts and explicit units                     | strict decimal strings, approved frozen currency scales     | precision bounds, no floats/exponents, zero/negative input rejection           |
| Corrections and retained history                     | immutable ledger effects plus reversal/replacement links    | reverse once, supersession chain, stale revisions, historical totals           |
| Duplicate/concurrent mutations                       | existing actor/Space receipts plus scoped DB locking        | same/different-key races, changed fingerprints, at-most-once reversal          |
| Budget periods and advisory overspend                | Finance / Budget and BudgetPeriod                           | saved timezone/calendar/week start, boundaries, overspend without blocking     |
| Recurring financial templates and preview            | Finance / Bill schedule, explicit occurrence posting        | bounded expansion, month-end/leap dates, unique occurrence identity            |
| Bills and explicit PAID linking                      | Finance / Bill and transaction association                  | matching owner/type/amount, no duplicate money, reversed payment retained      |
| Savings without double count                         | Finance / SavingsGoal                                       | exclusive source modes, account progress, manual correction history            |
| Reports grouped by currency                          | scoped Finance query                                        | transfer exclusion, fee/adjustment definitions, reversals, DST/midnight        |
| Private JSON/CSV export                              | Finance streaming HTTP boundary                             | IDOR, bounded rows, decimal strings, formula neutralization, safe audit        |
| Retained expense draft conversion                    | Finance orchestration / Capture public transactional facade | unchanged source UUID, explicit payload, atomic rollback, duplicate prevention |
| Earlier API and module contracts                     | P1-08 frozen signatures and previous baselines              | compatibility and architecture gates; no cross-owner direct ORM access         |
| Safe schema upgrade and preservation                 | reviewed forward migrations only                            | prior migration bytes, all applied checksums, empty/seeded upgrade/redeploy    |
| Privacy and isolation                                | verified Personal Space, scoped repositories/FKs            | nested/filter/export denial, no financial narratives/amounts in logs/events    |
| Compiled runtime and recovery                        | compiled API process smoke                                  | real restart, persisted balances/history, idempotent replay                    |

Implementation: Finance domain money/dates; application LedgerService,
FinancePlanningService and FinanceReportsService; scoped FinanceRepository;
FinanceController; strict finance.ts/currency map and generated finance-openapi.ts.
Capture exposes FinanceCaptures and Account exposes FinancePreferences. Neither
public contract grants cross-owner raw persistence. Finance events use empty v1
outbox payloads. No jobs/dispatch, new dependencies or P1-10 modules.

Executable coverage: finance/domain/money.spec.ts and dates.spec.ts;
api-contracts/finance.spec.ts; reviewed-finance-migration.spec.ts;
contract/finance-openapi.spec.ts; integration/finance.spec.ts;
compiled tooling/scripts/p1-09-smoke.ts and mandatory migration upgrade harness.
The density scenario rejects 10001 relevant postings without truncation and tests
exact accepted-boundary totals and export. User/Space filters remain enforced.

See [completion report](p1-09-report.md) for observed commands, counts/checksums,
approved zero-step migration recovery and final Git status. P1-10 is NOT STARTED.
