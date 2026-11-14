# Frontend workflows — implemented Personal Planner

All paths below are relative to `/api/v1` unless stated otherwise. Use verified
cookies and trusted browser Origin for mutations. Exact per-operation bodies,
headers and responses are linked in the [293-operation reference](./API_MODULE_REFERENCE.md).
Do not infer a missing action route from a generic CRUD pattern.

## Shared interaction states

Initial loading is distinct from an empty successful collection. Follow nextCursor
until null, including bounded empty pages that still have a cursor. A missing Day
plan is 404 and should offer explicit creation; it is not a failed Task list.
Use 401 for session revalidation, 403 for denied/closed/unverified access, 404 for
missing/inaccessible resources, 400 for form/range validation and 409 for stale
revision/identity conflict. Preserve unsaved text while refetching on conflict.
Do not expose another user's resource existence by probing alternate IDs.

Disable duplicate submission while a command is pending, but retain its exact
Idempotency-Key for a lost-response retry. Inspect bulk/sync partial results even
when the outer request succeeds. Error UI may show requestId without retaining
private bodies. Mutation ETags belong to specific aggregates; refetch related
views when a nested operation increments its parent revision.

## Tasks, nested tools and recurring work

1. GET `/tasks` with supported status/priority/date/parent/label/trash filters.
   POST `/tasks` creates a single Task; GET `/tasks/{id}` supplies detail/ETag.
   A rich description is `{format:"MARKDOWN",version:1,content:"..."}`, not HTML.
2. PATCH detail using the current If-Match. DONE uses POST `/complete`; reopen uses
   POST `/reopen`, each beneath `/tasks/{id}`. DELETE is soft deletion; POST
   `/restore` explicitly restores within the server's restoreUntil window. Do not
   assume all deleted Tasks remain restorable indefinitely.
3. Manage subtasks at `/tasks/{id}/subtasks`, checklist at `/checklist-items`, and
   labels/attachments via their nested collection and PUT/DELETE association routes.
   Checklist mutations use Task revision; associations validate current same-owner
   label/file IDs. Upload a file first, then bind its READY ID. Read `/history` for
   retained changes. Unbinding an attachment and deleting its file are distinct.
4. `/task-templates` stores safe reusable values; POST `/{id}/apply` requires
   template revision plus Idempotency-Key and produces a new independent Task.
   `/saved-task-filters` stores the validated versioned query, then GET `/{id}/tasks`
   executes it. Do not pass arbitrary SQL/filter fields.
5. POST `/tasks/bulk` with explicit items, Task revisions and one stable key.
   Show success/error per item; retain failed drafts and refetch applied resources.
6. To recur, create an eligible standalone OPEN Task, then POST `/task-recurrences`
   with taskId/taskRevision/definition. The original becomes a nonactionable master.
   POST `/{id}/catch-up` explicitly materializes bounded occurrences; follow its
   cursor. There is no automatic Task recurrence worker or client-side duplication.
7. Read occurrence state at `/task-occurrences/{id}`. POST `/complete`, `/skip` or
   `/cancel` there with occurrence If-Match and taskRevision. These UUIDs/revisions
   are not interchangeable with the ordinary occurrence Task UUID/revision.
8. PATCH the recurrence with THIS_OCCURRENCE, THIS_AND_FUTURE or ENTIRE_SERIES and
   its exact schema. Show split/successor lineage, exceptions and immutable terminal
   history. Gaps skip explicitly, month-end/Feb 29 can skip; never shift or fabricate
   an actionable occurrence to fill a missing date. Retired segments stay retired.

Sources: [Task controller](../../apps/api/src/modules/tasks/http/tasks.controller.ts),
[Task tools](../../apps/api/src/modules/tasks/http/task-tools.controller.ts),
[ADR 0008](../adr/0008-task-recurrence-semantics.md).

## My Day, week, reviews and capacity

GET `/planning/days/{date}`; POST `{}` only when the user chooses to create a
missing plan. PUT `/planning/days/{date}/items/{taskId}` with Day If-Match and
taskRevision/plannedMinutes selects an existing actionable Task. PATCH the Day
with taskIds to reorder; DELETE its item removes only that reference. POST the
item `/move` with targetDate/targetRevision/source Task revision for an explicit
move. Never create a duplicate Task or rewrite a due date to implement My Day.

