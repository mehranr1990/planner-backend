# P1-11 requirements traceability

Status: COMPLETE for approved local development; final quality and smoke pass.
ADRs 0020 and 0021 are explicitly approved. The matrix below maps the implemented
scope to the targeted integration/domain/contract tests and final gate.

Baseline: P1-10 commit `6c5a6220b8cd08c49bd514e4494d94c794011699`, pushed to
`origin/main` and independently verified against the actual remote branch.

| Binding requirement                                                | API / ownership                                                                           | Verification                                                                                                            |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Canonical definitions, denominators, freshness and bounded queries | `/insights/overview`; Insights with owner read facades                                    | Zero data, exact ratios, density rejection, consistent snapshot and source corrections                                  |
| Task completion and planning metrics                               | `/insights/tasks`; Tasks and Planning own source reads                                    | Moved dates, reopened/deleted Tasks, recurrence masters, repeated selections and completion transitions                 |
| Habit consistency and streaks                                      | `/insights/habits`; Habits canonical schedule/entry reads                                 | Neutral rest/pause/skip, corrections, exact aggregate denominator and preserved local dates                             |
| Current and historical Goal progress                               | `/insights/goals`; Goals canonical progress and immutable reviews                         | Exact weighted progress, absent observations and source changes without rewritten snapshots                             |
| Focus/time statistics                                              | `/insights/time`; Focus canonical entries                                                 | Clipping, union/overlap, live versus recorded work and no segment/session duplication                                   |
| Exact private financial aggregation                                | `/insights/finance`; Finance report facade                                                | Multi-currency, fees versus transfer principal, reversal attribution, explicit overview consent                         |
| Explainable deterministic comparisons                              | Insight responses                                                                         | Evidence metric IDs/ranges, missing baseline, DST, local midnight and week boundaries                                   |
| Private-data consent and tenant isolation                          | All insight and reward routes                                                             | Cross-user reads/filters, rejected Journal/Mood opt-in and sensitive payload exclusion                                  |
| Optional achievements and XP                                       | `/rewards/achievements`, `/rewards/progress`, `/rewards/preferences`; Rewards and Account | Owner-approved rules, duplicate source events, semantic duplicate prevention, opt-in boundaries and recalculation       |
| Durable independent reward consumption                             | Existing worker and transactional outbox                                                  | Source mutation remains committed after consumer failure, bounded retries and restart recovery                          |
| Compatibility, migration and data preservation                     | Existing contracts and additive migrations only                                           | Twenty baseline migrations and pg-boss bytes retained, all earlier signatures compatible, empty/upgrade/redeploy checks |

## Verification evidence

- Accepted P1-10 signatures frozen in
  `tooling/compatibility/p1-10-api-signatures.json` and included in the existing
  OpenAPI compatibility gate: 3050 signatures.
- `node tooling/scripts/openapi.ts`: PASS against the unchanged reviewed OpenAPI.
- Targeted Prettier check for the proposal and compatibility changes: PASS.
- Read-only baseline verification: all twenty application migration checksums
  match development and isolated test; reviewed pg-boss schema version 46 and
  SHA-256 `33395ea7aaf8d17f4eceec23c45fcb6672a278f11d3c1a255d8589491278e238`
  match. No schema or source-domain data changes.
- Targeted domain/contract/migration exception tests: 24 passing across three files.
- Targeted P1-11 integration tests: 26 passing, including a complete 10000-Task
  cohort and explicit rejection at 10001, exact mixed-currency reporting, DST,
  immutable Goal observations, retry rollback, semantic reward deduplication,
  preference concurrency, corrections and scoped source-event provenance.
- P1-11 migrations: two additive migrations; all sixty previous application
  tables/columns/rows were preserved during initial migration verification.
- Final `pnpm quality`: 13/13 stages PASS, 731 tests in 72 files. All previous
  compatibility baselines remain enforced. Historical scope guards now positively
  assert approved P1-11 routes while retaining P1-12/company/team exclusions.
- Final `pnpm smoke:p1-11`: PASS, including actual compiled API/worker restarts,
  backlog settlement, semantic XP deduplication and persisted idempotent replay.
- Final checksum verification: 22 application migrations match development/test;
  earlier twenty migration bytes and reviewed queue schema/artifact remain intact.

## Implemented ownership map

Feature-owned Insights and Rewards modules, strict Zod/OpenAPI contracts,
owner-exported scoped read facades, Account-owned preferences and independent
platform outbox consumer progress. Only approved registry entities were added through
reviewed additive migrations. Domain, integration, privacy/concurrency and
compiled restart smoke coverage are in place. P1-12 remains outside this batch.
