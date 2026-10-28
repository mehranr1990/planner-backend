# Habits, routines and water (P1-05)

[Approved ADR 0011](../adr/0011-habit-history-and-streak-semantics.md) defines the
date/history rules. The habits module owns Habit, HabitSchedule, HabitEntry,
Routine and RoutineHabit. Routes use `/api/v1`, verified personal ownership,
strict Zod validation and private no-store responses.

## Habits and calendar dates

POST `/habits` requires Idempotency-Key, title, type, unit, target and schedule.
CHECKBOX requires COUNT/target "1". DURATION requires SECOND and integer values.
QUANTITY accepts exact decimal strings with at most three fractional digits,
normalized without floating-point conversion; measures are 0–999999999.999 and
targets strictly positive. WATER requires QUANTITY/ML; GENERIC is the default.
Measurement type, unit and purpose are immutable. Timezone defaults to the
current account zone at creation and is then saved independently.

Schedule definition is `{version:1,startDate,rule}`. DAILY is every date; WEEKLY
is every seven dates anchored at startDate; WEEKDAYS uses ISO Monday=1 through
Sunday=7; INTERVAL is every N dates, N=1–365. These are Gregorian calendar-date
rules, not elapsed 24-hour timers, weekly quotas or alarm instants. DST changes,
leap days and local midnight do not create additional expected occurrences.

GET `/habits` returns a scoped creation-time/UUID cursor list, including retained
archives (max 100/page). GET `/habits/{id}` returns currentSchedule and
latestSchedule. A future-start habit has no current schedule. PATCH requires
strong If-Match and can change title, target, timezone, schedule or status
ACTIVE/PAUSED/ARCHIVED. ACTIVE resumes; PAUSED suspends expectations. DELETE
archives effective today and returns the new revision, without deleting history.

Every configuration/status edit appends a typed HabitSchedule snapshot. The
highest-revision snapshot applicable to an attributed date controls its expected
status/target. An edit means effectiveFrom and future dates; default is today in
the saved current habit zone. A past effectiveFrom requires
confirmHistoricalChange:true. Entries are never erased, moved or rebucketed.
GET `/habits/{id}/schedules` exposes immutable paginated configuration history.
Calculation reads and writes are bounded to 1000 schedule versions per habit;
further configuration edits return SCHEDULE_VERSION_LIMIT. A title-only update
increments the habit revision without manufacturing a schedule snapshot.

## Logging, skips and typed correction history

POST `/habits/{id}/entries` requires habitRevision and Idempotency-Key. LOG is
default; checkbox value defaults to "1", other types require value. Optional
localDate defaults to today in the saved habit timezone; future attribution and
dates before the first applicable schedule are rejected. Historical attribution
is distinct from the server recording timestamp. Each row stores immutable UTC
recordedAt, schedule timezone and account recordedTimezone, plus its schedule FK.
Account travel/settings changes never silently change earlier dates or contexts.

Checkbox has one nonvoid current logical entry per date; toggle through PATCH.
Quantity/duration allow multiple logs. Rest/paused logs are retained but do not
create expected-day successes. Archived habits reject new logs; correcting old
entries remains possible. Zero is valid and does not satisfy a positive target.

SKIP is explicit, unique per active due date, and cannot override a completed day.
Partial logs remain stored. Clear the skip with void:true before further logging.
Skipped dates are neutral and never count as completion. A skip on a rest, paused
or archived expected date is rejected.

GET `/habits/{id}/entries` returns current logical revisions, including VOID
markers, with optional half-open date filters and scoped pagination. GET a nested
entry by UUID returns its current row. PATCH `/entries/{entryId}` requires the
entry's If-Match plus habitRevision and accepts value/void. It retains the stable
logical id, appends a new revisionId, and changes only the old row's current
marker. Original values, recorded timestamps, attributed dates and timezone
context remain unchanged. Entries cannot change date or kind through correction.
GET `/entries/{entryId}/history` paginates the typed revision chain by revision
order, including revisions whose recording timestamps tie.

Receipts bind actor, Space, operation and normalized request for 24 hours. Exact
retries return the original snapshot even after correction/archive/restart;
they do not restore the old value or write another entry. Refresh the resource
before editing an old receipt. Changed fingerprints and stale revisions return 409. Nested foreign/missing resources return safe 404 responses.

## Deterministic range statistics

GET `/habits/{id}/stats?from=&to=&asOfDate=` uses a half-open range of at most 366
dates. asOfDate defaults to today in the saved habit zone and cannot be future.
The response explicitly reports streakScope:RANGE, current/longest streak, daily
outcomes, exact totals, due/completed/skipped/missed/pending counts and a
completion-rate numerator/denominator. These are not lifetime cached statistics.

Sum only nonvoid current contributions; a due date succeeds at total >= the
effective target. Rest/paused/archived/skip dates are neutral: no streak increment
and no completion denominator contribution. A past unmet expected day is MISSED
and resets the streak. An unmet as-of day is PENDING and does not break it before
the day closes; later due dates are UPCOMING. Historical corrections/confirmed
schedule edits recompute directly from canonical data, with no stale cache or job.

Calculations read at most 10000 current entry rows. RANGE_TOO_DENSE returns a
safe validation error instead of a truncated statistic; request a narrower range.
List/history routes remain cursor-paginated even when a day is dense.

## Routines and water

POST/GET `/routines`, GET/PATCH/DELETE `/routines/{id}` manage ordered same-space
habit links. Creation requires Idempotency-Key; mutations require strong If-Match.
PATCH habitIds atomically replaces/reorders at most 100 distinct associations.
GET enriches current habit status; paused/archived links remain readable and
removable. DELETE retains an archived routine. No habit is duplicated and no
routine command logs, completes or modifies a member habit.

GET `/habits/water-summary?from=&to=&habitId=` sums current nonvoid WATER quantity
logs by immutable attributed date, in canonical ML. It includes archived/rest-day
history, returns per-habit versioned targets/context, and excludes generic ML
habits. No separate tracker, unit conversion or inferred hydration recommendation.
Optional habitId narrows to one owned WATER habit. The range is at most 366 dates;
all-habit summaries are bounded to 1000 habits, 10000 schedule versions and 10000
entry rows. A dense request returns RANGE_TOO_DENSE; narrow the range/habit scope.

## Persistence and operations

Scoped advisory transactions serialize configuration changes and entry/routine
mutations across API processes. FKs enforce owner and same-habit containment;
partial unique indexes protect the current logical revision, checkbox and skip
day identities. Entry history uses self/root/previous FKs inside HabitEntry, not
JSON history or an unapproved table. Ordered routine links have scoped unique
membership/position and 0–99 position checks.

Writes and safe metadata audit commit atomically. Entry creation/correction emits
version-1 habit.entry_recorded / habit.entry_corrected with empty payloads in the
same transaction. No titles, quantities, timezone context or personal content are
broadcast or logged. No new consumers, cache, worker or infrastructure is added.

Two additive migrations create the approved five tables and strengthen JSON
version integrity against SQL CHECK's UNKNOWN behavior. No previous migration or
Better Auth table changes. Deployment is reviewed migrate deploy, never startup
schema mutation/reset. Use a forward fix for recovery. Physical owner teardown
must remove owning routines before FK-protected habits; fixtures/smoke do this
for exact fixture IDs. Account deletion orchestration remains a later batch.

Run `pnpm quality` once on final code for all 13 mandatory local stages and
`pnpm smoke:p1-05` for the compiled API with an actual restart. Docker and
production operational verification remain deferred until deployment.