GET/POST `/planning/weeks/{date}` reads/creates the seven-day composition. New
weeks use the current week-start preference; existing week addresses/context stay
stable after preference changes. `/planning/reviews` supports MORNING, EVENING and
WEEKLY reflection; edit/delete uses the review's revision, not a Day ETag.

GET/PUT `/planning/capacity/availability` reads/changes seven weekday durations;
PUT uses UserSettings revision. GET `/planning/capacity` for date or weekStartDate.
Show unknown availability/allocation separately from zero and over-capacity as
advisory. This calculation uses explicit planning allocations, not TimeBlocks,
Task estimates or actual Focus duration.

POST `/planning/rollover/preview` is read-only. Let the user select eligible items
and COPY/MOVE; POST `/planning/rollover/commit` with the preview's source/target/
settings and item/Task revisions plus Idempotency-Key. On top-level 409 get a new
preview; on per-item failure retain source selections. There is no preview token
or implicit commit, and no Task date change.

Source: [planning contracts](../../packages/api-contracts/src/planning.ts),
[ADR 0009](../adr/0009-personal-planning-semantics.md).

## Calendar and scheduling

GET `/calendar/views?from=...&to=...&timezone=...` with an exclusive end date and
at most 93 local dates; follow its cursor. Display ACTIVE/CANCELED/SKIPPED entries
and Task-link dispositions, not only UTC timestamps. Use collection/detail routes
for `/calendar/events` and `/calendar/time-blocks`; creates require Idempotency-Key,
edits/deletes require the relevant ETag.

All-day events have an exclusive endDate. Timed schedules supply localStart/localEnd
and an IANA timezone; explicit DST-gap inputs reject and folds resolve earlier.
An optional TimeBlock Task link needs taskRevision. Creation/editing a block never
changes a Task, completes it or inserts it into My Day.

Recurring Calendar occurrences are virtual. Use series/key identity from the view
and POST `/calendar/events/{id}/series` with the chosen scope/root revision and
exception revision when needed. Do not submit a virtual key as an ordinary Task or
file UUID. ENTIRE_SERIES preserves elapsed history; split operations need their
documented new event/recurrence and idempotency. GET `/calendar/conflicts` provides
bounded advisory overlap results, not a reservation guarantee.

Source: [calendar contracts](../../packages/api-contracts/src/calendar.ts),
[ADR 0010](../adr/0010-calendar-temporal-semantics.md).

## Habits, routines and water

POST `/habits` with type CHECKBOX/QUANTITY/DURATION, unit/target and schedule.
Checkbox is COUNT/"1", duration is integral SECOND, water is QUANTITY/ML with
purpose WATER. GET detail before recording; POST `/habits/{id}/entries` requires
habitRevision and Idempotency-Key. LOG records a quantity; SKIP has no value.
Quantity logs can accumulate; do not replace earlier logs to fake a daily total.

PATCH an entry with its own If-Match and current habitRevision to correct value
or void it; read its `/history` for immutable versions. Historical local dates and
timezones remain. PATCH Habit status PAUSED/ACTIVE pauses/resumes, DELETE archives.
Schedule/target/timezone changes use an effective boundary; past changes require
explicit confirmHistoricalChange. Show that confirmation rather than silently
changing historical expectations.

GET `/habits/{id}/stats` with from/to and optional asOfDate for range-scoped
streaks/completion. Rest/pause/skip are neutral, not achievements; missed due days
break streaks and today's unfinished due day can remain pending. `/routines`
maintains ordered same-owner habit associations. GET `/habits/water-summary` for
exact per-date ML totals. Do not invent a separate water ledger or lifetime score.

Source: [habit schemas](../../packages/api-contracts/src/habits.ts),
[ADR 0011](../adr/0011-habit-history-and-streak-semantics.md).

## Life Areas and Goals

Create/organize `/life-areas`, then POST `/goals` with title and SHORT_TERM/LONG_TERM
horizon. Goal status is PLANNED/ACTIVE/PAUSED/COMPLETED/ABANDONED via PATCH; 100%
does not complete a Goal automatically. Goal hierarchy is organizational, not an
implicit progress roll-up. There is no generic DELETE Goal endpoint.

