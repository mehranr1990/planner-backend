# P2-04 implementation contract

Owner authorization: publish completed work through P2-03 and continue P2-04.
Sources: approved V3 P2-04/M06, ADRs 0024–0031 and AGENTS.md. P2-05 is not started.
Personal API/DTO, sync and export contracts and all prior shared operations remain
compatible. Shared activation still requires operator retention, independent
current control/checkpoint, security acceptance and operational prerequisites.

## G2 command, operation, authorization and evidence matrix

All paths below are under `/api/v1`. Exact operation IDs come from the canonical
[OpenAPI](api/openapi.json); the handler-parity test matches all 19 operations.
Evidence labels identify named tests in `project-work.spec.ts` and the pure
assignment domain tests. No row confers permission from an ID or client claim.

| Operation                                                                     | Actual operationId                                                    | Current authorization                                                                  | Tests      |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------- |
| GET /projects/{projectId}/assignment-policy                                   | `workgetprojectsprojectIdassignmentpolicy`                            | current full-scope task.read; immutable policy pointer                                 | A, H       |
| GET /projects/{projectId}/tasks/{taskId}/assignments                          | `workgetprojectsprojectIdtaskstaskIdassignments`                      | assignment.assign + source read                                                        | A, M, H    |
| POST /projects/{projectId}/tasks/{taskId}/assignments                         | `workpostprojectsprojectIdtaskstaskIdassignments`                     | assignment.assign + source read; eligible recipient generation; source If-Match        | A, M, H    |
| GET /projects/{projectId}/tasks/{taskId}/assignments/{assignmentId}           | `workgetprojectsprojectIdtaskstaskIdassignmentsassignmentId`          | named current admission or current assignment administrator + source read              | A, N, R, H |
| POST /projects/{projectId}/tasks/{taskId}/assignments/{assignmentId}/accept   | `workpostprojectsprojectIdtaskstaskIdassignmentsassignmentIdaccept`   | named current admission + assignment.accept + source read                              | A, N, R, H |
| POST /projects/{projectId}/tasks/{taskId}/assignments/{assignmentId}/decline  | `workpostprojectsprojectIdtaskstaskIdassignmentsassignmentIddecline`  | named current admission + assignment.decline + source read                             | A, N, R, H |
| POST /projects/{projectId}/tasks/{taskId}/assignments/{assignmentId}/revoke   | `workpostprojectsprojectIdtaskstaskIdassignmentsassignmentIdrevoke`   | assignment.assign + source read                                                        | A, N, R, H |
| POST /projects/{projectId}/tasks/{taskId}/assignments/{assignmentId}/reassign | `workpostprojectsprojectIdtaskstaskIdassignmentsassignmentIdreassign` | assignment.assign + source read                                                        | A, N, R, H |
| GET /projects/{projectId}/tasks/{taskId}/schedule                             | `workgetprojectsprojectIdtaskstaskIdschedule`                         | exact task.read                                                                        | C, H       |
| PUT /projects/{projectId}/tasks/{taskId}/schedule                             | `workputprojectsprojectIdtaskstaskIdschedule`                         | exact task.update + task.read; source If-Match                                         | C, H       |
| GET /me/work/assignments                                                      | `workgetmeworkassignments`                                            | own pending current-generation assignment + current source read; preview only          | A, P, H    |
| GET /me/work/tasks                                                            | `workgetmeworktasks`                                                  | accepted current-generation primary/contributor + current source read                  | A, P, H    |
| GET /me/work/goals                                                            | `workgetmeworkgoals`                                                  | current full-scope or exact Goal read; current grant issuer/generation/expiry          | P, H       |
| GET /me/work/notifications                                                    | `workgetmeworknotifications`                                          | current recipient + current source visibility; acknowledgement If-Match                | N, P, H    |
| POST /me/work/notifications/{id}/read                                         | `workpostmeworknotificationsidread`                                   | current recipient + current source visibility; acknowledgement If-Match                | N, P, H    |
| GET /me/calendar/overlays                                                     | `workgetmecalendaroverlays`                                           | accepted current-generation assignments + current source read; selected Projects/range | C, P, H    |
| GET /me/calendar/time-blocks/{blockId}/shared-task                            | `workgetmecalendartimeblocksblockIdsharedtask`                        | Personal block owner; GET rechecks source separately, DELETE needs no source right     | C, M, H    |
| PUT /me/calendar/time-blocks/{blockId}/shared-task                            | `workputmecalendartimeblocksblockIdsharedtask`                        | Personal block owner + current named Task read/revision                                | C, M, H    |
| DELETE /me/calendar/time-blocks/{blockId}/shared-task                         | `workdeletemecalendartimeblocksblockIdsharedtask`                     | Personal block owner; GET rechecks source separately, DELETE needs no source right     | C, M, H    |

