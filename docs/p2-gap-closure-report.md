# P2-GAP-CLOSURE completion record

Batch: P2-GAP-CLOSURE. Status: COMPLETE (all applicable local gates passed after targeted corrections).
Scope implementation: all 27 approved capabilities are implemented or reused;
classification is recorded in [BACKEND_REQUIREMENTS.md](BACKEND_REQUIREMENTS.md).
The owner approved account/selected-Team key namespaces on 2026-11-16.

Modules changed: Projects application/controllers/domain; existing public Task,
Workflow and Work owners; Spaces invitation/provisioning; Notifications; typed
Prisma models; lifecycle cleanup catalog; API contracts/compatibility and tests.
New entities: TaskWorkflowDraft, ProjectRegisterDetail, ProjectFileFolder and
ProjectFileVersion. Scoped FKs, namespace uniqueness and lifecycle CHECKs accompany
the existing entity extensions.
No new dependency, competing engine, frontend implementation or deployment.
Existing custom templates and resource/guest grants remain available.

The prerequisite Company-finance/Project-disposal failure was caused by the shared
fail-closed FK catalog omitting two Personal Routine references. Exact review
reproduced the predecessor digest; both new edges are Personal-owned cascades.
The fix preserves unknown-reference rejection and strengthens the regression to
await terminal disposal, after Project row removal. Nothing is deferred to Company.

| Migration                                 | Additive changes                                                       |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| 202611150060_project_order_phase_dates    | Task order, phase dates/checks                                         |
| 202611150061_project_activity_details     | Safe event details                                                     |
| 202611150062_project_assignment_notices   | Reminder timestamp, two notice kinds                                   |
| 202611150063_workflow_drafts              | Persisted scoped drafts and version/lifecycle checks                   |
| 202611150064_project_invitation_details   | Decline note and resend time                                           |
| 202611150065_project_register_details     | Codes/checklist/closure/conversion; new-table backfill                 |
| 202611150066_project_register_comments    | Typed register comment/activity parents                                |
| 202611150067_initial_project_templates    | Nullable versioned initial setup metadata                              |
| 202611150068_project_file_library         | Scoped folders, file metadata and actual versions                      |
| 202611160069_project_key_uniqueness       | Normalized unique keys and typed namespace ownership                   |
| 202611160070_project_key_identity_erasure | Erased-owner namespace tombstone; Personal erasure remains independent |

The 84 historical SQL files are unchanged. At implementation acceptance, eleven new
migrations were applied only to isolated tests. The owner subsequently authorized
local development migration and normal commit/push on 2026-11-16. All eleven were
deployed to mehran_dev through pnpm db:migrate:deploy. Both mehran_dev and
mehran_test now have 95 successful migrations, zero unresolved failures and exact
checksums for every applied migration. Two documented historical rolled-back
development attempts from P1-09/P1-10 remain unchanged; their superseded checksums
are historical evidence, not applied-migration drift. Before/after hashes verify
all 296 original development datasets, including original columns and row counts,
are preserved exactly. Production application remains NOT AUTHORIZED/NOT RUN.
The catalog now reviews 970
FKs, with explicit cleanup order and transactional key rehoming. Old record IDs,
keys/spelling, revisions and recorded history remain unchanged by the upgrade.

API: 36 new operations, 1,092 total. Historical compatibility snapshots are kept;
exact approved transitions are separately pinned. Canonical and frontend mirror
documents agree semantically. See the full operation/DTO/auth/revision/idempotency/
pagination/error matrix and Claude wiring steps in
[PROJECTS_GAP_CLOSURE.md](frontend-handoff/PROJECTS_GAP_CLOSURE.md).

Domain events/jobs: existing Task history, Project activity, shared audit/outbox,
assignment notifications and private-file cleanup reused. No new scheduler.
Security: current scope/role/generation checks, retained-history deletion,
same-scope relationships, bounded queries, stale/concurrent writes, private proof
handling, safe field changes and authenticated private binary downloads.
Advisory health never enforces lifecycle; probability stays numeric 0–100;
capacity stays unknown without explicit authorized availability.

Implementation verification (Windows/pnpm 10.20.0, Node 24.22.1):

| Command/stage                                                               | Final result                                                                                            |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| pnpm.cmd quality: config:check, db:generate, auth:schema:check, db:validate | PASS                                                                                                    |
| pnpm.cmd quality: build                                                     | PASS, production builds of contracts and API                                                            |
| pnpm.cmd quality: format:check, lint                                        | PASS                                                                                                    |
| pnpm.cmd quality: architecture                                              | PASS, 643 modules / 4,356 dependencies                                                                  |
| pnpm.cmd quality: test                                                      | PASS, 773 tests / 171 files (unit, contract, architecture, compatibility)                               |
| pnpm.cmd quality: openapi:check                                             | PASS, 1,092 operations / 10,142 resolved references; 58 exact approved contract transitions             |
| pnpm.cmd quality: test:integration                                          | PASS, 1,091 tests / all 50 files; no filtered/skipped required coverage                                 |
| pnpm.cmd quality: db:migrations:check                                       | PASS, fresh schema, populated upgrade, all predecessor gates, repeated deploy and interruption recovery |
| pnpm.cmd typecheck (post-fix recheck)                                       | PASS, exit 0; rebuilds final contracts and checks all source/tests                                      |
| git diff --check                                                            | PASS                                                                                                    |

