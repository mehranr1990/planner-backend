# Calendar, events and Time Blocks (P1-04)

Calendar owns CalendarEvent, EventRecurrence and TimeBlock. All routes are under
`/api/v1/calendar`, require a verified owner session and use private no-store
responses. [ADR 0010](../adr/0010-calendar-temporal-semantics.md) is approved.

## Events and blocks

`POST /events` and `POST /time-blocks` require Idempotency-Key. Receipts bind the
normalized request to actor, personal Space and operation for 24 hours. An exact
retry returns the original result, including after restart; changed input returns 409. GET collections use scoped creation-time/UUID cursors (max 100 per page).
GET by UUID includes retained deletion metadata. PATCH and DELETE require strong
If-Match. DELETE retains a tombstone and excludes the resource from normal views.
PATCH status supports ACTIVE/CANCELED for standalone resources.

An all-day schedule has kind ALL_DAY, IANA timezone, startDate and exclusive
endDate. It stores Gregorian DATE columns, with no UTC timestamps. Timed schedules
have kind TIMED, timezone, localStart and localEnd (`YYYY-MM-DDTHH:mm`). Responses
include the saved wall context and resolved UTC startAt/endAt. Schedule duration
is positive and bounded to 366 days. This is an API resource-exhaustion limit.

Explicit nonexistent wall times return 400 VALIDATION_ERROR with a safe DST_GAP
detail. Folds select the earlier UTC instant; every response declares the fold
and gap policies. An account timezone, week-start or Jalali presentation change
never rewrites saved events/blocks. API dates remain Gregorian ISO dates; callers
can transform presentation without changing persistence. A view timezone is
always explicit.

Blocks are timed reservations, separate from events, Tasks and My Day selections.
Optional taskId requires taskRevision and an existing owned actionable Task.
Master, deleted, done, canceled and skipped Tasks cannot be newly linked. Existing
links retain their UUID and expose READY/STALE/COMPLETED/DELETED/SKIPPED/CANCELED/
BLOCKED dispositions when the Task changes. PATCH taskId:null detaches the link.
Unrelated block edits remain possible when a linked Task becomes terminal. No
calendar command creates, edits, completes or reschedules a Task or My Day item.

## Recurrence and explicit series edits

Create a recurring event by supplying recurrence alongside its schedule. The
version-1 definition uses the approved Task rule patterns: daily, weekly, selected
ISO weekdays, monthly date/nth weekday, yearly and day/week/month/year intervals,
inclusive optional endDate and exclusionDates. Definition timezone, startDate and
localTime must match the schedule anchor (00:00 for all-day). Short months and
non-leap February 29 are skipped. Recurring timed events keep elapsed duration;
recurring all-day events keep the number of local dates.

Occurrences are virtual. Identity is series UUID + original local minute key;
resourceId identifies the root or persisted exception. Moving one occurrence
retains that identity. Recurring DST gaps return SKIPPED/DST_GAP with null UTC
instants. No actionable row, Task, worker or catch-up materialization is created.
Repeated expansion is deterministic and has no DB writes.

`POST /events/{id}/series` requires the root's If-Match and one of:

- THIS_OCCURRENCE: recurrenceKey, exceptionRevision (0 for an absent exception)
  and patch. Creates or changes one uniquely keyed CalendarEvent exception.
  Cancel with patch.status:CANCELED; it remains traceable in views.
- THIS_AND_FUTURE: recurrenceKey and a new event with recurrence starting at that
  boundary's date. Requires Idempotency-Key. Cuts the predecessor and creates a
  linked successor. Explicit future exceptions retain their predecessor identity;
  matching dates are excluded from the successor to avoid duplicate slots.
- ENTIRE_SERIES: full event/recurrence and optional status. Retains immutable
  EventRecurrence schedule/content versions for elapsed identities, and changes
  only unelapsed nonexception identities. The boundary is late enough in both old
  and new zones/times to prevent making a new elapsed occurrence. Identity time
  stays frozen even when actual wall time changes. Explicit exceptions survive.

Elapsed occurrences, DST-gap skips and canceled history cannot be rewritten.
An already split predecessor cannot be split/versioned again; edit its successor
or an eligible retained exception. Recurrence anchor date and schedule kind remain
fixed for ENTIRE_SERIES; a new segment explicitly changes them. A series is limited
to 1000 versions and 1000 exceptions. Scoped transaction locks, revisions and
unique DB keys prevent conflicting edits and duplicate exceptions/successors.

## Range views and advisory conflicts

`GET /views?from=&to=&timezone=&limit=&cursor=` uses a half-open local-date range,
at most 93 dates. It returns normalized event occurrences and blocks, max 100 per
page. Ordering is resource creation instant/UUID, then original recurrence key.
It scans at most 25 resources per page; empty pages can have a nextCursor. Follow
the cursor until null. Moved exceptions are included by their actual interval.
Canceled and skipped entries are explicit; deleted resources are absent. A cursor
is actor/Space/query-bound; editing its held resource returns 409. Pagination is a
live read; restarting after concurrent unrelated insertions gives a fresh view.

`GET /conflicts` uses the same required range and returns advisory:true with pairs
of active overlapping identities. Touching endpoints and zero-duration skipped
civil dates do not overlap. All-day occupancy uses midnight boundaries in the
requested display zone, including zones that skip midnight/a whole date. This
boundary calculation never shifts an event. Overlapping writes are allowed.
Conflict pages bind to an authoritative snapshot and reject stale continuation.
Bounded analysis permits at most 1000 occurrences, 1000 scanned resources and
10000 pairs. RANGE_TOO_DENSE asks for a narrower date range. No result is silently
truncated. Existing allocation-based planning capacity remains unchanged per ADR.

## Persistence, events and operations

Calendar writes, safe metadata audit and version-1 calendar_event.changed /
time_block.changed outbox events commit together. Payload is empty; authorized
owner reads provide detail. Titles, descriptions, timezones and private content
are excluded from audit/outbox/log bodies. No queue/consumer is introduced here.

Two additive migrations create the three approved entities and strengthen link
revision/version checks. The second is a forward fix for SQL CHECK's acceptance
of UNKNOWN; the already applied first migration was preserved. No Better Auth
schema, old migration, Task data, planning data or existing setting is rewritten.
Use reviewed migrate deploy; never schema push/reset. A forward fix is the
rollback strategy: keep old data/tables and correct the API before further use.

Run `pnpm quality` for the mandatory 13-stage local gate and `pnpm smoke:p1-04`
after compilation for actual API restart/persistence evidence. The smoke creates
exact-ID fixtures in the isolated test DB and removes only its own data/files.
Docker and production operational checks remain deferred until deployment.
