# P2-03 implementation report

Batch: **P2-03**

Status: **COMPLETE — local implementation scope**

Authorization: owner accepted P2-02 and explicitly authorized completion of P2-03.

Scope implemented: independent Project management, phases/sections/milestones,
archive/restore/controlled deletion, structural member responsibilities, existing
Task/Goal source-owner facade integration and same-Project associations, concrete
Project/Task/Goal grant targets and verified recipient offers. Existing Personal,
Shared Space kernel and P2-02 membership/invitation contracts are preserved.
Shared activation remains gated. No Team/Company domain, task assignment consent,
Personal shared projection or later-batch workflow/file/transfer feature was added.

Files/modules changed: new Projects module/controllers; Tasks/Goals public shared
facades using existing engines; Spaces authorization, resource grants, lifecycle,
signed cursor and free-mode usage seams; existing worker maintenance; strict API
contracts/OpenAPI/signature baseline; four reviewed M05 migrations and populated
upgrade verification; security/route/migration tests and compiled restart tooling.
The [G2 contract](p2-03-contract.md) maps all 38 operations to authorization and tests.

Entities, migrations and constraints: eleven tables added; 95 models, 96 tables
including Prisma's ledger and 32 migrations. M05 is delivered by immutable
`202611040005_project_core`, `202611040006_project_usage_features`,
`202611040007_project_structure_order` and
`202611040008_project_personal_compatibility`. The [migration review](p2-03-migration-review.md)
records exact hashes, locks and rollback limits. Typed scope/actor/generation FKs,
Personal/shared attribution guards, immutable source custody, target-specific
grant ceilings and deferred exactly-one-target checks preserve relational integrity.
The populated rehearsal preserves all 84 old table data sets and 28 historical
checksums; 1,296 existing constraints are compared with only three approved
attribution NOT NULL changes and one usage-feature CHECK extension excepted.
Local measured core deployment was 1,597 ms in the targeted rehearsal; this is not
a production capacity claim. Configured development/production databases were not
migrated or reset; verification uses guarded test databases and owned schemas.

API contracts, domain events and jobs: 38 new operations; canonical OpenAPI has
228 paths, 344 operations and 2,676 valid local references. All frozen Personal and
P2-02 signatures remain compatible. Source history, audit, shared outbox, receipts,
usage and authorization versions commit atomically. PATCH receipts persist HTTP
200 and bind the current admission generation. Existing worker passes add bounded
resource-offer expiry with proof scrubbing; controlled deletion retains content
and records the existing thirty-day shared lifecycle job. No destructive shared
purge, recovery activation, outbound send or new queue/provider is introduced.

Security and edge cases addressed: verified live sessions and exact recipients;
current role/policy/delegation and admission generations; Viewer write ceiling;
permanent issuer/policy revocation despite later promotion/repair; exact named
resources without directory/list/count leakage; complete-only grants cannot cancel
Tasks; same-space/source-owner constraints; signed cursors bound to actor, scope,
collection and authorization state; DB-time expiry; optimistic revisions and safe
receipt replay; atomic free-mode usage decisions and independent abuse caps;
observed-lock source/revocation/policy races; guest departure/readmission; provider
reauthentication; former-owner erasure retaining shared attribution; fail-closed
independent control and committed-witness handling. Personal privacy and lifecycle
remain independent of shared retention.

Tests and exact commands/results (pinned pnpm 10.20.0, workspace COREPACK_HOME):

