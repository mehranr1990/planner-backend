# Platform Admin P3 work record

Updated 2026-11-25. Status COMPLETE — LOCAL DEVELOPMENT. Owner authorized P3 local backend implementation after P2 publication, without further implementation checkpoints. The owner subsequently authorized committing and pushing the existing implementation on 2026-11-25; the publication excludes the owner's compose.yaml. The verification and Git checkpoints below describe the pre-publication state. P4, frontend work, E2E tests, subagents and deployment were not started.

## Boundary and verification baseline

P2 accepted by the owner and pushed to origin/main as `8bfba88`. Its 86-file commit excludes compose.yaml, secrets and local configuration. All eleven P2 migration bytes match the index and applied isolated-test ledger. The 126 predecessor SQL files match P1. Focused P2 migration review passed 1/1. Reuse P2's final full checkpoint and corrected affected reruns as baseline evidence.

Owner compose.yaml SHA-256: `C42657021CD05DA9AD7412DD67E675470B8029FFDABCCB4B55035A363623CF20`. Preserve exactly.

Read-only publication inspection found a pre-existing isolated-test M084 ledger discrepancy (details in P2 record). Do not rewrite SQL/checksums or reset the database. Use newly owned isolated schemas for P3 migration verification; separately report the existing ledger issue.

## Implementation plan and acceptance checklist

- System Health: measured API/dependency indicators, worker heartbeat, permissioned checks, fixed safe repair catalog, threshold/severity/channel/repeat/silence policies, deduplicated incident start/recovery and append-only notes.
- Jobs: bounded metadata for supported queues and states, no raw payload/error disclosure; durable, idempotent allowlisted controls with retry bounds; validated recurring sweep schedule and retention policy.
- Storage: aggregate scope/type/day usage, real capacity indicators, warn/grace/block admission without file deletion, retained orphan/temporary preview and revalidated bounded cleanup. Explicit Super Admin private-file capability, exact file/scope validation, scan/hash safety, secure streams and persisted access outcomes.
- Backup & Restore: scheduled/manual operational requests and recorded progress; coordinated existing backup tooling with encryption/off-host/checksum evidence; distinct restore approval, expiring reviewed target, operator-only execution, independent status and mandatory replay/readiness before reopening.
- Preserve P0–P2 authorization, seven-day ordinary recovery, historical signed deadlines, custody, retention holds and restore fences. No Client API break.

Contracts and controllers belong to platform operations and use the existing Admin realm/command/audit boundary. File ownership remains in platform storage. Queue administration uses the pinned pg-boss schema/API. Restore APIs authorize an operator workflow and never accept shell/SQL/paths or perform a live restore.

Batch related changes before targeted tests. Run the complete applicable local acceptance gates at phase end, reuse unchanged artifact/evidence inputs, and rerun only affected failures. Actual commands/results and remaining release-only checks will be recorded below.

## Implementation checkpoint

Implemented the four requested areas through 24 explicit Admin operations, eleven additive control tables and one detached audit file-ID column in M112. Policy publication uses reviewed revisions; job dispatch/receipts share one PostgreSQL transaction. Storage capacity checks apply to the common byte writer/publication path. Spaces owns the injected private-file custody/ancestor check; Storage owns immutable bytes, scan evidence and orphan references. No Admin membership or general content search was added. Backup/restore has a fixed operator console and signed independent maintenance/status; no HTTP restore execution, operator completion or arbitrary-command route.

The operator can claim/capture queued backups through the fixed coordinated script, seal/copy/verify ciphertext, claim a two-person restore and verify an isolated restored target against current restrictive controls. Off-host failure-domain attestation, physical expiry, live Docker/scanner and actual production RPO/RTO remain deployment gates. [Operational runbook](runbooks/platform-admin-operations.md), [ADR 0074](adr/0074-platform-admin-p3.md).

Initial targeted verification: 7 operations/migration-review tests passed; 11 operations/file-policy unit tests passed; initial P3 PostgreSQL suite passed 14/14. Fresh owned-schema migration deployment passed with 1,198 FKs, SHA-256 `9077bb4de8abcd51704d71cabee07adfa375e46bf6087f3e6b79953b155755f5`. The twelve new edges stay entirely in Admin/operational state, with no customer-custody references.

The first fixture teardown exceeded PostgreSQL's single-transaction lock budget. The harness now rejects external FK references and drops only newly owned fixture tables in bounded statements before dropping its namespace. The exact recorded initial fixture was subsequently cleaned successfully; no application database was reset. A typecheck exposed strict optional types and build-order imports, corrected during implementation. An ad-hoc compiler invocation without the repository's 8 GiB heap allowance exhausted its default heap; subsequent checks use the approved heap setting. An intermediate backend build passed; further implementation changes require final validation.

Additional targeted tests cover Shared file scope authority, outcome-specific job retention, changed orphan references, export keys and interrupted operator leases. This paragraph records the implementation checkpoint; final acceptance evidence follows below.

## Final verification and corrections

