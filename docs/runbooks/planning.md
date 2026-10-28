# P1-03 personal planning

Authority: [ADR 0009](../adr/0009-personal-planning-semantics.md), P1-03 and
[ADR 0008's non-actionable recurrence masters](../adr/0008-task-recurrence-semantics.md).
All paths use `/api/v1/planning`, a current verified session and authorized
Personal Space. Mutations also require a trusted Origin. Ownership/internal
overposting is rejected. Missing and foreign resources use the same safe 404.
All responses are private/no-store. No frontend, calendar, worker or Task engine
copy is introduced.

## Daily and weekly plans

- `POST/GET /days/{date}` creates/reads a daily plan. Creation starts at revision
  1 and returns 201; duplicate creation returns 409. A GET of a missing plan is
  404 and never creates it. Dates are Gregorian ISO literals, 1900–9998.
- `PUT /days/{date}/items/{taskId}` selects/refreshes a Task, requiring the Day
  If-Match and `{taskRevision,plannedMinutes,position?}`. The Task must currently
  be owned, actionable OPEN/IN_PROGRESS, undeleted and not skipped/canceled.
  Explicitly supplying the current Task revision refreshes a stale selection.
  plannedMinutes is an integer 0–1440 or null for unknown; it is a planning
  allocation, not a Task estimate or calendar block. Position defaults to current
  position or append. Selecting the same values at the current revision is a no-op.
- `PATCH /days/{date}` with `{taskIds:[...]}` reorders the exact complete set of
  selected references, using the Day If-Match. Include any blocked references
  exposed separately below. Missing, foreign or unselected IDs are safe 404;
  incomplete/duplicate orders are rejected. Positions are compacted atomically.
- `DELETE /days/{date}/items/{taskId}` removes only the reference, requiring the
  Day revision. Terminal, deleted, blocked and stale references remain removable.
- `POST /days/{date}/items/{taskId}/move` requires source Day If-Match and
  `{targetDate,targetRevision,taskRevision,position?}`. Dates must differ. Target
  revision 0 means still absent; a successful explicit move can create it. Existing
  destination duplicates, stale revisions and ineligible Tasks are rejected.

There is one DailyPlan per space/localDate and at most one selection per
space/localDate/Task. A Task may deliberately appear on several dates. Maximum
100 stored references per day; UUIDs identify Tasks and selections. No selection,
move or rollover modifies a Task's dueAt, scheduledDate, status, revision,
history, attachment permissions or recurrence. Task metadata is read through
the owning module's public contract in the same transaction.

`items` contains My Day references with current authorized Task metadata and
READY/STALE/COMPLETED/DELETED/SKIPPED/CANCELED/BLOCKED dispositions. Deleted Task
titles are omitted. If a selected Task subsequently becomes a master, its
reference appears only in `blockedItems` with null Task metadata, not as a My Day
Task. Removal and rollover inspection remain available. All stored references,
including blocked ones, participate in ordering and the 100-item cap. Task state
changes can change enriched dispositions without advancing the Day revision;
mutations revalidate authoritative state, never trust the read projection.

`POST/GET /weeks/{weekStartDate}` creates/reads a unique WeeklyPlan. It composes
seven existing daily plans into bounded summaries, with no duplicated Task store,
weekly items entity or undated backlog. Select/reorder/remove work through the
corresponding Day routes. Daily reference changes advance every existing weekly
plan covering that date. Summaries exclude masters from selectionCount and expose
blockedCount separately. No GET creates missing daily plans.

Plans record timezone at creation; weeks also record firstDayOfWeek, following
the account convention Sunday=0 through Saturday=6. New weeks must start on the
current preferred weekday and fit the supported date range. Existing weeks stay
addressable by their original date after settings change. New days/weeks use
current preferences; existing dates and contexts are never rewritten. Historical
week ranges may overlap and compose the same existing daily references. A daily
plan in an existing week may have a later timezone context; responses show both.

## Private planning reviews

`POST/GET /reviews`, `GET/PATCH/DELETE /reviews/{id}` provide private planning
reviews. Create accepts `{kind,localDate,reflection}`. MORNING and EVENING are
daily, WEEKLY identifies a week start; each space/date/kind is unique. Context is
taken from the existing day/week if present, otherwise current preferences.
Weekly dates must match that context's week start. PATCH changes only reflection
with the review If-Match; DELETE permanently removes that owned review with its
revision. Opaque metadata-only audit evidence is retained. No undocumented trash
or retention behavior, journal link, journal copy or content history is added.

Reflection is private plain text, maximum 10,000 UTF-16 code units; disallowed
controls/unpaired surrogates are rejected. It never enters audit/outbox/logs.
List pagination uses `(createdAt,id)` ascending, default 25, maximum 100. Optional
from/to must both be present, ordered and span at most 366 days; optional kind
is an explicit enum. Cursors bind actor, space and date/kind query context.

## Suggestion-first rollover

`POST /rollover/preview` accepts `{fromDate,toDate}` with a later target date.
It is read-only: no Task/plan/selection/receipt is created or changed. The source
must exist. Response snapshots sourceRevision, targetRevision (0 if absent),
settingsRevision and each item's Task/item revision, explicit allocation and
disposition. Current Task revision differing from selectedTaskRevision is STALE;
refresh through PUT before choosing it. Masters/missing targets are BLOCKED;
completed/deleted/skipped/canceled Tasks and destination duplicates are explicit.

`POST /rollover/commit` requires Idempotency-Key and the dates, plan/settings
snapshots, `mode:COPY|MOVE` and explicit selected items
`[{taskId,taskRevision,itemRevision}]`. Snapshot inputs are revalidated against
owned DB state; submitting arbitrary preview-like values cannot grant access.
There is no preview entity/token or implicit commit. Source/target/settings
revision changes reject the entire request with 409. Changed or ineligible Tasks,
unselected IDs and destination duplicates yield safe per-item outcomes while
other eligible references can succeed. The destination is created only if at
least one item applies and it is still absent. Day caps remain enforced.

COPY retains source references; MOVE removes only successful references. Source
and destination/order/revision/audit plus the exact partial result receipt commit
atomically. Failed items stay in the source. Task dates and states never change.
Actor/space/operation/hashed-key/full-request binding lasts 24 hours; replay returns
the recorded result, even if later state changed, with no repeated effects.
Changed request content under the same key is 409. Another actor cannot replay it.
Unexpected failure rolls back the whole transaction/receipt; retry the same key.

## Capacity and availability

`GET/PUT /capacity/availability` accesses account-owned optional version-1
configuration `{availability:{version:1,minutesByWeekday:[...]}}`. Seven integer
durations are indexed Sunday=0 and each is 0–1440. Null removes configuration;
zero is explicit zero, not unknown. PUT requires the shared UserSettings If-Match;
the existing `/me/settings` shapes remain exactly unchanged. Settings concurrency
is enforced in the account public contract; availability writes acquire the row
write lock before reading their snapshot, preventing a shared-lock upgrade race.

`GET /capacity?date=...` or `?weekStartDate=...` computes one date or seven dates.
They are mutually exclusive; omitting both uses today in the current account
timezone. Existing plans/week contexts are retained. New week forecasts use the
current week-start preference. Availability is the current configuration with
its settings revision, not a fabricated historical configuration snapshot.

The calculation sums explicit allocations on retained Task references, including
completed/canceled/deleted ones until explicitly removed; no effort is inferred
from Task title, due date, priority or completion. Masters/missing Tasks are
excluded and reported as blockedAllocations. Responses expose knownPlannedMinutes,
unknownAllocations, blockedAllocations and availableMinutes (null if unconfigured).
remainingMinutes is null while any allocation is unknown/blocked or availability
is unconfigured; otherwise it is configured minus planned duration. overCapacity
is advisory and compares known planned duration with configured duration. Negative
remaining capacity is permitted. DST gaps/folds do not change fixed configured
durations. No TimeBlock, Task estimate, actual time tracking or AI inference is
introduced before its batch.

## Storage, transactions and operation

The sixth additive migration `202610280003_p1_03_personal_planning` adds exactly
DailyPlan, DailyPlanItem, WeeklyPlan, PlanningReview and nullable versioned
planningAvailability on UserSettings. Scoped/date-consistent FKs, date/Task/order
uniqueness and revision/minute/review checks protect integrity. Positions 100–199
are reserved inside atomic reorder transactions; committed API positions are
0–99. All prior migrations and existing rows are preserved. Never schema-push or
reset a configured database. Deploy explicitly using `pnpm db:migrate:deploy`;
startup does not migrate. Roll forward additively after a failed release rather
than dropping these tables or rewriting migration history.

The planning repository owns only its four entities. It calls Task/account public
facades with the caller's authorized scope and DB transaction; no cross-owner raw
ORM access. The Task space lock serializes Task state and planning references;
account snapshots use row locks. No external I/O occurs under these locks.
Mutations append safe metadata audit atomically. No new event types/consumers or
workers are justified by P1-03; existing Task outbox guarantees remain unchanged.

Run `pnpm quality` for final local gates, then `pnpm smoke:p1-03` against compiled
code and the guarded isolated local test database. The smoke verifies auth,
planning, recurring occurrence references, rollover/replay, capacity, private
reviews, ownership and persistence after API restart. It cleans only its own
UUID fixtures/verified temporary directory. Existing P1-02 compiled smoke remains
available and in CI. Docker/production/backup release gates remain deferred.
P1-04 and all later features are not started.