`assignment.assign` defaults to Owner/Admin/Manager and remains configurable only
within the existing ordinary-capability ceilings. A recipient needs an active,
verified, full admission with current read/accept/decline capabilities. Viewer and
grant-only admission cannot bypass those existing ceilings; narrow Task grants
retain their P2-03 read/update/complete behavior. Consent belongs only to the named
recipient and captured admission generation, including when the assigner is Owner.
Current policy is reread inside the custody fence for every command and replay.

Independent Projects require explicit consent. The read-only assignment policy
reports the current immutable capability-policy version and
`mode: EXPLICIT_CONSENT`, `automaticAcceptance: false`. No Company entity exists
yet; mandatory organizational acceptance cannot be enabled in an independent
Project. No speculative organization policy store or configurable bypass was added.

## State, concurrency and idempotency

TaskAssignment stores PRIMARY/CONTRIBUTOR independently from Task lifecycle.
PENDING transitions once to ACCEPTED or reasoned DECLINED. Decline ends that
assignment; revoke/reassign retains the prior consent and response time as history.
A replacement has a new ID and pending consent. DB constraints allow one current
primary and one current assignment per recipient/source; no pending replacement
silently changes the Task. Active assignments are bounded to 100 per source as a
safety ceiling, separate from commercial feature policy.

Create requires the source Task's quoted positive If-Match and Idempotency-Key
(1–128 printable ASCII). Reassign requires the old assignment's If-Match, a current
source revision and Idempotency-Key. Durable creation keys/fingerprints bind the
issuer admission generation, source, recipient, kind and replacement. Replay checks
current assignment/source authority before returning the retained record; changed
fingerprints conflict. Accept/decline have durable same-recipient terminal replay;
changed decline reasons conflict. Other updates require their current revision.
No receipt creates authority or revives ended admissions.

Account/identity/session and sorted custody locks precede owner-module work. New
recipient accounts are predeclared and rechecked. Consent, retained history,
notifications, free-mode usage, audit, shared outbox and authorization versions
commit atomically. Restrictive assignment changes use the existing signed
intent/outcome protocol; missing committed evidence stays quarantined. Source
Task/Goal commands use their owning public facades. Private scheduling uses the
Calendar facade and existing exclusive Personal fence. No network send occurs
inside these transactions.

Strict Zod requests reject overposting and invalid UUIDs, reasons, zones, dates and
cursors. Unsafe requests require trusted Origin; responses are no-store. GET,
PUT and DELETE return 200; POST returns 201. Detail responses include ETag, lists
do not. Standard errors retain existing semantics: 400 invalid envelope/cursor,
401 missing session, 403 current capability/activation denial, 404 safe absence,
409 stale revision/generation/state/fingerprint/cursor authority, 429 abuse and
503 unavailable infrastructure. Global/shared limits remain enforced.

## Work and calendar projections

Pending assignments expose only the authorized acceptance preview, not Task
bodies. `/me/work/tasks` returns the current authorized source state for accepted,
current-generation assignments only; PRIMARY and CONTRIBUTOR remain explicit.
No Task/Goal is copied. `/me/work/goals` uses current full-scope read or exact Goal
grants without inventing Goal assignment states. Source-owned filters precede
pagination and shared UUIDs are deduplicated. Default page size is 25, maximum 100.

