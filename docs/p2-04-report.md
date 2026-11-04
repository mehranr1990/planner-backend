# P2-04 implementation report

Batch: **P2-04**

Status: **COMPLETE — local implementation scope**

Authorization: owner requested publication through P2-03, then P2-04, and explicitly
continued its implementation. Prior accepted work was published as
`d0945368169baf9f97669ba420847d949533715d`; this batch remains uncommitted.

Scope implemented: primary/contributor Task assignment, named-generation explicit
consent, reasoned decline, retained reassignment/revocation history, source-owner
Task/Goal work projections, selected-project calendar overlays, optional typed
private scheduling links, current assignment policy and durable in-app notices.
Existing Personal, Shared Space kernel, membership/invitation and P2-03 contracts
are preserved. No source copies, Company/Team execution, automatic organizational
consent, new commercial denial or P2-05 work was introduced.

Files/modules changed: Projects WorkService/controller and pure assignment domain;
Tasks/Goals public source projection/scheduling facades; Calendar private-link
facade and reference-only export; Notifications shared-work inbox facade; Spaces
current-recipient/policy, filtered hints and Personal-only transaction support;
strict Zod/OpenAPI, compatibility baseline, M06, populated upgrade and compiled
restart/CI tooling. The [G2 contract](p2-04-contract.md) maps all nineteen operations
to current authorization, invariants and acceptance tests.

Entities, migrations and constraints: TaskAssignment,
SharedAssignmentNotification and TimeBlockSharedTaskLink; 98 Prisma models,
99 tables including the ledger, 33 migrations. M06 is
`202611040009_task_assignment`; frozen SHA-256
`c0bc4222627cb82f70cdb85a513f70464575494a456a46f0719113c235063e7c`.
All 32 historical migration bytes remain unchanged. The
[migration review](p2-04-migration-review.md) covers typed source/scope/actor and
generation FKs, current-primary/recipient uniqueness, immutable consent history,
mutually exclusive private/shared links and lock/rollback limits. Targeted populated
upgrade preserved all 95 prior table data sets, 32 checksums and 1,473 catalog
constraints except the single reviewed usage-feature CHECK extension. Exact
rollback/resume/repeat deploy passed; local measured M06 deployment was 760 ms,
not a production-scale performance claim. Verification uses guarded test databases
and owned schemas; configured development/production databases were not migrated.

API contracts, domain events and jobs: nineteen new operations on fifteen new
paths. Canonical `docs/api/openapi.json` has 243 paths, 363 operations and 2,866
valid local references; all prior signatures remain compatible. Assignment changes
atomically record notices, audit, shared outbox, usage and authorization versions.
The new notices are durable in-app effects; no email/push send or new queue/provider
was added. Personal reminder delivery and worker behavior remain unchanged.
The compiled smoke verifies fresh worker bootstrap with the extended module graph.

Security and edge cases addressed: current verified accounts/sessions, role and
ordinary-policy ceilings, exact recipients/generations, stale source/assignment
revisions, lasting creation/terminal replay, typed foreign references, unique
primary and independent contributor consent, metadata-only notifications,
free-mode atomic denial, signed actor/query/scope/version cursors, source filters
before pagination, narrow Goal grants/current issuer/expiry, revoked/suspended/
readmitted/closed participants, observed revoke-first and acceptance-first races,
Personal block ownership, source-unavailable retention/unlink and reference-only
export. Private source bodies, Focus, Journal and Finance are not read into shared
projections or copied into Personal sync. Ambiguous restrictive outcomes remain
quarantined instead of being assumed aborted.

Tests and exact commands/results (pinned pnpm 10.20.0 and workspace COREPACK_HOME):