The final quality invocation completed every stage, but returned exit 1 because
its typecheck had caught TS7053 in the newly added route-inventory test. The test's
dynamic path lookup was typed explicitly; the complete post-fix typecheck exited 0.
All later stages of that invocation passed on the corrected source. This report
records the actual command exit and successful affected recheck rather than
claiming that initial invocation exited 0.

The populated Project rehearsal preserves all 296 predecessor datasets and all
84 historical migration checksums, tests rollback of each of the eleven new
migrations, repeated deployment, risk-code backfill and the exact 970-FK catalog.
It compares every old constraint, permitting only the exact reviewed notice-kind
extension. No configured database was reset. New source metadata does not rewrite
old IDs, revisions, keys or history.

Earlier targeted regressions also passed: original Company-finance 20/20, three
unknown-reference protections, focused Project/Team behaviors, eight route/guard
contracts, and eight stable post-fix regressions across seven integration files.
During verification, corrected shared Task-tool Date serialization, old HTTP test
expectations for recipient-only invitation proofs and account-local key conflicts,
and the migration assertion's exact PostgreSQL VARCHAR cast spelling. No required
test was removed, skipped or weakened. The final broad run supersedes initial
failing iterations.

Docker/release/live deployment checks: NOT RUN / DEFERRED, because this request
authorizes isolated local verification and explicitly excludes deployment and
Shared activation. They remain separate release prerequisites; no live result is
claimed. Outstanding batch blockers/ADRs: NONE.

Deviations: frontend requirements source is explicitly read-only, so reconciliation
is written to backend-owned docs/BACKEND_REQUIREMENTS.md. No product scope was
reduced; no later-phase feature was started. No open product ADR decision remains.

Git finalization: branch main, baseline 892b79aa2b5d3cada942e985bd1405de00a1ed34.
The owner approved committing the complete reviewed P2 change set and normally
pushing to origin/main. The exact resulting commit and remote/tree verification
are reported with finalization results; no history rewrite is authorized.
Next eligible batch: owner-selected next batch, NOT STARTED/NOT AUTHORIZED.

Account erasure: an irreversibly ERASED current owner loses the account key
namespace identity; a private erased-owner tombstone preserves the original key
and Project history without retaining the User ID or blocking Personal erasure.
Migration 070 enforces this in the existing actor-erasure and identity-FK pipeline.

## Owner-approved local finalization — 2026-11-16

Status: migration and verification COMPLETE; approved for normal main commit/push.
The working-tree paths matched the accepted P2 checkpoint exactly, with no
unexpected unrelated changes. Before finalization, remote main matched baseline
892b79aa2b5d3cada942e985bd1405de00a1ed34. Only finalization documentation changed
after implementation acceptance; no application code or tested SQL was changed.

| Exact command/check                                                   | Result                                                                                                          |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| pnpm.cmd db:validate                                                  | PASS                                                                                                            |
| pnpm.cmd db:migrate:deploy                                            | 060–070 applied to local mehran_dev; repeated deployment exited 0 with no pending migrations                    |
| Applied-ledger SHA-256 comparison with all 95 SQL files               | PASS in mehran_dev and mehran_test; no unresolved failure or applied checksum drift                             |
| Development before/after original-column row-count and content hashes | PASS for all 296 predecessor tables; historical ledger evidence also unchanged                                  |
| pnpm.cmd db:migrations:check                                          | PASS, including fresh/populated upgrade, eleven interrupted rollbacks, repeated deploy and exact 970-FK catalog |
| pnpm.cmd test:integration (ten complete relevant suites below)        | PASS, 267 tests / 10 files                                                                                      |
| pnpm.cmd typecheck                                                    | PASS, exit 0                                                                                                    |
| pnpm.cmd build                                                        | PASS, exit 0                                                                                                    |
| pnpm.cmd openapi:check                                                | PASS, exit 0; canonical snapshot unchanged                                                                      |

Integration command file arguments: apps/api/test/integration/project-core.spec.ts,
project-tools.spec.ts, project-execution.spec.ts, project-collaboration.spec.ts,
project-work.spec.ts, company-finance.spec.ts, team-work.spec.ts,
shared-collaboration.spec.ts, team-lifecycle.spec.ts and company-lifecycle.spec.ts
(all under apps/api/test/integration). No test-name filter was used. The complete
Company-finance suite includes the previously failing Project-disposal regression;
it remains resolved, with independent Company financial facts preserved.

Both local databases have 95 successful applied migrations. Development additionally
retains its two already-resolved historical rollback records, documented in
P1-09/P1-10; neither history nor superseded checksums were rewritten. Neither
configured database was reset. Frontend, production and Shared activation remain
untouched; no Teams/Phase 6 batch or new Guest Grant was started. The final commit
hash, normal push result and clean-tree verification are supplied in the owner's
finalization response and Git history.