Start in MANUAL or WEIGHTED mode. To use METRIC, POST a metric under the Goal using
its If-Match, then PATCH the Goal with its new revision/metricId. Nested milestones,
metrics and Task/Habit links advance the owning Goal revision. Source links also
need sourceRevision; Habit contribution windows are explicit. Contributes/weights
must be chosen deliberately, and selected metrics must be deselected before removal.

GET `/goals/{id}/progress` computes current progress. POST `{}` there persists a
SNAPSHOT; POST reflection to `/reviews` persists a REVIEW. Both need current Goal
revision/idempotency; GET `/reviews` reads immutable history. Do not treat a GET
as a saved observation or fabricate prior progress after source corrections.

Source: [Goal schemas](../../packages/api-contracts/src/goals.ts),
[ADR 0012](../adr/0012-goal-progress-and-history-semantics.md).

## Focus, Pomodoro and time entries

POST `/focus/sessions` creates IDLE STOPWATCH/POMODORO, optionally referencing an
actionable Task and its revision. POST session `/start` → RUNNING, `/pause` →
PAUSED, `/resume` → RUNNING. Each transition uses If-Match and Idempotency-Key.
One running/paused timer reserves the owner; 409 may require refetching another
active session. Only IDLE configuration/link/title is editable.

The server derives Pomodoro work/break phases; schedule exhaustion reports
READY_TO_FINISH but still requires explicit `/finish`. `/stop` abandons while
retaining earned work. Reconnect with session detail/history: RUNNING continues
accrual across API/browser restart, PAUSED does not. Finishing/stopping writes
TRACKED work portions once; do not POST duplicate TimeEntries for them.

POST `/time-entries` for explicit manual past intervals; PATCH corrects, DELETE
voids with retained `/history`. Tracked entries are immutable independently of
their session. GET `/productivity/summary` for bounded local-date/timezone summaries;
raw recorded duration, distinct interval union, overlap and live uncommitted work
are separate. `/tasks/{id}/productivity` reads/edits estimates/quadrant through its
dedicated facade; a Task's original DTO is not expanded by arbitrary fields.

Source: [Focus schemas](../../packages/api-contracts/src/focus.ts),
[ADR 0013](../adr/0013-focus-timers-and-time-accounting.md).

## Notes, Journal, Mood, Capture and search

`/notes` and `/notes/folders` support private organization and revisioned edits.
PATCH state ACTIVE/ARCHIVED/DELETED as allowed; use includeDeleted to retrieve a
retained deleted Note before explicit restoration. Note history retains earlier
text. Render Markdown safely; a Task/Goal annotation is a reference, not a mutation.

POST `/journal/entries` for freeform writing, or `/journal/daily-checkins` for a
unique current check-in per date, optionally with an atomic linked Mood. Read a
check-in at `/journal/daily-checkins/{date}`. `/moods` records subjective mood and
nullable energy 1–5. Corrections/deletions retain history; attributed dates/zones
cannot be silently edited. Show private history separately from current values.

POST `/capture` for explicit TASK/NOTE/EXPENSE/HABIT_LOG/JOURNAL/VOICE_MEMO/DRAFT
intake. PATCH text/type or archive/restore while eligible. POST `/capture/parse`
is only a deterministic preview of trailing English today/tomorrow/on YYYY-MM-DD;
ask the user to accept its result. It neither classifies nor writes a Task/date.
There is no AI, transcription or broader NLP service.

POST `/capture/{id}/triage` with source If-Match and Idempotency-Key, choosing
CREATE_TASK/CREATE_NOTE/CREATE_JOURNAL/RECORD_HABIT or ARCHIVE. A successful conversion
commits source/target once; a TRIAGED source cannot be edited/reconverted. Finance
conversion uses the separate online Finance route below. Voice capture first
uploads a valid WAV and references its READY file ID; see the security/file guide.

GET `/search/personal?q=...` searches supported current types. Journal/Mood require
per-request includeJournal/includeMood flags; clear opt-ins and private results
when leaving the sensitive search context. No cross-space/company search exists.

Source: [writing schemas](../../packages/api-contracts/src/writing.ts),
[ADR 0014](../adr/0014-private-writing-capture-and-search.md).

## Personal Finance

1. Create `/finance/accounts` with an immutable currency and optional exact opening
   adjustment; organize flat `/finance/categories`. Read server-computed balances.
