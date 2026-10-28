# P1-06 completion report

Batch: P1-06 ? Goals, Milestones, Life Areas & Reviews.
Status: COMPLETE for the approved local development scope.

## Implemented scope

Ordered/archivable Life Areas; unified short/long-term Goal hierarchy and explicit
lifecycle; ordered milestones; exact increasing/decreasing metrics and normalized
weighted progress; configured existing Task/Habit references; immutable rule-versioned
progress snapshots and private reviews. Saved temporal contexts and explicit bounded
Habit windows follow approved [ADR 0012](adr/0012-goal-progress-and-history-semantics.md).
See [traceability](p1-06-traceability.md) and [runbook](runbooks/goals.md).

Goals never create/mutate source Tasks or Habits. Current progress recomputes through
owner public read contracts. Historical snapshots retain original calculations and
source context; status completion is always explicit. No future entity, new package,
job, background consumer, company/team/OKR or dashboard was added.

## Modules, persistence and contracts

New Goals domain/application/infrastructure/controllers/public module; narrow Habit
owner read facade reuses canonical schedule/entry statistics; existing Tasks facade
is reused. Contracts, generated OpenAPI and P1-05 compatibility signatures are included.
Nested mutations increment the owning Goal revision and use its If-Match/ETag.
Source link creation also checks sourceRevision. Creates/snapshots/reviews use the
existing 24-hour actor/space/request fingerprint receipts.

Migration 202610280008_p1_06_goals adds only LifeArea, Goal, GoalMilestone, GoalMetric,
GoalTaskLink, GoalHabitLink and GoalReview. Scoped FKs enforce owner/parent/area/source
containment and selected metric ownership. Check constraints cover lifecycle,
revisions, positive weights, metric denominator and date windows. Earlier migration
files and Better Auth-owned schema remain unchanged. The migration harness upgrades
from P1-05 with full-row snapshots including Habits/entries/routines.

Audit is safe metadata; version-1 goal.progress_changed is committed atomically with
Goal changes and explicit snapshots/reviews. Source change events are unchanged.
No dispatcher/consumer/worker was introduced.

## Verification

- `pnpm quality`: PASS, all 13 stages, exit 0. This submission ran the full gate once.
- Unit/domain/contracts/architecture/compatibility: 205 tests across 31 files.
- PostgreSQL integration: 183 tests across 12 files.
- Total: **388 passing tests across 43 files**, no skips.
- Architecture: zero violations across 150 modules and 705 dependencies.
- OpenAPI generation and every previous compatibility baseline: PASS.
- `pnpm smoke:p1-06`: PASS against the final quality-built API, including actual
  process stop/start, persisted LifeArea/hierarchy/metric/milestone/source links,
  exact weighted calculations, immutable review history and idempotent replay.
- Mandatory migration gate: PASS from empty schema (40 tables including Prisma's
  ledger), upgrade from P1-05 with all seeded rows preserved, and repeated deploy.
- Fresh read-only checks: **11/11 applied checksums match in development and test**,
  with zero unfinished migrations. Pre-deploy hashes of every earlier application
  table were unchanged after migration in both databases.
- New migration SHA-256:
  `7bdb92bae5c416c864c2363763a092282fbc7cfa8142049c6b64d928c1d9c7e3`.
- Prior migration bytes and dependency/runtime versions are unchanged.
- Local runtime: Node.js 24.22.1, PostgreSQL 18.6.

An additional Prisma introspection comparison identified only qualification of the
four existing provider UUID defaults (gen_random_uuid versus
pg_catalog.gen_random_uuid). A read-only comparison normalizing that equivalent
qualification was empty. No auth schema change was made; the mandatory official
provider schema check passed.

Targeted tests exercised hierarchy cycles/depth, exact fractions and raw clamping,
metric denominator/descending targets, partial patch preservation, source status
changes/corrections/unlinking, canonical Habit skip/pause/DST context, immutable
snapshots, private reviews, nested/foreign filters and FKs, stale/concurrent edits
and idempotency. Routine integration wiring/validation errors found during targeted
development were corrected without weakening previous tests.

Docker/production deployment and hosted CI execution are NOT RUN, deferred within
the approved local scope. Windows/Node.js24/PostgreSQL18 local checks are mandatory.

## Deviations, outstanding work and Git

No unapproved scope deviations. ADR 0012 is approved. No unresolved product decision.
Existing API scope guards now exclude later batches while accepting approved Goal
routes; all earlier compatibility signatures remain enforced.

Working tree contains 46 P1-06 changed/new files (23 modified, 23 new), including
the generated OpenAPI contract, approved ADR, traceability and runbook. Final review
found no configured secrets, environment files, private uploads, database files,
build artifacts or unrelated changes. Nothing is staged; nothing was committed
or pushed. HEAD remains the approved P1-05 baseline.
Next eligible batch: P1-07 (NOT STARTED).
