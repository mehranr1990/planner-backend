# P4-02 local implementation report

Batch: **P4-02 — Staff work profiles, confidential employee cases, basic
availability and resource/equipment allocation**. Status: **COMPLETE for local
implementation**, 2026-11-07. Shared activation and production acceptance remain
separately gated.

Approved predecessor publication: reviewed and published exactly 55 P4-01 manifest
files to origin/main as `6a217535b848d68adeef916cff3cbe3f02b4faa2`, verified
with `git ls-remote`. Its predecessor remains
`50631a0b3a2c3b0768212f0441b223d6e47c709f`. Additional focused P4-01 checks:
13 policy/schema/route/migration/compatibility tests and 24 Company integration
tests passed. Unrelated documentation and runtime/environment files were excluded.

Scope implemented: approved ADR 0035 permissions; administrative work profiles and
subject-only verified contact consent/withdrawal; explicit daily availability;
resource management and exclusive half-open allocation, cancellation/return and
retirement; confidential cases with distinct author/subject/named reviewer,
responses/appeals/reviews and irreversible privacy redaction. See
[operation contract](p4-02-contract.md) and
[approved ADR 0035](adr/0035-company-staff-confidentiality-and-allocation.md).

Files/modules changed: **43 files**. Companies services/context/controllers and
public facades; strict transport schemas/OpenAPI; Spaces-owned bounded current
membership/identity contracts and narrow Company erasure callback; migration,
compatibility and compiled smoke fixtures. Existing auth, Shared fences, receipts,
usage, audit/outbox, signed evidence and restrictive restore are reused. No new
dependency. The old P2 smoke bootstrap receives the new explicit dependency.

Entities, migrations and constraints: **six Company-owned entities, one additive
M030 migration**, same-Company/context and admission-interval FKs, immutable
identity/history, revision guards, irreversible redaction and database-serialized
overlap checks. SQL owns the partial allocation index. All **53 predecessor SQL
artifacts remain unchanged**. Rehearsal preserves 151 predecessor datasets and
populates all six new tables; final state is 157 domain tables and 455 FKs.
Exact reviewed migration/catalog hashes: [migration review](p4-02-migration-review.md).

API contracts, domain events and jobs: **25 additive operations; 582 total and
5,056 resolved references**, in `docs/api/openapi.json`. Every predecessor
signature, including all 557 P4-01 operations, is retained. Opaque Company effects
use existing Shared audit/outbox and six free-mode usage kinds. No new job, queue,
worker entrypoint, external provider or integration.

Security and edge cases: current verified identity/session, explicit root/child
generations, scoped managers, no general Owner/Org Admin case visibility, distinct
current reviewer, Viewer subject response/appeal, consented current work contact,
non-enumerating cases/counts/nested IDs, stale cursors/receipts and rejoin denial.
Observed independent PostgreSQL waiters cover raw overlap and both revoke/write
orders plus revoke/confidential-read ordering. Rollback preserves atomic
source/receipt/usage/audit effects. Subject profile/case redaction and Personal
identity erasure clear sensitive payloads while retaining opaque integrity records.
Signed restrictive evidence and CLOSED Company scopes prevent restored data access.
Case history is capped at 1,000 total entries per Company, bounding erasure work;
these are technical safety bounds, independent of commercial enforcement.

Tests and exact commands/results:

