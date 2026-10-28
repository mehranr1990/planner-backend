# P1-02 recurring tasks and task tools

The approved policy is [ADR 0008](../adr/0008-task-recurrence-semantics.md).
All paths below are under `/api/v1`. A current verified session and Personal
Space authorization are required on every request. Mutations require a trusted
Origin. Foreign and absent IDs both return safe 404; stale revisions return 409.
Resource reads/mutations return strong ETags. Lists use the existing scoped
`(createdAt,id)` keyset, default 25, maximum 100.

## Series and identity

`POST /task-recurrences` accepts `{taskId,taskRevision,definition}`. The source
must be an OPEN standalone Task without subtasks or an existing occurrence/series
role. This preserves its UUID, Task history and attachments. The new series has
its own revision. The master is non-actionable: ordinary Task lists, including
saved-filter execution and status/due/trash predicates, exclude it; direct scalar,
completion/reopen, checklist, association, delete/restore and subtask writes are
rejected. The direct Task read/history remains available to its owner. Future
planning/statistics consumers must use actionable Task reads and exclude masters.
No planning/statistics API is introduced here.

`GET /task-recurrences`, `GET/PATCH/DELETE /task-recurrences/{id}` and
`GET /task-recurrences/{id}/occurrences` expose series state. DELETE retires the
series and cancels pending occurrences; no historical row is deleted. PATCH and
DELETE require the series If-Match. Series metadata mutations have safe audit
actions and existing version-1 task.updated outbox consequences. A relation-only
change does not invent a Task scalar change or alter its Task revision. Real
scalar changes still append TaskChange and advance the Task revision atomically.

Each actionable occurrence has one ordinary Task, its own occurrence UUID and
revision, and immutable `(seriesId,recurrenceKey)` uniqueness. The key uses the
original local date plus persisted `identityTime`; editing the schedule's wall
time does not create another identity for the same date. The current schedule
context is stored separately. Segment lineage is an owned, unique predecessor
FK; no loose polymorphic links or new infrastructure are used.

## Definition and temporal rules

Definition version is 1 (defaulted on input and explicitly persisted). Supply
startDate, nullable inclusive endDate, `localTime` (`HH:mm`), IANA timezone,
rule, and exclusionDates. Dates are Gregorian literals between 1900-01-01 and
9998-12-31. This avoids boundary overflow while preserving long-lived schedules.
Intervals range from 1 to 1000. Exclusions are unique local dates (maximum 1000),
normalized/sorted; weekdays are unique ISO weekday numbers, Monday=1.

| Rule kind    | Parameters and anchoring                                               |
| ------------ | ---------------------------------------------------------------------- |
| DAILY        | interval calendar days from startDate                                  |
| WEEKLY       | interval weeks, same weekday as startDate                              |
| WEEKDAYS     | interval Monday-anchored weeks containing startDate; selected weekdays |
| MONTHLY_DATE | interval months from start month; day 1–31                             |
| MONTHLY_NTH  | interval months; weekday and nth 1–5 or -1 for last                    |
| YEARLY       | interval years; month/day, permitting February 29                      |
| INTERVAL     | DAY/WEEK/MONTH/YEAR interval, anchored to startDate                    |

Missing monthly dates and non-leap February 29 are skipped rather than clamped.
Spring-forward gaps create SKIPPED/DST_GAP records without creating a Task;
fall-back folds use the earlier UTC instant. Policies are explicit response and
database fields. The pure resolver uses the runtime's IANA timezone data and
checks exact wall-clock matches against offsets on both sides of transitions;
host-local timestamps never determine schedule behavior. No dependency is added.
Changing account timezone never changes the saved series timezone or historical
context. Exclusion dates produce no occurrence or Task.

`POST /task-recurrences/{id}/catch-up` takes `{through,limit?,cursor?}`. There is
no timer or worker. Each call scans at most 366 local dates and handles at most
100 candidate occurrences (default 50); sparse schedules therefore also remain
bounded. Follow nextCursor until null. Progress and generated rows commit
atomically. A call without cursor resumes persisted scannedThrough; a replayed
cursor retrieves the existing identities. Cursors bind actor, space, series,
series revision and through; changing a definition invalidates earlier cursors.
Limits are request bounds, not a lifetime cap. All missed valid instances remain
PENDING. State/receipt/history/outbox and advisory locks are PostgreSQL-backed,
so restart and concurrent generation cannot duplicate work. The DB unique key
provides a second integrity barrier.

Materialization copies master title, description, priority, unchecked checklist
and current label links. dueAt is the resolved occurrence instant; scheduledDate
is its local date; plannedStartAt starts null. Parent links, private attachment
links, completion state and completed checklist values are not copied. Existing
attachment permissions/downloads remain governed by the original file contracts.

## Occurrence lifecycle and editing

`GET /task-occurrences/{id}` returns state/context. `POST .../complete`, `/skip`
and `/cancel` require occurrence If-Match and `{taskRevision}`. They apply only to
PENDING actionable occurrences. Completion updates Task and occurrence together,
emitting exactly one task.completed transition. Skip records USER_SKIP and
cancels the Task without completing it; cancel records USER_CANCEL. Neither
affects the master or siblings. Explicit ordinary Task completion and DONE reopen
also update occurrence state in the same transaction. Skipped/canceled Tasks
cannot be implicitly reopened. Soft deletion of a pending Task records
TASK_DELETED; authorized recovery restores its PENDING state. Completed history
survives deletion. Task history is append-only throughout.

