# P1-01 task operations

Tasks own Task, TaskChecklistItem, Label, TaskLabel, TaskChange and the typed
TaskAttachment link. There is one Task aggregate for roots and subtasks. Goal,
assignment, recurrence, bulk, template, calendar and job behavior is not activated.

All routes are under `/api/v1`, require a current verified Better Auth session,
and resolve Personal Space ownership through the spaces public facade. Mutations
also require a trusted Origin. Caller-supplied ownership and internal fields are
rejected. Foreign and missing resources both return the standard safe 404.

## API and concurrency

- `POST/GET /tasks`, `GET/PATCH/DELETE /tasks/{id}`.
- `POST /tasks/{id}/complete`, `/reopen`, `/restore`.
- `POST/GET /tasks/{id}/subtasks` (GET supports `recursive=true`).
- `POST/GET /tasks/{id}/checklist-items` and
  `PATCH/DELETE /tasks/{id}/checklist-items/{itemId}`.
- `POST/GET /labels`, `GET/PATCH/DELETE /labels/{id}`;
  `GET /tasks/{id}/labels`, `PUT/DELETE /tasks/{id}/labels/{labelId}`.
- `GET /tasks/{id}/attachments`,
  `PUT/DELETE /tasks/{id}/attachments/{fileId}`; `GET /tasks/{id}/history`.

GET Task/Label and versioned mutation responses carry a strong quoted ETag.
Existing Task mutations require `If-Match: "n"`; checklist, label association and
attachment operations use the owning Task's revision. Checklist writes return
`{task,item}` and the Task ETag. Missing/malformed tags return 400; stale writes
return 409 without changes. New Task/subtask/Label resources start at revision 1.
A separately created subtask has its own revision; creating it does not alter
the parent Task record. Label rename/delete uses its Label revision; deleting a
label atomically removes links and revises every affected Task/history/outbox.

Optional Idempotency-Key on Task/subtask creation uses the existing 24-hour
scoped receipt facility. Canonical input includes parent, normalized title,
defaults and timestamps. Changing the body or parent with the same key returns 409. Replays resolve current authorized state; a deleted result returns 404.
Another actor's identically spelled key never exposes or replays the first
actor's receipt. No auth endpoint is wrapped or changed.

## Data and transitions

Titles and label names use NFC normalization, trimmed/collapsed whitespace.
Descriptions are `{format:"MARKDOWN",version:1,content:"..."}` with a 20,000 UTF-16
code-unit limit. They are data returned as JSON; the backend never renders HTML.
Unknown keys, control characters, unpaired surrogates, empty titles and invalid
dates are rejected. Titles are at most 300 code units; labels at most 100.

Create defaults to OPEN and priority NONE. Supported states are OPEN,
IN_PROGRESS, DONE and CANCELED. DONE is available only through complete, which
sets completedAt atomically. Explicit reopen returns OPEN and clears the current
timestamp; historical completion metadata remains immutable. Repeating an
already satisfied transition with the current revision is a no-op. Checkboxes
never complete a Task implicitly. Checklist positions are nonnegative integer
ordering keys, with UUID tie breaking, rather than a dense renumbered sequence.

plannedStartAt and dueAt are UTC instants. scheduledDate is an independent local
date literal, with no implicit timezone conversion or date ordering assumption.
Task/label lists use `(createdAt,id)` ascending keysets; checklist uses
`(position,id)`, history `(revision,id)` and attachments `(attachedAt,fileId)`.
Page limit defaults to 25, maximum 100. Cursors bind actor, space and canonical
filter/parent context, and are positions rather than snapshot guarantees.
Task filters cover status, priority, parent/root, label, scheduled date, UTC due
range and trash. There is no saved-filter DSL or bulk endpoint in this batch.

The default nesting policy is five edges below a root (root depth zero).
Reparenting checks both ancestors and the full descendant height, including
trash, and rejects cycles. A PostgreSQL transaction advisory lock per Space
serializes hierarchy and organization writers across API processes; optimistic
revision checks still reject stale intent. Locks never span file streaming or
network work. Transaction failure rolls back state, links, history and outbox.

## Deletion and recovery

DELETE atomically soft-deletes the active subtree, recording a shared internal
deletion batch and revising each affected Task. Existing independent trash is
untouched. Default reads hide deleted Tasks; `includeDeleted=true` retrieves
recoverable metadata, and `deleted=true` lists recoverable trash. Restore is
allowed strictly before 30 days from deletion. It restores only descendants
still carrying the root's deletion batch, preserving independent recovery,
re-deletion and moves. Expired restore returns 409; expired trash reads return 404. No timer purges private data. Account-closure hard deletion belongs to
P1-12 and must delete owned links/space before provider identities, respecting
creator/actor FKs. No closure endpoint or worker is added here.

## Storage, events and privacy

TaskAttachment was assessed against a generic association: composite FKs to
`(spaceId,taskId)` and `(spaceId,fileId)` preserve typed referential integrity.
It stores only the relationship and attachment timestamp. No duplicate file
content or object registry is created. Binding requires an owned READY file.
Storage's narrow public FileCatalog contract locks readiness inside the caller's
existing Prisma transaction and exposes only safe metadata. Tasks never query
StoredFile directly. File deletion retains an unavailable link with DELETED
metadata; unlink remains possible. Actual bytes remain protected by the existing
authenticated signed-download protocol, with no public URL or volume path.

Each real Task mutation appends safe immutable TaskChange metadata and an outbox
event in the same transaction. History contains field keys, before/after status,
priority, revisions and optional related UUID, never titles, descriptions,
checklist text, label names or file contents. There is no history-edit API.
Events are version 1: task.created, task.updated, task.completed, task.reopened,
task.deleted and task.due_changed. Payloads are strictly empty; restoration uses
task.updated, and a due change also emits task.due_changed. Existing audit denial
evidence includes only opaque resource/actor/request IDs. No consumer, dispatcher,
reward, reminder or background job is implemented in P1-01.

## Migration and operation

Apply `202610280001_p1_01_tasks` explicitly with `pnpm db:migrate:deploy`.
Startup never migrates. It creates six application tables and two enums, plus
composite foreign keys, completion/deletion/revision/history checks and the
functional unique label index `(spaceId,lower(name))`. Existing provider and
application rows are unchanged. Provider fields/indexes/relations remain checked
against the official pinned Better Auth generator; new User backrelations are
application-only Prisma metadata, not provider columns.

Run `pnpm quality` for all applicable local gates. Migration replay includes an
empty isolated schema and a populated P0-04 schema, preserving a READY StoredFile,
settings revision, receipts, audit and outbox evidence. Never reset configured
databases. Docker image, Compose startup/persistence, production TLS, operational
SMTP, encrypted off-host backups and restore drill remain deployment gates.