| Command / retained evidence                                                                                                                                                                                                                                                                                                            | Observed result                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm.cmd quality`; `.tools/p4-02-quality.log`, `p4-02-quality-result.json`                                                                                                                                                                                                                                                            | **All 13 stages executed once**. Raw full-run exit **1** is preserved: old P2 smoke constructor type error and one five-second compatibility timeout. Other stages passed, including build, formatting, lint, architecture (**467 modules / 2,922 dependencies**), OpenAPI, **709/709 integration tests** and every migration assertion through M030. Initial non-integration result: **569 passed / 1 timed out of 570**. Affected results below resolve both failures. |
| `pnpm.cmd typecheck`; `pnpm.cmd exec tsc -p apps/api/tsconfig.build.json`; final-types / api-build logs                                                                                                                                                                                                                                | **PASS / exit 0**, including the final source and legacy bootstrap.                                                                                                                                                                                                                                                                                                                                                                                                      |
| `pnpm.cmd test:integration apps/api/test/integration/company-staff.spec.ts`; final-integration log                                                                                                                                                                                                                                     | **27 passed**, including the final aggregate history-bound regression; no full integration rerun.                                                                                                                                                                                                                                                                                                                                                                        |
| `pnpm.cmd exec vitest run --project unit --project contract --project architecture --project compatibility packages/api-contracts/src/company-staff.spec.ts apps/api/test/contract/company-staff-routes.spec.ts tooling/architecture-tests/company-staff-migration.spec.ts tooling/compatibility/openapi.spec.ts`; final-contracts log | **11 passed**. All historical compatibility keys are compared through one complete union, with conflicting repeated keys rejected. Repeated current-document generation/hashing is removed; the timeout and coverage remain unchanged. All 25 real handlers, error schemas and reviewed migration bytes are checked.                                                                                                                                                     |
| `pnpm.cmd db:generate`; `pnpm.cmd db:validate`; schema-final / schema-validate logs                                                                                                                                                                                                                                                    | **PASS / exit 0** for the final Prisma schema. The full gate's migration stage preserves all 151 populated predecessor datasets, 53 checksums and all prior constraints except the reviewed usage allowlist extension; interrupted rollback, repeated deploy, six populated new tables and final FK digest all **PASS**.                                                                                                                                                 |
| `pnpm.cmd smoke:p4-02`; compiled-final log                                                                                                                                                                                                                                                                                             | **PASS / exit 0** after final compilation. Fresh process restart preserves staff/contact/availability/case/allocation records, enforces confidential readers, overlap, return/retirement and redaction, preserves independent Project/Team custody and runs existing Shared invitation maintenance. Fixture signup/signin respects the real provider throttle; no limit was disabled.                                                                                    |
| `pnpm.cmd openapi:check`; openapi-final log                                                                                                                                                                                                                                                                                            | **PASS / exit 0**; generated JSON matches actual contracts and all frozen baselines.                                                                                                                                                                                                                                                                                                                                                                                     |
| Targeted ESLint/Prettier, `git diff --check`, preservation verification                                                                                                                                                                                                                                                                | **PASS** for implementation checks; final report formatting/preservation is verified at submission.                                                                                                                                                                                                                                                                                                                                                                      |

Final local acceptance: **1,280 distinct passing tests — 570 non-integration and
710 integration scenarios**, across the single full gate and affected runs. The
additional integration scenario is the final aggregate erasure-bound regression.
Original failures and logs remain retained; no test, timeout, architecture rule,
privacy assertion or compatibility baseline was skipped or weakened.

Tests not run and why: Docker/WSL, hosted CI, deployment, production migration and
release-only operational/backup/activation gates **NOT RUN / DEFERRED** per owner.
DDL ran only against guarded isolated local PostgreSQL targets; no configured
application database reset, production database change or deployment.

Deviations from binding specs: **none**. Outstanding owner decisions/ADRs and local
implementation blockers: **none**. Remaining limitations: no Company upload/file
attachment, integration, finance, export or Team/Project attachment. Full Company
restore reconciliation, retention disposal and lifecycle remain P4-06/release gates.
Sensitive cases hold text evidence; no document upload or public storage is added.

Git: **43 P4-02 files remain unstaged, uncommitted and unpushed**. HEAD remains the
published P4-01 SHA above. **17 protected unrelated/environment files and all 53
historical migration bytes are preserved**. New synthetic runtime evidence stays
excluded from Git. Shared remains disabled.
Next eligible batch: **P4-03 — NOT STARTED; separate authorization required**.
