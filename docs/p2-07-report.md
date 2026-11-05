# P2-07 implementation report

Batch: **P2-07**. Status: **COMPLETE for local implementation**.

Owner accepted this completed local scope and authorized review, commit and push
on 2026-11-05. This does not authorize deployment, Shared activation or Phase 3.

- Completed local scope: versioned documents, typed comments/history, private
  scoped files, metadata activity, six authorized source views, bounded exports,
  explicit consented source transfer and recoverable bounded shared cleanup.
- Files/modules: Projects controllers/application services; Tasks/Goals source
  transfer and cleanup public facades; Calendar/Notifications cleanup facades;
  Spaces fencing/lifecycle; Storage shared branch; worker maintenance; contracts,
  migration review, upgrade fixture, compiled restart smoke and CI.
- Entities/migrations: eight new domain tables, five reviewed migrations,
  43 migration artifacts in total. Existing Personal StoredFile owner remains
  required by its branch constraint. Exactly three transfer FK timings change;
  keys, IDs and historical migration bytes stay intact.
- API/events/jobs: 30 additive operations; 452 total OpenAPI operations and 3,756
  resolved references; previous signatures preserved. Existing maintenance job
  consumes cleanup. Personal departure events/sync are metadata-only. No new queue.
- Security: current parent/target authority, issuer ceilings, generation-bound
  consent, author/uploader checks, revision fencing, revoked upload publication,
  scoped export limits, no public storage keys, proof expiry and fail-closed
  retention/holds/reference catalog. See [contract](p2-07-contract.md) and
  [migration review](p2-07-migration-review.md).
- Tests/results: **1,075 distinct tests covered successfully after affected fixes**:
  528 unit/contract/architecture/compatibility and 547 integration, including all
  17 P2-07 integration cases. Full gate ran once; its initial nonzero exit is
  retained honestly in `.tools/p2-07-quality.log`. It found one random-width VAPID
  fixture, two old fixture connections missing production's UTC option, and an
  old FK assertion unaware of the three approved timing additions. Those exact
  issues were corrected; affected reruns passed. No full test suite was repeated.
- Gate commands/results (pnpm uses the repository-pinned 10.20.0/Corepack):
  - `pnpm quality`: all 13 stages executed once. Config, Prisma generation/auth
    schema/validation, build, typecheck, format, lint, architecture and OpenAPI
    passed; initial test/migration failures were resolved below.
  - `pnpm exec vitest run --project unit apps/api/src/bootstrap/environment.spec.ts`:
    **11 passed**; fixed-width synthetic VAPID encoding, no runtime relaxation.
  - `pnpm test:integration apps/api/test/integration/project-tools.spec.ts -t
'previews without changing dates'`: **1 passed**.
  - `pnpm test:integration apps/api/test/integration/shared-kernel.spec.ts -t
'concurrent account departures'`: **1 passed**. Both fixture connections now
    match production UTC; existing assertions and security checks remain intact.
  - `pnpm db:migrations:check`: **PASS** after the exact reviewed FK expectations
    were added. Empty replay, populated upgrade, rollback/resume of all five new
    migrations, repeat deploy, 126 prior table data sets, 2,002 prior constraints
    (1,996 domain constraints plus six migration-ledger constraints)
    with only enumerated changes, and all 38 previous checksums verified.
  - `node --env-file-if-exists=.env.test.local tooling/scripts/p2-07-smoke.ts`:
    **PASS** for compiled P2-04 through P2-07 plus fresh worker/API restart.
    The same invocation pattern for `p1-12`, `p2-01`, `p2-02`, `p2-03` also **PASS**.
  - Affected ESLint/typecheck/format checks and `git diff --check`: **PASS**.
    Prior signature compatibility: **452 operations / 3,756 resolved references**.
- Tests NOT RUN: real off-host backup/restore, production-sized load and Docker
  release checks. Local environment has no approved deployment rehearsal. These
  remain activation/production release requirements, never PASSED.
- Deviations: none authorized. Unsupported transfer graphs are rejected under ADR 0028. PSEUDONYMIZE configuration is blocked pending a specified reviewed algorithm.
- Outstanding local blockers / ADRs: **none**. Activation and production release
  prerequisites remain open, as listed in the [Phase 2 acceptance summary](phase-2-acceptance-summary.md).
- Deferred non-critical improvement: existing pg concurrent-query deprecation
  warnings; no driver/harness refactoring included.
- Git: accepted P2-06 committed/pushed as
  `3b66f95e545bd8a5aa4ddbcabf94dbd0b73bdaf8`; origin/main SHA verified. P2-07 publication
  is authorized; its resulting SHA is recorded in the subsequent readiness review. Unrelated architecture/frontend documents and ignored
  secrets/runtime artifacts are preserved. No deploy or production database change.
- Next eligible batch: **P3-01 — NOT STARTED; requires explicit approval**.
