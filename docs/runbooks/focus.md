# Focus sessions, Pomodoro and actual time (P1-07)

[ADR 0013](../adr/0013-focus-timers-and-time-accounting.md) is the approved temporal
policy. [Traceability](../p1-07-traceability.md) maps every requirement to code/tests.

## Session lifecycle and recovery

All routes use /api/v1, a verified owner session and scoped resource access.
Mutations require trusted Origin; POST creation and transitions require
Idempotency-Key (24-hour actor/space/operation/body binding). PATCH/DELETE and
session transitions require quoted If-Match; ETag returns the owning revision.
Duplicate transition keys return the original response even after later changes.

POST /focus/sessions creates IDLE STOPWATCH or POMODORO. Optional taskId needs
taskRevision and a current actionable ordinary Task. Timezone defaults from the
account and stays saved across later travel. Only IDLE title/config/link may be
patched. Mode and saved timezone do not change after creation.

- start: IDLE -> RUNNING.
- pause: RUNNING -> PAUSED; no accrual while paused.
- resume: PAUSED -> RUNNING if a finite schedule still has remaining time.
- finish: RUNNING/PAUSED -> FINISHED. Pomodoro requires its schedule to be exhausted.
- stop: IDLE/RUNNING/PAUSED -> ABANDONED, retaining actual earned work.
- Terminal sessions cannot be restarted or paused. Create a new session explicitly.

One RUNNING or PAUSED session reserves the owner's timer. A partial unique index
enforces this across processes; other users can run independently. At revision999
only finish/stop is allowed, reserving revision1000 for safe terminalization.
Foreign IDs return404, conflicting/stale transitions return409, invalid inputs/
bounds return400. No local file or browser storage is authoritative.

PostgreSQL clock instants drive transitions. Client-supplied elapsed values and
timestamps are rejected. Closing the client or restarting the API leaves RUNNING
accruing; PAUSED stays paused. Read current state and history after reconnecting.
Elapsed values use integer milliseconds; server clock regressions clamp at the
last recorded instant and expose clockAdjusted. Correct host clock configuration
is required; unknowable actual elapsed time is never fabricated.

## Pomodoro and tracked work

Configuration defaults: workMinutes25, shortBreakMinutes5, longBreakMinutes15,
longBreakEvery4 and workIntervals4. Bounds: work1-180 minutes, short break1-60,
long break1-120, interval frequency/count1-16. Long breaks occur after each configured
Nth work interval when another work interval remains. There is no trailing break.
Advancement is derived from active elapsed time; pauses suspend the entire schedule.

A finite schedule caps accrual at its end and reports READY_TO_FINISH. Persisted
state remains RUNNING/PAUSED and keeps the reservation until explicit finish/stop.
No worker, background alarm, automatic completion or notification is installed.

Terminalization atomically appends the session transition and one TRACKED TimeEntry
per contiguous actual WORK portion of running spans. Pauses and short/long breaks
produce no tracked work. Zero durations create no entry. A unique session-root/
segment-ordinal key plus receipt/revision checks prevents repeated finish accounting.
Tracked entries cannot be edited/voided independently of session evidence.

GET /focus/sessions and /{id}/history support bounded scoped cursors. Current list
order uses original creation time/logical UUID, so appending a physical revision
does not reorder an item. History order uses revision, including tied timestamps.
Earlier values/configuration/timestamps remain; only the former current marker closes.

## Manual work, summaries and Task properties

POST /time-entries accepts explicit UTC startAt/endAt, optional private note/Task
link and saved timezone. Duration is derived, positive, <=7days and not future.
PATCH appends a typed correction; DELETE appends VOID. GET /{id}/history preserves
every earlier value. A supplied Task reference needs its current revision and must
be owned/actionable; existing references remain traceable after source changes.

GET /productivity/summary requires from/to ISO local dates (to exclusive) and view
timezone, max366dates. It uses current nonvoid TimeEntries, clipped to actual UTC
day boundaries. Original session/entry zones and timestamps remain unchanged.

- recordedMs: sum of clipped entry durations.
- distinctWorkMs: union of clipped intervals; each actual instant counts once.
- overlapMs: recordedMs minus distinctWorkMs.
- manualMs/trackedMs: raw clipped totals by source; do not add them to distinctWorkMs.
- uncommittedWorkMs: separately reported earned work of the reserved live session.
  It is never silently added to recorded totals.
- Day entry counts may include the same cross-midnight entry on two dates.
- Session counts use START/FINISH/STOP transition timestamps within the range.
- Tasks use CURRENT_ACTIONABLE scope, independent of historical time range. They
  exclude deleted/completed/canceled Tasks, recurrence masters and skipped/canceled
  occurrences. Explicit estimates sum known values; null estimates are counted as
  unknown, never inferred from titles, dates, planning allocations or Focus work.

Queries exceeding10000 relevant entry/transition/Task rows fail safely; narrow the
range/filter rather than treating a truncated scan as a complete statistic.
Current lists/history return max100/page. Overlapping manual records remain explicit;
raw source totals can exceed distinct work and are explained by overlapMs.

Task properties live on Task and are written only by Tasks through
/tasks/{id}/productivity GET/PATCH with the Task revision. estimatedMinutes is
nullable0-10080. important/urgent are nullable explicit flags; either unknown means
UNCLASSIFIED, otherwise true/true=DO, true/false=SCHEDULE, false/true=DELEGATE,
false/false=ELIMINATE. Names are classifications, not delegation functionality.
No due-date/priority inference. Recurrence/template application does not silently
copy these properties. Existing Task responses/history contracts stay unchanged.

Property edits commit safe changed-key metadata in SecurityAuditEvent.productivityFields
and existing task.updated outbox events. The account-only changedFields constraint
and legacy TaskChange field whitelist remain intact. Session/time audit contains
no titles, private notes or durations. No new event names/consumers are needed.
Task/Goal lifecycle, dates, planning selections/capacity and Habit history are untouched.

## Migrations and verification

202610280009_p1_07_focus adds FocusSession/TimeEntry typed revisions, scoped FKs,
identity/configuration checks, current/reservation uniqueness and nullable Task fields.
202610280010_p1_07_productivity_audit adds only the typed audit metadata array, keeping
the old allowlist unchanged. Never edit earlier applied migrations. Apply through
pnpm db:migrate:deploy; never schema push/reset. Correct later issues through additive
forward fixes. Local development/test data preservation and all checksums are verified.

Run targeted tests while implementing; pnpm quality once for final submission.
pnpm smoke:p1-07 uses the final compiled API with isolated fixture identities and
real paused/running process restarts, exact durations, replay and private-note
checks. Docker/production deployment and hosted CI execution remain deferred to
deployment gates; local completion does not claim those checks passed.