The complete repository checkpoint ran once: 951 passed and one handoff-equality failure. The API generator writes only docs/api/openapi.json; the handoff snapshot was synchronized and formatted, and the affected compatibility suite passed 1/1. The current document has 1,408 operations and 13,001 resolved references. Existing Client compatibility checks passed.

The complete PostgreSQL checkpoint ran once: 1,270 passed, two failed and one conditional live-ClamAV skip. One failure observed the earlier Company-root file check in the in-flight run's compiled module; the corrected check distinguishes Company root from Department/Unit ancestry. The existing Company disposal fixture failure came from two Date.now() reads occasionally producing a millisecond mismatch against the exact recovery-window CHECK. Its time shift now preserves and asserts the actual seven-day Company window using a single captured instant. No production lifecycle/retention behavior or constraint was changed.

Both affected integration files subsequently passed all 33 tests, including all 21 P3 tests, exit 0. The final deterministic Company clock case also passed after that fixture correction. These affected reruns combine with the unchanged successful suites to verify all 952 repository tests and 1,272 runnable PostgreSQL tests. The complete checkpoint commands themselves returned exit 1 as recorded; they were not relabeled as successful full invocations.

The final module review moved export-reference inspection to Account's public metadata function, injected into Storage without a cycle. Spaces similarly owns the file custody/ancestor check. Independent status writes flush the file and fsync the renamed directory on Linux, matching the existing control-store durability pattern. Affected builds, final type checks, lint and architecture passed after these changes. The status unit and actual operator emergency-pause/status smoke passed with PostgreSQL deliberately unreachable, including restart persistence and corrupt-state refusal.

The final migration gate passed, including all prerequisite rehearsals and the explicit populated P2→P3 rehearsal: 368 predecessor table data sets, 137 historical ledger rows, M112 interruption rollback/resume/repeat and all 1,198 reviewed FKs. The existing isolated-test namespace also has the exact reviewed FK digest. Historical SQL/ledger rows were not rewritten. M112 SHA-256: `b3735fdac10fc413af18de8ae61b2775c8b9725cb889b0320ac89bae7129bf82`.

| Exact command                                                                                                        | Result                                                                                      |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `pnpm.cmd config:check`                                                                                              | exit 0                                                                                      |
| `pnpm.cmd db:generate`                                                                                               | exit 0 after final schema inputs; reused unchanged generated client in the final checkpoint |
| `pnpm.cmd auth:schema:check`                                                                                         | exit 0                                                                                      |
| `pnpm.cmd db:validate`                                                                                               | exit 0                                                                                      |
| `pnpm.cmd build`                                                                                                     | exit 0, including the final durable-control build                                           |
| `pnpm.cmd typecheck`                                                                                                 | exit 0, including the final Company fixture correction                                      |
| `pnpm.cmd lint`                                                                                                      | exit 0; affected source/test lint reruns also exit 0                                        |
| `pnpm.cmd architecture`                                                                                              | exit 0 after final module graph, 778 modules / 5,401 dependencies                           |
| `pnpm.cmd test --maxWorkers=1`                                                                                       | exit 1, 951 passed / one handoff failure                                                    |
| `pnpm.cmd exec vitest run --project compatibility tooling/compatibility/project-gap.spec.ts --maxWorkers=1`          | exit 0, 1 passed after handoff correction                                                   |
| `pnpm.cmd openapi:generate`                                                                                          | exit 0; generated snapshot reviewed and handoff synchronized                                |
| `pnpm.cmd openapi:check`                                                                                             | exit 0                                                                                      |
| `pnpm.cmd test:integration`                                                                                          | exit 1, 1,270 passed / two failures / one live-ClamAV skip                                  |
| `pnpm.cmd test:integration platform-admin-operations.spec.ts company-gap.spec.ts`                                    | exit 0, 33 passed                                                                           |
| `pnpm.cmd test:integration company-gap.spec.ts -t "disposes controlled budget"`                                      | exit 0, corrected clock case passed                                                         |
| `pnpm.cmd exec vitest run --project unit apps/api/src/platform/operations/operations-control.spec.ts --maxWorkers=1` | exit 0, durable independent-status case passed                                              |
| `pnpm.cmd db:migrations:check`                                                                                       | exit 0, including populated P2→P3 preservation                                              |

`pnpm.cmd format:check` passed in the full checkpoint. The completion scan later flagged only the edited P3 integration file; it was formatted, then `pnpm.cmd exec prettier --check apps/api/test/integration/platform-admin-operations.spec.ts docs/platform-admin-p3-work-record.md docs/platform-admin-implementation-progress.md PLATFORM_ADMIN_MASTER_SPEC.md` passed, exit 0. Unchanged full-scan formatting evidence is reused under section 16. The available Git shell also passed `-n deploy/backup.sh`, exit 0, without executing Docker or deployment.

