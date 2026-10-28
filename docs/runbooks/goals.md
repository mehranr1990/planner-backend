# Personal goals and life areas (P1-06)

[ADR 0012](../adr/0012-goal-progress-and-history-semantics.md) defines formulas and
history. [Traceability](../p1-06-traceability.md) maps requirements to tests.

## API use

All routes use /api/v1 and a verified owner session. Mutations require trusted
Origin. POSTs require Idempotency-Key (24-hour actor/space/body-bound receipts).
PATCH/DELETE and nested POSTs require the owning Goal's quoted If-Match revision;
LifeArea mutations use its own revision. Successful nested mutations return the
new Goal revision and ETag. Never substitute a Task/Habit revision for a Goal
revision; new source links additionally require sourceRevision.

1. POST /life-areas with title and optional position. PATCH title/position/status;
   DELETE archives. Existing associations remain. Lists use creation/UUID cursor
   order and expose position for organization; archived areas cannot receive new
   Goal assignments until reactivated.
2. POST /goals with title, SHORT_TERM/LONG_TERM horizon and optional lifeAreaId,
   parentGoalId, startDate/targetDate, description, timezone and progressMode.
   Goals start in MANUAL or WEIGHTED; create a metric before selecting METRIC.
   PATCH lifecycle explicitly; percentage 100 never completes a goal. Retain
   COMPLETED/ABANDONED goals, with no implicit subtree or source lifecycle changes.
3. POST/PATCH/DELETE nested milestones/metrics or links/tasks and links/habits.
   Child routes end in /{childId}. Each collection is bounded to 100. Milestones
   have position, status, targetDate, contributes and weight. Metrics use exact
   decimal-string baseline, target, current and unit; baseline != target supports
   decreasing targets. A selected metric must belong to this Goal; deselect before
   removing it. Source IDs cannot be retargeted on PATCH: unlink and link explicitly.
4. Habit links require explicit from/to dates (end exclusive, max366 days).
   Task and Habit links default contributes:false. Enable only deliberate sources.
   Task links never duplicate Tasks, write source revisions, modify dates or log
   Habit entries. References retain traceability as sources change.
5. GET /goals/{id}/progress recomputes ruleVersion 1 without persisting. POST {} to
   that route records a SNAPSHOT; POST reflection to /reviews records a REVIEW.
   Both increment the Goal revision and capture immutable source context. GET
   /reviews supports kind=SNAPSHOT|REVIEW and cursor pagination. Reviews cannot be
   backdated, patched or overwritten.

Dates are Gregorian ISO date-only values; saved Goal timezone is independent of
later account travel. Source Habit windows use canonical attributed dates and
saved Habit timezone; future dates/rest/skip/pause/archive are not successes.
Goal history remains unchanged after corrections or unlinking. A hierarchy is
organizational, same-space, at most five levels, with no implicit roll-up.
Hierarchy validation is bounded to 10000 Goals per space.

## Calculations and errors

Amounts have up to six fractional places and absolute maximum 999999999.999999;
weights are positive and <=1000000. METRIC = 100*(current-baseline)/(target-baseline).
WEIGHTED normalizes the sum of the explicit positive weights. Source percentages
are not clamped before aggregation. Output rounds to six places, half away from
zero; only visible percentage clamps to 0..100. NO_SOURCES returns zero.
Raw metric baseline/target/current/unit, raw per-source fractions and percentages
are retained in snapshots. Noncontributing links remain outside the formula.

400 denotes invalid configuration, missing headers, cycles/depth, collection/density
bounds, zero metric denominator, invalid dates or selected metric removal.
409 denotes stale revisions, duplicate links or key/body mismatch. Foreign/missing
resources, including source references and filter IDs, are 404. Error/audit/outbox
payloads contain no private goal titles, values or reflection text.

PROGRESS_TOO_DENSE means Habit source evidence exceeds 10000 schedule/entry records
across this Goal's configured contributions. Narrow windows or remove unnecessary
sources. Canonical Habit owner range limits also apply. No partial/inferred progress
is returned when evidence cannot be processed safely.

## Migration and verification

Migration 202610280008_p1_06_goals adds LifeArea, Goal, GoalMilestone, GoalMetric,
GoalTaskLink, GoalHabitLink and GoalReview. Scoped foreign keys enforce ownership,
selected metric containment, parent containment and source links; check constraints
cover statuses, positive revisions/weights, date/window ordering and metric targets.
Application-scoped transactions enforce cycles and collection bounds.

Apply reviewed SQL through pnpm db:migrate:deploy; never schema push/reset. Prior
migrations and Better Auth tables are unchanged. Verify migration checksums in both
development and the isolated test database. A safe forward-fix migration is required
for any later correction; do not delete these tables or edit an applied migration.

Use pnpm quality once for submission; pnpm smoke:p1-06 verifies the final compiled
API, actual restart persistence and receipt replay using isolated fixture identities.
Audit and goal.progress_changed payloads are metadata-only and committed atomically.
Source events remain untouched; Goals reads source changes synchronously. No worker,
cache, external infrastructure or additional package dependency is introduced.

Docker image/start/persistence and production/hosted CI verification remain deferred
to their deployment gates; local completion does not claim those checks passed.
