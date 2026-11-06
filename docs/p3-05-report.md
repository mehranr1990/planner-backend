# P3-05 local implementation report

Batch: **P3-05 — Independent Team lifecycle and final Phase 3 acceptance**.
Status: **COMPLETE for local implementation**, with one mandatory quality run
and affected reruns. Phase 3 is submitted for consolidated local acceptance;
Shared activation and release remain gated.

Scope implemented: accepted successor/password handover; authorized read-only
archive/restore; sole-custodian/last-member 30-day closure, proof/password/generation
recovery; frozen owner-account exit and independent Personal erasure; retention,
bounded resumable cleanup, cross-context/source isolation and local performance.
Shared infrastructure is reused; no Company association or Shared activation.

Files/modules changed: Team lifecycle service/controller and cleanup consumer;
Shared lifecycle kind discrimination, existing fences/epochs; narrow Calendar and
Projects owner cleanup facades; worker/admin dispatch; strict contracts/OpenAPI,
compatibility baseline, migration rehearsal, integration/contract/architecture
tests and compiled restart tooling. No new dependency or unrelated refactoring.
See [contract](p3-05-contract.md), [migration review](p3-05-migration-review.md)
and [consolidated Phase 3 acceptance](phase-3-acceptance.md).

Entities, migrations and constraints: no new entities/columns/FKs. Migration
`202611060027_team_lifecycle` extends only the existing purge function's custody
kind predicate to TEAM, preserving every deadline/lease/membership safeguard.
All 50 historical migration artifacts and original constraints remain intact.
DDL runs only against guarded isolated local PostgreSQL targets.

API contracts, domain events and jobs: **12 additive operations; 534 total and
4,576 resolved references**. All published signatures through P3-04 are frozen.
Opaque-ID signed Team archive/restore/delete and existing handover/recovery/
lifecycle audit/outbox effects; worker consumes Team jobs through existing lease,
retry, retention and physical-file acknowledgement machinery. Confidential bodies
and provider credentials never enter control evidence.

Security and edge cases addressed: current authority before receipts/cursors;
no Owner-based confidential access; archive/restore/recovery invalidates old
disclosures/invitations and authorizations; observed archive/write, recovery/purge
and competing-handover lock waits; no automatic promotion or deletion after owner
account exit. Cleanup removes Team reference metadata by teamId and preserves
independent Project/Personal roots and other Teams' references. Holds and unexpected
FKs fail closed; task passes are bounded at 200 and resume without source transfer.

Tests and exact commands/results:

| Command / evidence                                                                                                                                                                                                                                                                                                   | Result                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd quality`, `.tools/p3-05-quality.log` and `p3-05-quality-result.json`                                                                                                                                                                                                                                       | All 13 mandatory stages executed **once**. Config, generation, auth schema, schema validation, build, typecheck, format, lint, architecture and populated migration gate passed. **555 non-integration tests passed; 658 integration tests passed and one race assertion failed.** OpenAPI snapshot also needed regeneration; outer exit was 1. Both affected checks are resolved below. |
| `pnpm.cmd openapi:generate`; `pnpm.cmd openapi:check`; `pnpm.cmd compatibility`                                                                                                                                                                                                                                      | **PASS**, including 8 compatibility checks against all published baselines. Snapshot was generated before the final contracts build and differed only in the empty-body requirement of new routes. No existing operation changed.                                                                                                                                                        |
| `pnpm.cmd test:integration apps/api/test/integration/team-lifecycle.spec.ts -t 'RACE winning purge claim'`, `.tools/p3-05-race-affected.log`                                                                                                                                                                         | **1 passed** after making the assertion account for the existing exact staging-integrity denial, then additionally requiring settled 409, PURGING custody, LEFT membership and invalidated proof. Runtime guards and signing code unchanged.                                                                                                                                             |
| `pnpm.cmd test:integration apps/api/test/integration/team-lifecycle.spec.ts`                                                                                                                                                                                                                                         | Targeted development established the first 16 scenarios; expanded suite covered 19. Fixture UTC, hold shape, expected denials and child-first bounded passes were corrected; only affected closure/batch cases rerun afterward. Final gate exercised all 19.                                                                                                                             |
| `pnpm.cmd exec vitest run --project unit --project contract --project architecture --project compatibility packages/api-contracts/src/team-lifecycle.spec.ts apps/api/test/contract/team-lifecycle-routes.spec.ts tooling/architecture-tests/team-lifecycle-migration.spec.ts tooling/compatibility/openapi.spec.ts` | **8 passed** targeted contract, strict validation, all 12 real handlers, migration pin and compatibility tests.                                                                                                                                                                                                                                                                          |
| `pnpm.cmd exec tsc --noEmit`; targeted ESLint; changed-file Prettier; `git diff --check`; `.tools/p305-prepare.cjs`                                                                                                                                                                                                  | **PASS**. Protected files and predecessor migration bytes retained; no staged P3-05 files.                                                                                                                                                                                                                                                                                               |

Final acceptance evidence: **1,214 distinct passing tests — 555 non-integration
and all 659 integration scenarios across the single gate and affected rerun**.
Architecture: **452 modules / 2,811 dependencies**, zero violations. Migration
gate: empty replay, every predecessor/security-closeout upgrade, 146 preserved
predecessor datasets, 50 immutable checksums, unchanged constraints, interrupted
rollback and repeated deployment; purge function changes only custody-kind predicate.
No mandatory test, security check, assertion of access denial or timeout was removed.
The full quality run was not repeated to change its recorded failing exit code.

Local synthetic performance: 1,000 Team tasks, pages of 100, ten samples;
page p50 **25.48 ms**, p95 **27.57 ms**, authorized portfolio **55.19 ms**.
Evidence: `.tools/p3-05-performance.json`. These measurements establish a repeatable
local baseline, not an approved production SLO/load test.

`pnpm.cmd smoke:p3-05`: **PASS** — fresh compiled API archive/read-only/restore,
password/proof recovery; fresh compiled lifecycle-consumer resumes persisted cleanup
and preserves independent Project source. It does not claim a production worker
or pg-boss release deployment. Original synthetic evidence is retained in `.tools`.

Tests not run and why: Docker/WSL, deployment, production/release-only/off-host
backup/restore and Shared activation **NOT RUN / DEFERRED** per owner. No production
database modified; no configured local database reset. No redundant old smoke run.

Deviations from binding specs: none. No new product rule or ADR required. Existing
versioned retention and Shared activation/security release gates remain binding.
Outstanding local blockers: none. The strict existing integrity guard may transiently
deny a read while atomic hard-link publication exposes staging and published names;
callers can retry after publication. This batch preserves that guard and proves no
recovery or authority is restored through the race. Production availability/load
acceptance remains deferred.

Git status and commits: approved P3-04 reviewed, committed and pushed as
`9486dc86a9566e416e474556326df0b4312785b8`, verified against `origin/main`.
P3-05's 42 changed/new files remain unstaged, uncommitted and unpushed. Preservation
verification retained 17 protected unrelated/environment files and all 50 historical
migration artifacts; runtime artifacts remain excluded and untouched except new
isolated test evidence. Phase 2 security closeout remains in committed history.

Next eligible batch: **P4-01 — NOT STARTED, separate authorization required**.