2. POST `/finance/transactions` for INCOME/EXPENSE/ADJUSTMENT or `/finance/transfers`
   for an atomic transfer. Money is a positive decimal string, not a JSON number.
   Cross-currency transfers require recorded rate/date and explicit destination
   amount matching exact HALF_UP conversion; no live rate API exists.
3. Correct through POST transaction `/reverse` or `/correct`, with current ETag
   and Idempotency-Key. Do not PATCH/DELETE posted money. Read `/history` and account
   balances afterward; original/reversal/replacement rows remain traceable.
4. Create `/finance/budgets`, then explicitly POST `/{id}/periods` for saved period
   context; edit a period limit with its own revision. Overspend is advisory.
   Saved calendar/timezone/week-start, including Jalali monthly policy, remains
   separate from the current display preference.
5. `/finance/bills` saves obligations/recurrence. GET `/{id}/preview` for bounded
   unpaid/paid/reversed occurrences; POST `/{id}/pay` explicitly posts or links an
   eligible existing transaction. No automatic charge, bank payment or background
   recurring financial posting exists.
6. `/finance/savings-goals` chooses ACCOUNT balance or MANUAL progress exclusively;
   do not add both. Read manual corrections in `/history`.
7. POST `/finance/transactions/from-capture` with captureId/captureRevision and
   explicit expense payload. Preserve the source; read its finance conversion
   identity from the Finance result. Original Capture response shapes remain
   unchanged, so do not expect a new targetTransactionId field there.
8. GET `/finance/reports` or `/finance/export?format=json|csv` with an explicit
   half-open date window and authorized filters. Keep currencies separate and
   include reversal effects. These are personal records, not shared expenses,
   settlements, bank connections or payment processing.

Sources: [finance schemas](../../packages/api-contracts/src/finance.ts),
[ADR 0016](../adr/0016-personal-finance-ledger-and-period-semantics.md),
[currency authority ADR 0017](../adr/0017-iso-currency-minor-unit-authority.md).

## Notifications, analytics and optional rewards

GET `/notifications/preferences` for available channels/public Push key. Opt in
explicitly using PATCH, its revision and Idempotency-Key. Create `/reminders` with
an ABSOLUTE, LOCAL or TASK rule; Task links need taskRevision. Pause/resume/cancel
uses the reminder's current revision. Read `/{id}/deliveries` for safe outcomes.

GET `/notifications` for the inbox; PATCH `/{id}/read` with `{read:true|false}`,
POST `/dismiss` or `/snooze` with its current revision/key. Snooze creates fresh
deliveries and never changes a Task due date. External delivery can be pending,
retrying, unavailable or ambiguous; Task success does not prove a send. Browser
Push additionally needs permission, a service worker and a backend subscription.
There is no real-time inbox stream; poll/refetch within limits.

GET `/insights/overview|tasks|habits|goals|time|finance` using actual separate paths
with from/to, grouping and optional timezone/cohort. Display denominator, source,
freshness, partial buckets and comparison definitions. Overview excludes Finance
unless includeFinance=true; Journal/Mood analytics do not exist. Reduce ranges on
density errors instead of showing a truncated total as complete.

Rewards default disabled. GET/PATCH `/rewards/preferences`; enabling is prospective.
GET `/rewards/progress` and `/rewards/achievements` after worker processing. POST
`/rewards/achievements/recalculate` is bounded/idempotent and does not retroactively
award all past work. Use the three server catalog badges and positive XP totals;
do not invent a productivity score, punitive streak or mood-based reward.

Sources: [notifications](../../packages/api-contracts/src/notifications.ts),
[analytics/rewards](../../packages/api-contracts/src/insights.ts), ADRs 0018–0021.

## Sync, portability and closure

For limited offline work: GET `/sync/status`, complete `/sync/pull` bootstrap,
submit supported `/sync/push` operations with stable client IDs/epoch/revisions,
and continue pull using its exact cursor. Preserve per-item conflicts and resolve
explicitly; never treat HTTP 201 as whole-batch success. Pull 409 requires safe
resync; no offline binary, private Journal/Mood or financial posting is supported.
Full rules are in [types/state](./FRONTEND_TYPES_AND_STATE.md).

Export and deletion are explicit security journeys with password reauthentication,
private proofs, worker states and cancellation after revoked sessions. Implement
the exact sequences in [security/files](./FRONTEND_SECURITY_AND_FILES.md), not a
generic DELETE `/me` or a guessed ZIP download endpoint.