| Command                                                                                                                                                                                                                                                                                                    | Actual result                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node --env-file-if-exists=.env.test.local node_modules/vitest/vitest.mjs run --project integration apps/api/test/integration/project-work.spec.ts`                                                                                                                                                        | PASS: all 17 targeted cases; 25.43 seconds before the final source-read guard addition, which is covered again by final integration.                                                                          |
| `node node_modules/vitest/vitest.mjs run --project unit packages/api-contracts/src/work.spec.ts apps/api/src/modules/projects/domain/task-assignment.spec.ts --project contract apps/api/test/contract/work-routes.spec.ts --project architecture tooling/architecture-tests/assignment-migration.spec.ts` | PASS: 20 tests in four files.                                                                                                                                                                                 |
| `pnpm quality`                                                                                                                                                                                                                                                                                             | PASS: all 13 mandatory stages in one orchestration, exit 0. No full-suite rerun was needed.                                                                                                                   |
| `pnpm config:check`, `pnpm db:generate`, `pnpm auth:schema:check`, `pnpm db:validate`, `pnpm build`, `pnpm typecheck`, `pnpm format:check`, `pnpm lint`, `pnpm architecture`                                                                                                                               | PASS in the full gate.                                                                                                                                                                                        |
| `pnpm test`                                                                                                                                                                                                                                                                                                | PASS: all 447 tests in 71 files.                                                                                                                                                                              |
| `pnpm openapi:check`                                                                                                                                                                                                                                                                                       | PASS: reviewed snapshot, local references and all frozen compatibility baselines.                                                                                                                             |
| `pnpm test:integration`                                                                                                                                                                                                                                                                                    | PASS: all 477 tests in 25 files; 154.70 seconds.                                                                                                                                                              |
| `pnpm db:migrations:check`                                                                                                                                                                                                                                                                                 | PASS: history/status, empty replay, owned-schema reset, populated Personal/kernel/P2-02/P2-03/M06 upgrades, old constraints/checksums, exact interruption/resume and repeat deploy.                           |
| `pnpm smoke:p2-04`                                                                                                                                                                                                                                                                                         | PASS against the final compiled implementation: API restart, fresh worker, durable consent replay, source projections, timezone overlay, inbox and retained private block after revocation; no source copies. |
| `pnpm smoke:p2-03`                                                                                                                                                                                                                                                                                         | PASS against the final compiled implementation: source API restart/replay, expiry once, lifecycle and retained sources.                                                                                       |
| `pnpm smoke:p2-02`, `pnpm smoke:p2-01`, `pnpm smoke:p1-12`                                                                                                                                                                                                                                                 | PASS: kernel exit/erasure convergence; invitation/handover restart and authorized replay; Personal API/worker sync/export restart, private attachment bytes, closure persistence and recovery cancellation.   |
| Final documentation format and `git diff --check`                                                                                                                                                                                                                                                          | PASS: final report/contract/execution/migration documentation format and tracked diff whitespace check.                                                                                                       |

**Final totals: 924 distinct tests (447 non-integration + 477 integration), plus five compiled restart smokes.** Targeted runs are not counted twice.

Development used targeted checks. Initial runs corrected optional TypeScript
property typing, the existing audit-action name, a rollback fixture that needed a
known transaction-abort exception, timed private-block fixture shape, and empty
scope/source-unavailable handling. Calendar filtering now uses authoritative source
owner dates with exact Intl local-date checks before pagination. No required test
was weakened, skipped or bypassed. Only one full gate was invoked.

Local ignored evidence: `.tools/p2-04-quality.log`,
`.tools/p2-04-work-targeted.log`, `.tools/p2-04-contract-targeted.log`,
`.tools/p2-04-upgrade-targeted.log`, `.tools/p2-04-smoke-final.log`,
`.tools/p2-04-project-smoke.log`, `.tools/p2-04-kernel-smoke.log`,
`.tools/p2-04-collaboration-smoke.log`, `.tools/p2-04-personal-smoke.log` and owned `p2-04-upgrade-*` /
`p2-04-restart-*` report artifacts. Test configuration/proofs are synthetic and
confined to isolated schemas/processes; no real operator policy/key was installed.

Tests not run and why: Docker build/start/persistence, hosted GitHub Actions,
production-like load/soak, off-host shared restore, real SMTP delivery and launch
security/legal/operational acceptance are **NOT RUN** in this local batch. Their
activation/release gates remain mandatory. Shared activation stays gated by real
operator-approved immutable retention, independent signing/current checkpoint,
security acceptance and operational prerequisites.

Deviations from binding specs: none. Assignment policy uses the approved current
capability policy and explicit consent in independent Projects; mandatory Company
assignment cannot execute before that domain exists. No new product ADR is needed.
Non-critical performance tuning and pre-existing pg concurrent-query warning
cleanup are deferred; they do not waive launch/load requirements.

Outstanding issues: no local implementation blocker. No deployment or production
change was performed. No additional batch was started.

Git status and commits: P2-04 changes remain uncommitted and unpushed. HEAD stays
`d0945368169baf9f97669ba420847d949533715d`. Pre-existing untracked
`docs/architecture/` and `docs/frontend-handoff/` files are preserved untouched.

Next eligible batch: **P2-05 — NOT STARTED; requires owner acceptance/authorization**.