Opaque cursors bind actor, canonical query, visible source scopes, role/admission
generations and current authorization versions. Visibility is checked again
inside the locked source transaction, including narrow-grant issuer state and
DB-time expiry. Changed authority requires a fresh query. An actor with no visible
scope receives an empty page after a fresh Personal account/session fence.

Calendar overlays select comma-separated Project UUIDs (`projectIds`, at most
100); omission selects all currently accepted visible work. The range is
`[from,to)` and at most 93 local dates in a validated IANA zone. Ordering is stable
by source UUID. Planned-start instant, otherwise due instant, otherwise scheduled
date supplies the overlay date. Timed sources are converted with current source
owner date semantics and Intl timezone rules; date-only sources retain their local
date. Coarse source date filtering is followed by exact local-date filtering before
page construction. Timezone changes never rewrite source dates or private blocks.

The separate schedule endpoint updates existing Task date fields and history through
Tasks; it preserves the P2-03 Task DTO and requires exact source update authority.
Workflow, recurrence engine changes and shared offline sync are outside this batch.

## Optional scheduling and notifications

Private TimeBlocks are created only by explicit user action through the existing
Personal Calendar API, with a user-controlled title. Linking a shared Task requires
ownership of the block, current source read, selected source revision and block
If-Match. The typed bridge never persists Task content or changes source custody.
After assignment revocation the accepted-work projection disappears; source detail
remains governed by independent read authority. After source access/closure loss,
the owner keeps their block and reference metadata with `UNAVAILABLE` source detail.
The owner can unlink without current source permission. Other users cannot inspect
the private schedule, and Personal export includes only owned scheduling/reference
metadata. No shared body enters Personal sync, Journal, Finance, Focus or annotations.

Notifications are durable in-app records owned by Notifications: assignment creation
notifies the recipient; response notifies the original issuer; revoke/reassign
notifies the prior recipient. They contain opaque references and event metadata,
not source text. Inbox reads and acknowledgements recheck current source visibility
and the current recipient; an unavailable source cannot leave a successful read
acknowledgement behind. No new email/push preference or provider contract is invented.
Existing Personal notification delivery and worker behavior remain unchanged.

Free-mode policy checks run under the same transaction. `task.assignment` usage is
retained shared-custody usage; private Calendar link usage belongs to the Personal
account and is derived from current owned link rows. A denial rolls back all growth.

## Evidence and remaining gates

| Label | Distinct acceptance evidence                                                                                                                                                                           |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A     | Pending preview versus accepted source; both assignment kinds; named recipient and generation; reasoned decline; unique primary; immutable reassignment history; current policy and free-mode rollback |
| P     | Source identity/no copies; current Goal grant filtering; source filters and cursor query/actor/version binding; closure/revocation/session/suspension/readmission removal; no Personal Task leakage    |
| C     | Selected-project overlays, 93-day/IANA validation, local-midnight conversion, private ownership, reference export without Task content, unavailable source retention and unlink                        |
| N     | Metadata-only notices, exactly-once business replay, atomic rollback, current source inbox/acknowledgement and no read effect after source disappearance                                               |
| R     | Independent PostgreSQL connections and observed waits for revoke-first and acceptance-first ordering, atomic notices/audit/outbox and absence of late acceptance                                       |
| H     | Actual HTTP strict bodies, Origin, If-Match, no-store, named consent, source DTOs, inbox read and all nineteen handlers matching OpenAPI                                                               |
| M     | Typed FK/generation/branch forgeries rejected; exact M06 hash/tamper review; populated prior-schema data/checksum/constraint preservation, interruption/resume/repeat; Personal regressions            |

The compiled smoke restarts the real API and bootstraps a fresh worker process,
then verifies consent replay, source projections, local-date overlay, inbox and
private block retention/unlink after membership revocation. Existing compiled
Personal/P2-01/P2-02/P2-03 smokes retain earlier behavior. Full mandatory quality
results and operational checks not run are recorded in the batch report. Synthetic
fixture policies and keys do not satisfy real activation/release prerequisites.