| Command                                                                                                                                                                                                                                                                                                                                                                               | Actual result                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm quality`                                                                                                                                                                                                                                                                                                                                                                        | All 13 stages executed once. Orchestration exited 1 for contract, integration and migration-check failures; the affected checks below passed after correction. The full gate was not repeated.                                                                                                                                                                                             |
| `pnpm config:check; pnpm db:generate; pnpm auth:schema:check; pnpm db:validate`                                                                                                                                                                                                                                                                                                       | PASS in the full gate; provider-owned authentication schema unchanged.                                                                                                                                                                                                                                                                                                                     |
| `pnpm build; pnpm typecheck; pnpm format:check; pnpm lint; pnpm architecture`                                                                                                                                                                                                                                                                                                         | PASS in the full gate. Build and typecheck passed again after the Personal mapper correction; targeted ESLint passed for all seven subsequently affected TypeScript files.                                                                                                                                                                                                                 |
| `pnpm test`                                                                                                                                                                                                                                                                                                                                                                           | Initial: 426 passed, one obsolete Phase 1 assertion failed; 427 tests/67 files. The assertion prohibited the now-approved Projects route. It now requires that route and still prohibits shared Personal sync.                                                                                                                                                                             |
| `node node_modules/vitest/vitest.mjs run --project contract apps/api/test/contract/lifecycle-openapi.spec.ts`                                                                                                                                                                                                                                                                         | PASS: all four affected contract tests.                                                                                                                                                                                                                                                                                                                                                    |
| `node node_modules/vitest/vitest.mjs run --project unit apps/api/src/platform/database/foundation.spec.ts --project architecture tooling/architecture-tests/project-migration.spec.ts`                                                                                                                                                                                                | PASS: ten tests in two affected files, including the exact fourth migration artifact/hash and unchanged generic SQL rejection. All 427 distinct non-integration cases are verified.                                                                                                                                                                                                        |
| `pnpm openapi:check`                                                                                                                                                                                                                                                                                                                                                                  | PASS: reviewed snapshot, valid local references and frozen Personal/P2-02/P2-03 compatibility signatures.                                                                                                                                                                                                                                                                                  |
| `pnpm test:integration`                                                                                                                                                                                                                                                                                                                                                               | Initial: 430 passed, 30 failed in five Personal suites; 460 tests/24 files, 378.16 seconds. Failures were Goal output leaking additive database fields and over-restrictive Personal creator attribution.                                                                                                                                                                                  |
| `node --env-file-if-exists=.env.test.local node_modules/vitest/vitest.mjs run --project integration apps/api/test/integration/goals.spec.ts apps/api/test/integration/tasks.spec.ts apps/api/test/integration/insights-rewards.spec.ts apps/api/test/integration/writing.spec.ts apps/api/test/integration/personal-lifecycle.spec.ts apps/api/test/integration/project-core.spec.ts` | PASS: all 140 tests in six affected suites, including all five Personal regression suites and all 26 Project security cases; 169.76 seconds. All 460 distinct integration cases are verified. No test was weakened or skipped.                                                                                                                                                             |
| `pnpm db:migrations:check`                                                                                                                                                                                                                                                                                                                                                            | Initial failure: old whole-row JSON snapshots mistook newly added null columns for changed historical data. Snapshots now compare every captured pre-upgrade column and every row. Affected gate PASS: guarded history/status, empty replay, owned-schema reset, populated Personal/kernel/P2-02/P2-03 upgrades, old constraints/checksums, interrupted rollback/resume and repeat deploy. |
| `pnpm smoke:p2-03`                                                                                                                                                                                                                                                                                                                                                                    | PASS against the final compiled implementation and all four M05 artifacts: HTTP API/worker restart, source durability, authorized receipt replay/status, expiry once, archive/restore and retained controlled closure.                                                                                                                                                                     |
| `pnpm smoke:p2-02`                                                                                                                                                                                                                                                                                                                                                                    | PASS: compiled invitation/handover restart, expiry once, authorized replay and provider-backed succession.                                                                                                                                                                                                                                                                                 |
| `pnpm smoke:p2-01`                                                                                                                                                                                                                                                                                                                                                                    | PASS: compiled kernel restart, convergent owner exit/last departure and erased attribution detachment.                                                                                                                                                                                                                                                                                     |
| `pnpm smoke:p1-12`                                                                                                                                                                                                                                                                                                                                                                    | PASS against the final compiled implementation: API/worker restart, Personal sync/export replay, private attachment bytes, isolation, closure persistence and recovery cancellation.                                                                                                                                                                                                       |
| `Final documentation format and git diff --check`                                                                                                                                                                                                                                                                                                                                     | PASS: affected source/tooling/documentation format, targeted ESLint and final diff whitespace check.                                                                                                                                                                                                                                                                                       |

**Verified totals: 887 distinct tests (427 non-integration + 460 integration), plus four compiled restart smokes.** Targeted reruns are not counted twice.

Development checks used targeted suites; the final full gate was invoked once.
Earlier targeted typechecking found the kernel's new free-policy argument missing
from the P2-01 compiled harness; that harness was updated before the full gate.
Personal Goal responses now explicitly whitelist the existing DTO fields. The fourth
immutable M05 artifact preserves Personal creator edits without allowing shared
custody or actor attribution changes. Historical-data snapshots retain all old
columns while accepting additive columns; no preservation assertion was removed.
No dependency install/change, test weakening, skip or bypass was used.

Local ignored evidence: `.tools/p2-03-quality.log`,
`.tools/p203-targeted-final.log`, `.tools/p2-03-contract-final.log`,
`.tools/p2-03-smoke-final.log`, `.tools/p2-03-collaboration-smoke.log`,
`.tools/p2-03-kernel-smoke.log`, `.tools/p2-03-personal-smoke.log`,
`.tools/p2-03-integration-affected.log`, `.tools/p2-03-migrations-final.log`,
`.tools/p2-03-types-final.log`, `.tools/p2-03-build-final.log`,
`.tools/p2-03-migration-contracts-final.log`, plus owned `p2-03-upgrade-*` and
`p2-03-restart-*` report artifacts. Logs contain no retained invitation proof or
production credential.

Tests not run and why: Docker build/start/persistence, hosted GitHub Actions,
production-like load/soak, off-host shared restore, real SMTP delivery and launch
security/legal/operational acceptance are **NOT RUN** in this local batch. Their
applicable activation/release gates remain mandatory; no live activation settings
or real operator keys/retention policy were installed. Synthetic test policies,
keys and control references remained within isolated fixtures/processes.

Deviations from binding specs: none. The four M05 artifacts deliver one approved
batch, with feature-CHECK, ordering-index and Personal-attribution companions
required by the actual kernel ledger, pagination and existing creator contract.
P2-04/M06 and later slices are not started.

Outstanding issues / ADRs required: no local implementation blocker. No new
product decision or ADR is required. Actual immutable operator retention,
independent signing/current checkpoint, security acceptance and operational
prerequisites continue to block shared activation and production release. No
additional non-critical refactoring was added; production performance tuning and
release drills remain deferred to their required operational gate. Existing pg
concurrent-query deprecation warnings were observed in the wider integration
fixtures; their non-critical cleanup is deferred and did not fail the tests.

Git status and commits: existing dirty G0/P2-01/P2-02 work is preserved alongside
P2-03 changes. HEAD remains `6a9ccdb81e8c3b4842f1d7ea63c3531a6abbd2bb`.
Nothing committed, pushed or deployed. No production database changes.

Next eligible batch: **P2-04 — NOT STARTED; requires explicit owner approval**.
