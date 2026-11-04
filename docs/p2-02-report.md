# P2-02 implementation report

Batch: **P2-02**

Status: **COMPLETE — local implementation scope**

Authorization: owner accepted P2-01 and expressly authorized P2-02 on 2026-11-04.

Scope implemented: verified membership invitations to existing users or pending
canonical email recipients, safe preview, acceptance/decline/revoke, explicit
readmission, membership administration/departure, and accepted primary-custodian
succession. Existing Personal behavior and the accepted Shared Space kernel remain
preserved. Shared activation remains gated; no deployment or production database
change occurred.

Files/modules changed: Spaces collaboration service/controller/limiter and kernel
extensions; identity-owner credential locking and provider password verification;
proof-header CORS/redaction; existing worker maintenance; strict shared API
contracts/OpenAPI and compatibility baseline; Prisma M04; migration/upgrade tests,
integration/activation tests and compiled restart tooling/CI declaration. The
[implementation contract](p2-02-contract.md) contains the role matrix, actual routes,
failure/revision/idempotency rules and G2 feature-to-authorization-to-test mapping.

Entities, migrations and constraints: M04 adds ContextInvitation, OwnerHandover and
SharedRateLimit with typed scope/actor/admission-generation FKs, recipient/terminal
CHECKs, durable creation keys, one pending handover per custody and DB-time expiry.
There are 84 models, 85 tables including the Prisma ledger, and 28 migrations.
The [migration review](p2-02-migration-review.md) records the frozen hash and recovery
limits. Populated upgrade preserved all 81 prior tables, 1,214 existing constraints
and all 27 historical migration checksums; interrupted rollback/resume and repeat
deploy passed. The measured local M04 deployment took 712 ms, not a production
capacity claim.

API contracts, domain events and jobs: 13 new operations; canonical JSON is
`docs/api/openapi.json` (202 paths, 306 operations, 2,296 valid local references).
Frozen existing Personal signatures remain compatible. Offers create no admission
or source visibility until authorized acceptance. Initial proof is returned once
for explicit delivery by the inviter; create replay returns `proof: null`. Audit,
shared outbox, safe receipts, authoritative usage and version changes commit
atomically. Existing worker passes add bounded expiry (25 invitations + 25
handovers) and limiter cleanup (100 rows); no new queue/provider or outbound send.
Handover moves the administrative seat and its usage attribution, not source data.

Security and edge cases addressed: exact verified live sessions/recipients;
provider-canonical email and locked current identity; forwarded-proof denial;
current role/delegation/policy and generation checks; suspended/revoked access;
cross-context/actor references; optimistic revisions; duplicate/receipt-independent
replay; DB-time expiry after lock waits; actual observed-lock invitation, email,
role, departure and succession races; provider-backed reauthentication; account
closure/identity erasure; limiter enforcement without raw IP storage; proof/PII
scrubbing; Origin, strict bodies, no-store and non-enumerating errors. Narrow
archived/frozen self-departure cancels superseded frozen work without admitting
ordinary access. Postcommit witness repair requires matching atomic audit/outbox
evidence; missing evidence remains quarantined. Personal private purge remains
independent of shared retention/holds.

Tests and exact commands/results:

| Command                                                                                                                                                     | Actual result                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm quality`                                                                                                                                              | All 13 stages executed once. Eleven stages passed immediately; formatting and the new integration fixture needed the affected reruns below. Initial orchestration exited 1; it was not rerun wholesale.                                                                                                                                            |
| `pnpm config:check`, `pnpm db:generate`, `pnpm auth:schema:check`, `pnpm db:validate`                                                                       | PASS in the quality run; provider-owned auth scalar schema unchanged.                                                                                                                                                                                                                                                                              |
| `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm architecture`                                                                                            | PASS in the quality run; no boundary/cycle violation. Final fixture-only change also passed typecheck and targeted ESLint.                                                                                                                                                                                                                         |
| `pnpm test`                                                                                                                                                 | PASS: 422 tests in 64 files, including strict collaboration schemas, activation denial, migration hash review and existing compatibility contracts.                                                                                                                                                                                                |
| `pnpm openapi:check`                                                                                                                                        | PASS: generated snapshot, local references and frozen compatibility baselines.                                                                                                                                                                                                                                                                     |
| `pnpm test:integration`                                                                                                                                     | Initial full run: 411 passing, 23 failures confined to the new collaboration suite; all 22 other files/401 existing tests passed. A new test closed a reused fixture account. It now uses a dedicated account; the entire affected suite passed all 33 tests on rerun. All 434 distinct integration cases are verified; none was weakened/skipped. |
| `node --env-file-if-exists=.env.test.local node_modules/vitest/vitest.mjs run --project integration apps/api/test/integration/shared-collaboration.spec.ts` | PASS: all 33 tests after the fixture-isolation correction.                                                                                                                                                                                                                                                                                         |
| `pnpm db:migrations:check`                                                                                                                                  | PASS: existing history/status, empty replay, newly owned-schema reset, populated baseline/kernel/M04 upgrades, historical constraints/checksums, exact-artifact interruption/resume and repeat deploy. Configured databases never reset.                                                                                                           |
| `pnpm format:check`                                                                                                                                         | PASS after formatting the changed SharedControl file; final report/documentation format check also passed.                                                                                                                                                                                                                                         |
| `pnpm smoke:p2-02`                                                                                                                                          | PASS against the final compiled implementation: fresh process restart, invitation/handover expiry once, authorized accepted replay and provider-backed succession.                                                                                                                                                                                 |
| `pnpm smoke:p2-01`                                                                                                                                          | PASS: compiled kernel restart, owner exit/last departure convergence and erased attribution detachment.                                                                                                                                                                                                                                            |
| `pnpm smoke:p1-12`                                                                                                                                          | PASS: compiled API/worker restart, Personal sync/export replay, private attachment bytes, isolation, closure persistence and recovery cancellation.                                                                                                                                                                                                |
| `git diff --check`                                                                                                                                          | PASS.                                                                                                                                                                                                                                                                                                                                              |

Commands used the pinned pnpm 10.20.0 entry point with workspace-local
COREPACK_HOME. No install or dependency change was needed. Initial targeted
development runs also corrected test-module guard wiring and an erroneous test
expectation of 422 to the existing Zod HTTP 400 convention; the application
validation contract was preserved. Existing pg concurrent-query deprecation
warnings were emitted in the wider integration suite and did not fail it.

Reproducible local evidence (ignored tooling artifacts, no credentials):

- `.tools/p2-02-quality.log`: single full orchestration, including initial failures.
- `.tools/p2-02-integration-final.log`: corrected complete 33-test suite.
- `.tools/p2-02-format.log` and `.tools/p2-02-final-typecheck.log`: affected checks.
- `.tools/p2-02-upgrade-2ab11604-baf4-4da2-8046-d013befedecc/report.json`: M04 populated upgrade evidence/hash.
- `.tools/p2-02-restart-Xoa6hf/report.json` and `.tools/p2-02-smoke-final.log`: compiled collaboration restart evidence.
- `.tools/p2-02-kernel-smoke.log`, `.tools/p2-02-personal-smoke.log`: kernel/Personal compiled regressions.

Tests not run and why: Docker build/start/persistence, hosted GitHub Actions,
production-like load/soak, off-host shared restore, real SMTP delivery and launch
security/legal acceptance were **NOT RUN** in this local batch. Applicable release
or activation gates remain mandatory. No Swagger UI availability is claimed.

Deviations from binding specs: none. ADR invitation routes were proposed, not
existing API contracts; implemented routes use existing Space UUIDs before Project
domain records arrive. Per the approved M04/M05 split, external users can receive
membership offers now; concrete resource-grant targets/offers remain gated until
M05/P2-03. Actual resource/file custody transfer, recovery and destructive shared
cleanup retain their separately approved slices. No phantom grant, Project,
Team/Company or later-phase domain was introduced.

Outstanding issues / ADRs required: no local implementation blocker or new ADR.
Actual immutable operator retention configuration, independent signing keys/current
checkpoint and security activation acceptance are still prerequisites. Synthetic
test policy/key/reference values stayed inside isolated fixtures and processes;
no live runtime activation settings were installed.

Git status and commits: working tree remains dirty with preserved pre-existing
G0/P2-01 work plus P2-02 changes. HEAD remains
`6a9ccdb81e8c3b4842f1d7ea63c3531a6abbd2bb`. Nothing was committed, pushed,
deployed or applied to a production database.

Next eligible batch: **P2-03 — NOT STARTED**; requires explicit owner authorization.
