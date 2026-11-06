# P3-03 local implementation report

Batch: **P3-03 — Team capacity, authorized portfolio analytics and dashboards**.

Status: **COMPLETE for local implementation**. All mandatory gates are satisfied
across one complete quality run and affected reruns. Shared activation and release
remain gated.

Scope implemented: explicit generation-bound Team daily capacity; current accepted
Project allocation workload; authorized per-source and aggregate task/Goal/work-log
measures; Team dashboard planning counters. Existing source ownership, Personal,
Project and Team APIs retained. Shared activation disabled; Company association
inactive. No P3-04 feature started.

Files/modules changed: Teams analytics application/domain/controller and public
contracts; narrow existing Project/Task/Goal public-facade extensions; Calendar's
existing civil-boundary function exported through its public contract. API schemas,
OpenAPI, P3-02 compatibility baseline, migration review/rehearsal and focused tests.
See [contract](p3-03-contract.md) and [migration review](p3-03-migration-review.md).

Entities, migrations and constraints: one new `TeamCapacityDay`, three typed
NO ACTION FKs, generation/date/zone identity, unique day key, positive revision,
bounded/null minutes and immutable identity/revision trigger. One atomic migration
`202611060025_team_capacity`; SHA-256
`2581bb85256f1c660045c543d18d1a19a411868eedbbef35d1c40284d619029c`.
The sole existing-table change extends the exact usage feature CHECK. Cleanup FK
catalog reviewed; all 48 predecessor migration artifacts preserved byte-for-byte.

API contracts, domain events and jobs: **6 additive operations; 501 total**,
**4,246 resolved references** in `docs/api/openapi.json`. Scoped creation receipts,
optimistic updates, signed pagination, `team.capacity.change` audit/outbox and
`team.capacity-day` authoritative free-mode usage. No new worker handler, schedule,
provider, dependency, export or commercial enforcement.

Security and edge cases addressed: current full Team read and independent Project
read; no guest aggregate access; hidden sources/counts filtered; current member and
generation checks; closure/verification/session gates; private Personal task/Goal
exclusion; no private Focus/Journal/Mood/Finance/notes/calendar reads; no source
text or live User identity in aggregates. Explicit unknown versus zero capacity,
known versus unknown estimates, accepted/open-task workload, clipped explicit work
logs, current-stock denominator, half-open civil/DST windows and safety bounds.
Atomic rollback/retry, stale/foreign IDs, receipt/cursor invalidation, both capacity
revocation orders and both Project/dashboard lock orders have focused tests.

Tests and exact commands/results:

| Command/evidence                                                                                                                                                                                                                                                                                                                                                                                     | Result                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd test:integration apps/api/test/integration/team-analytics.spec.ts`, `.tools/p3-03-targeted-final.log`                                                                                                                                                                                                                                                                                      | **17 passed**                                                                                                                                                                                                                                                                                                                                                                           |
| `pnpm.cmd exec vitest run --project unit --project contract --project architecture --project compatibility apps/api/src/modules/teams/domain/analytics.spec.ts packages/api-contracts/src/team-analytics.spec.ts apps/api/test/contract/team-analytics-routes.spec.ts tooling/architecture-tests/team-capacity-migration.spec.ts tooling/compatibility/openapi.spec.ts`, `.tools/p3-03-contract.log` | **8 passed**                                                                                                                                                                                                                                                                                                                                                                            |
| `pnpm.cmd quality`, `.tools/p3-03-quality.log`                                                                                                                                                                                                                                                                                                                                                       | **All 13 stages executed once**. Config, generation, auth schema, DB validation, build, typecheck, formatting, architecture, OpenAPI, **614 integration tests** and migrations passed. Original overall exit **1**: lint found the existing Calendar inline type import; non-integration had **545 passed / 1 failed of 546** due to the synthetic Push fixture. Original log retained. |
| `pnpm.cmd exec vitest run --project unit apps/api/src/modules/notifications/infrastructure/transport.spec.ts`, `.tools/p3-03-transport-rerun.log`                                                                                                                                                                                                                                                    | **30 passed** after padding the synthetic ECDH scalar to VAPID's required 32 bytes; runtime key validation and all assertions retained                                                                                                                                                                                                                                                  |
| `pnpm.cmd exec eslint apps/api/src/modules/notifications/infrastructure/transport.spec.ts apps/api/src/modules/calendar/application/calendar.port.ts tooling/testing/team-capacity-upgrade.ts --max-warnings 0`; matching targeted Prettier; `pnpm.cmd exec tsc --noEmit`                                                                                                                            | **PASS**, including the type-import-only correction and final upgrade fixture                                                                                                                                                                                                                                                                                                           |
| `pnpm.cmd smoke:p3-03`, `.tools/p3-03-smoke.log`                                                                                                                                                                                                                                                                                                                                                     | **PASS**: compiled API fresh-process restart, capacity durability/idempotency, dashboard and independent Project visibility                                                                                                                                                                                                                                                             |
| `git diff --check`; `.tools/p303-preservation.cjs` / `.tools/p3-03-preservation.json`                                                                                                                                                                                                                                                                                                                | **PASS**: 17 protected unrelated/environment artifacts, 48 old SQL artifacts, unchanged HEAD, empty Git index                                                                                                                                                                                                                                                                           |

The prior Push fixture failure was a leading-zero ECDH serialization case; the
Calendar correction only replaces an inline type import with `import type`.
The affected `pnpm.cmd architecture` rerun passed with 440 modules and 2,700
dependencies; final report formatting and `git diff --check` also passed.
These small fixes are required to establish the mandatory quality gate. No
security check, assertion, timeout, required test or runtime validation was weakened.
No complete quality or regression suite was repeated. Final acceptance totals
**1,160 distinct passing tests: 546 non-integration and 614 integration**, including
the corrected fixture through its affected rerun. The final migration stage passed
empty replay, all predecessor rehearsals/security closeout and the new populated
139-table upgrade, 48 immutable checksums, prior constraints, interrupted rollback,
resume/repeat deploy and exact cleanup catalog. The final type-only import and
fixture fixes change no runtime behavior or public contract.

Tests not run and why: Docker/WSL, production deployment/database changes, hosted
CI and release-only off-host/load/activation checks **NOT RUN / DEFERRED** per owner.
No worker changed, so no redundant worker restart smoke. Configured databases were
never reset; migrations target guarded isolated local PostgreSQL only.

Deviations from binding specs: none. Capacity is an explicit availability budget;
existing accepted Project allocations supply workload. Team-owned tasks contribute
portfolio measures without inventing new Team task-assignment/acceptance rules.
No employee scoring, pay, recognition/feedback, meeting, Company association or
Team lifecycle implementation was added.

Outstanding issues / ADRs required: no P3-03 local blocker or new ADR. Existing
Shared activation/production security, retention and operational prerequisites remain
gated. Team handover/archive/restore/cleanup remains P3-05.

Git status and commits: accepted P3-02's **46 approved files** were reviewed,
committed and pushed to `origin/main` as
`9aeb24a2457d82cc88233cfd003447bf8ceb15fd`; remote SHA matched local HEAD.
P3-03's 41 changed/new files remain unstaged and uncommitted. Unrelated `docs/architecture/`,
`docs/frontend-handoff/`, environment files and runtime artifacts are preserved.
No P3-03 commit/push, Shared activation, production database change or deployment.

Next eligible batch: **P3-04 — NOT STARTED; requires explicit authorization**.