Final `git diff --check` passed, exit 0. The index is empty. HEAD and origin/main both resolve to `8bfba88b47196c5e0eaa9e993bdf43e7b336b62d`. The owner's compose.yaml still hashes to `C42657021CD05DA9AD7412DD67E675470B8029FFDABCCB4B55035A363623CF20`. No historical SQL is modified; only the new M112 directory is present. No secret/local-configuration paths are in the changed or untracked inventory. Detailed local command logs remain ignored under .tools.

## End-of-phase report

- Batch: Platform Admin P3. Status COMPLETE for local development.
- Scope implemented: System Health, Jobs, Storage, Backup & Restore; 24 explicit Admin operations and a trusted operator console.
- Files/modules: platform/operations; existing Admin, storage, jobs, worker, mail and bootstrap integration; Spaces and Account public metadata boundaries; API contracts, generated handoff, ADR 0074 and operational runbooks. The sole legacy test correction is the Company fixture's exact clock shift.
- Entities/migrations/constraints: eleven operational control tables and a nullable detached audit file target; additive exact-byte-reviewed M112; immutable notes/previews/terminal evidence, distinct restore approver, frozen backup retention and lease/state constraints. Twelve new FKs enter only Admin/operational state.
- API contracts/events/jobs: 24 routes listed below; no breaking Client API change. Existing authoritative sweep/outbox signals and pinned pg-boss handle safe controls; durable operational alerts, backup requests and independent restore status. No new customer-domain event or blind erasure/payment/restore retry.
- Security/edge cases: explicit Super Admin private-file permission and current MFA; exact Space/scope and Company ancestry, active custody, malware/hash and streaming authority checks; audited target/outcome; isolation, concurrent idempotency, stale revisions/references, preserved exports, queue attempt limits and fail-closed restore/lease recovery.
- Tests/results: all 952 repository and 1,272 runnable PostgreSQL tests verified through the complete checkpoint plus documented affected reruns; mandatory code, architecture, contract and migration gates passed on final affected inputs.
- Not run/deferred: real Docker capture/restore, live off-host failure-domain/expiry evidence, production RPO/RTO, production SMTP/topology and live ClamAV smoke (CLAMAV_SMOKE_HOST absent). No E2E/frontend tests or deployment were authorized. Local synthetic crypto fixtures do not claim physical off-host or production readiness.
- Deviations: none from approved product scope. Current limits/defaults and operator-only execution are documented in ADR 0074 and the runbook. No new provider/dependency or Client frontend change.
- Outstanding issues/ADRs: no P3 local implementation blocker. The pre-existing isolated-test M084 ledger discrepancy is preserved and still needs separate review before release/history reconciliation. Operational deployment gates remain mandatory.
- Git: P2 accepted and pushed as `8bfba88`; P3 unstaged/uncommitted/unpushed. Owner compose.yaml remains outside this phase's changes and retains its initial checksum. Secrets, local configuration and unrelated files are excluded.
- Next eligible phase: Platform Admin P4, NOT STARTED; separate approval required. P3 commit/push likewise requires separate approval.

## Route and permission inventory

Paths are relative to `/api/v1/admin/`. Lists are bounded; private-file queries bind physical Space and logical scope. Mutations require recent MFA, trusted Origin and Idempotency-Key.

| Method and path                             | Explicit permission                |
| ------------------------------------------- | ---------------------------------- |
| `GET operations/health`                     | `admin.health.read`                |
| `POST operations/health/check`              | `admin.health.check`               |
| `POST operations/health/repair`             | `admin.health.repair`              |
| `GET operations/incidents`                  | `admin.health.read`                |
| `GET operations/incidents/:id/notes`        | `admin.health.notes`               |
| `POST operations/incidents/:id/notes`       | `admin.health.notes`               |
| `GET operations/policies`                   | `admin.operations.policy.read`     |
| `POST operations/policies/preview`          | `admin.operations.policy.publish`  |
| `POST operations/policies/:id/publish`      | `admin.operations.policy.publish`  |
| `GET operations/jobs`                       | `admin.jobs.read`                  |
| `GET operations/job-controls/:id`           | `admin.jobs.read`                  |
| `POST operations/jobs/run`                  | `admin.jobs.run`                   |
| `POST operations/jobs/:id/retry`            | `admin.jobs.retry`                 |
| `POST operations/jobs/:id/cancel`           | `admin.jobs.cancel`                |
| `GET operations/storage/usage`              | `admin.storage.read`               |
| `POST operations/storage/cleanup/preview`   | `admin.storage.cleanup`            |
| `POST operations/storage/cleanup/:id/apply` | `admin.storage.cleanup`            |
| `GET operations/storage/files/:id/content`  | `admin.storage.private_files.read` |
| `GET operations/backups`                    | `admin.backups.read`               |
| `GET operations/backups/:id`                | `admin.backups.read`               |
| `POST operations/backups`                   | `admin.backups.request`            |
| `GET operations/restores`                   | `admin.restores.read`              |
| `POST operations/restores`                  | `admin.restores.request`           |
| `POST operations/restores/:id/approve`      | `admin.restores.approve`           |