Series PATCH supports:

- THIS_OCCURRENCE: occurrenceId, occurrenceRevision, taskRevision and patch. Only
  a pending occurrence may change; title/description/priority/dates are supported.
  The identity stays fixed and the instance becomes an exception.
- THIS_AND_FUTURE: occurrenceId, occurrenceRevision and definition whose startDate
  equals the original selected recurrence date; optional taskPatch changes copied
  title/description/priority. The old segment retires at splitBefore, retaining
  earlier catch-up. Pending records at/after the boundary are canceled with
  SERIES_SPLIT and Task history; a new master and linked successor are created.
  Successor generation does not duplicate terminal dates retained in ancestors.
- ENTIRE_SERIES: definition and optional taskPatch. Updates this active segment
  and eligible pending non-exceptions, preserving their Task IDs and recurrence
  keys. Removed dates are canceled with SERIES_EDIT. Definitions that move a
  pending instance into a DST gap skip it and retain its now-canceled historical
  Task. Completed/skipped/canceled records and explicit exceptions stay intact.
  Catch-up progress resets for the new definition and existing keys deduplicate.

Retired segments cannot be edited or reopened. Split predecessors may still
catch up dates before their cutoff. No completion/skipping history is silently
rewritten by a series edit.

## Templates, bulk and saved filters

Templates support POST/GET `/task-templates`, GET/PATCH/DELETE
`/task-templates/{id}` and POST `.../{id}/apply`. Store a name and version-1
values `{task:{title,description?,priority?},checklist:[{title}]}` (maximum 100).
Updates/deletion require the template If-Match. Application requires a
Idempotency-Key and `{revision,overrides?}`; the revision belongs to the template.
Overrides can supply title/description/priority/UTC dates/scheduledDate. The new
Task is OPEN and checklist values are unchecked. Ownership, parent, label/file
IDs, lifecycle/internal state cannot be stored or injected. Later template edits
or deletion cannot mutate copied Tasks. Application and receipt are atomic;
replay returns the current owned created Task, even if its source was deleted.

`POST /tasks/bulk` requires Idempotency-Key and `{items:[...]}`, 1–100 ordered
items. Supported actions are PATCH, COMPLETE, REOPEN, DELETE, RESTORE, ADD_LABEL,
REMOVE_LABEL. Each item carries Task id/revision, plus patch or labelId where
needed. Items have independent transactions, authorization and revision checks;
safe errors contain only index, status and code/message. Invalid items do not
invalidate siblings. The report contains succeeded/failed counts. Repeated IDs
run in request order, so an earlier mutation can make a later revision stale.

Bulk item receipts bind actor, space, operation, hashed key/index and the full
canonical request. Snapshot results are validated JSON in the existing
IdempotencyRecord, retained under its existing 24-hour policy; no bulk entity is
introduced. Expected failure paths roll back to a transaction savepoint before
recording a safe rejected result. Replays have no repeated mutation/history/event.
An unexpected service failure may interrupt a partial request; retry the exact
request/key to replay committed items and resume the rest. Changing the body/key
binding returns 409. An actor cannot replay another actor's receipt.

Saved filters support POST/GET `/saved-task-filters`, GET/PATCH/DELETE
`/saved-task-filters/{id}` and GET `.../{id}/tasks`. Store name and
`query:{version:1,where:{...}}`. The bounded DSL is a conjunction of existing Task
list predicates: status, priority, parentTaskId/rootOnly, labelId, scheduledDate,
dueFrom/dueTo, deleted. Default false flags are removed, UTC bounds canonicalized
and keys sorted. Unknown keys, operators, SQL, stored cursors and limits are
rejected. Scoped references are checked on save/update and again at execution;
a deleted referenced Label therefore produces safe 404. Pagination belongs to
execution, not the saved definition. All snapshots and mutations remain private.

## Migration, verification and release

Deploy the fifth migration `202610280002_p1_02_task_recurrence_tools` explicitly
with `pnpm db:migrate:deploy`. It adds only TaskRecurrence, TaskOccurrence,
TaskTemplate, SavedTaskFilter and nullable JSON receipt result storage; it leaves
all prior tables/data/history intact. Composite foreign keys enforce ownership,
unique indexes enforce master/lineage/occurrence identity, and checks constrain
states/reasons/policies/revisions. No schema push/reset is used. On a deployment
failure, stop writers and forward-fix additively; never drop these tables to undo
a deployed migration. Back up DB/files consistently before production migration.

Run `pnpm quality` for required local gates. `pnpm smoke:p1-02` additionally
requires the compiled build, guarded local TEST_DATABASE_URL and migrated test
DB. It starts the actual compiled API, verifies two identities, exercises DST,
catch-up, mixed bulk, replay, template/filter isolation and process restart, then
cleans only its own UUID fixtures and temporary directory. Evidence is written
under ignored `.tools/p1-02/`. Docker/deployment checks remain deferred; P1-03
and workers remain unstarted.
