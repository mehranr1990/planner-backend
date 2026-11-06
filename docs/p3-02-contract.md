# P3-02 — Team work and planning contract

Authorized by the owner after local acceptance and publication of P3-01 on
2026-11-05. Scope: V3 P3-02; ADRs 0024–0031 and existing Calendar temporal rules.
Shared activation, Company association, deployment and P3-03 are not authorized.

Team Tasks and Goals retain their existing source tables, IDs, history, ownership
and public facades. Team calendar uses the existing CalendarEvent/EventRecurrence
tables and Calendar engine, with an explicit Shared transaction adapter. Personal
attribution remains mandatory; Team rows use boundary-local actors. Personal DTOs,
private TimeBlocks, Project contracts and Personal sync/export stay unchanged.

Team source reads require full Team task.read. Task creation/update/completion use
existing capabilities; Goal management and group calendar writes require the
existing goal.manage/work.manage tiers (Owner/Admin/Lead). Viewer cannot mutate.
Task schedules retain existing UTC/date-only semantics. Goal–Task links are same
Team custody only. No new assignment consent, workflow, resource grant or transfer
rule is invented; existing Project assignment contracts remain unchanged.

TeamPlan owns a WEEK or optional SPRINT with immutable local start/end/timezone,
title, revision and DRAFT→ACTIVE→CLOSED lifecycle. WEEK spans seven local dates;
SPRINT spans 1–93 dates and is entirely optional. Neither implicitly assigns work,
requires a sprint, changes source status/schedule, or copies Project ownership.
Weekly reviews are explicit Team-authored summaries on WEEK plans, revisioned
with current reviewer actor/time and audit; no Personal journal is retrieved.

TeamWorkItem is a typed Task-or-Goal reference with source custody, selected source
revision, rank and optional plan. A null plan means backlog. Creation/movement
requires current Team work.manage and source read under predeclared sorted custody
fences. Project sources require an active P3-01 reference and independent explicit
full Project read. Team membership/reference alone grants no Project rights.
Read/list/page rechecks both authorities, filters unavailable sources before
pagination and never exposes hidden IDs/counts/bodies. Metadata removal remains
Team-authorized and returns no source body. Removing an item/plan association
never deletes or moves its source. Source changes invalidate selected revisions
on mutation; views return current authorized state and the recorded revision.

All new routes are under /api/v1/teams/{id}; strict Zod, current verified session,
Origin, no-store, bounded pages, current quoted If-Match and scoped idempotency
follow existing conventions. Signed cursors bind actor, query, membership generation
and authorization versions; calendar wraps its existing engine position in this
current-authority envelope. Every mutation commits source/receipt/usage/audit/outbox
atomically. No new infrastructure, dependency, private export or background queue.

Verification: focused schema/domain/HTTP/PostgreSQL coverage, both revocation
orders, cross-Team/Project/Personal IDs, hidden pages, idempotency/rollback, exact
money/time/Calendar regressions where affected, populated migration preservation,
one final 13-stage quality run with affected reruns, one compiled restart smoke.
Production and Docker checks remain deferred. P3-02 must remain uncommitted.

## Operation traceability

All operations use verified current identity and full Team read. Mutation tiers are
checked in the same fenced transaction as effects. The route-parity test matches
all 27 methods to the generated OpenAPI; the accepted P3-01 signatures are frozen
from commit ec5053e, including all prior Personal and Project contracts.

| Method/path                                       | Operation ID                                   | Additional authority                                                   |
| ------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------- |
| GET /teams/{id}/tasks                             | teamworkgetteamsidtasks                        | current source read                                                    |
| POST /teams/{id}/tasks                            | teamworkpostteamsidtasks                       | Team task.create                                                       |
| GET /teams/{id}/tasks/{sourceId}                  | teamworkgetteamsidtaskssourceId                | current source read                                                    |
| PATCH /teams/{id}/tasks/{sourceId}                | teamworkpatchteamsidtaskssourceId              | Team task.update/complete                                              |
| GET /teams/{id}/tasks/{sourceId}/schedule         | teamworkgetteamsidtaskssourceIdschedule        | current source read                                                    |
| PUT /teams/{id}/tasks/{sourceId}/schedule         | teamworkputteamsidtaskssourceIdschedule        | Team task.update/complete                                              |
| GET /teams/{id}/goals                             | teamworkgetteamsidgoals                        | current source read                                                    |
| POST /teams/{id}/goals                            | teamworkpostteamsidgoals                       | Team goal.manage                                                       |
| GET /teams/{id}/goals/{sourceId}                  | teamworkgetteamsidgoalssourceId                | current source read                                                    |
| PATCH /teams/{id}/goals/{sourceId}                | teamworkpatchteamsidgoalssourceId              | Team goal.manage                                                       |
| PUT /teams/{id}/goals/{goalId}/tasks/{taskId}     | teamworkputteamsidgoalsgoalIdtaskstaskId       | Team goal.manage                                                       |
| GET /teams/{id}/calendar/events                   | teamworkgetteamsidcalendarevents               | current source read                                                    |
| POST /teams/{id}/calendar/events                  | teamworkpostteamsidcalendarevents              | Team work.manage                                                       |
| GET /teams/{id}/calendar/events/{eventId}         | teamworkgetteamsidcalendareventseventId        | current source read                                                    |
| PATCH /teams/{id}/calendar/events/{eventId}       | teamworkpatchteamsidcalendareventseventId      | Team work.manage                                                       |
| DELETE /teams/{id}/calendar/events/{eventId}      | teamworkdeleteteamsidcalendareventseventId     | Team work.manage                                                       |
| POST /teams/{id}/calendar/events/{eventId}/series | teamworkpostteamsidcalendareventseventIdseries | Team work.manage                                                       |
| GET /teams/{id}/calendar                          | teamworkgetteamsidcalendar                     | current source read                                                    |
| GET /teams/{id}/plans                             | teamworkgetteamsidplans                        | current source read                                                    |
| POST /teams/{id}/plans                            | teamworkpostteamsidplans                       | Team work.manage                                                       |
| GET /teams/{id}/plans/{planId}                    | teamworkgetteamsidplansplanId                  | current source read                                                    |
| PATCH /teams/{id}/plans/{planId}                  | teamworkpatchteamsidplansplanId                | Team work.manage                                                       |
| PUT /teams/{id}/plans/{planId}/review             | teamworkputteamsidplansplanIdreview            | Team work.manage                                                       |
| GET /teams/{id}/work-items                        | teamworkgetteamsidworkitems                    | current source read; each Project source independently read-authorized |
| POST /teams/{id}/work-items                       | teamworkpostteamsidworkitems                   | Team work.manage; each Project source independently read-authorized    |
| PATCH /teams/{id}/work-items/{itemId}             | teamworkpatchteamsidworkitemsitemId            | Team work.manage; each Project source independently read-authorized    |
| DELETE /teams/{id}/work-items/{itemId}            | teamworkdeleteteamsidworkitemsitemId           | Team work.manage                                                       |

POST success is 201; GET/PATCH/PUT/DELETE is 200. Creates, Task/Goal PATCH and
Calendar series edits require Idempotency-Key; updates/terminal commands require
If-Match. Calendar event IDs are engine-issued UUIDs. Other creates use stable
client UUIDs. Reads/pages never replay receipts as authority. 400 invalid input or
cursor; 401 session; 403 role/activation; 404 safe absent/foreign resource; 409
stale revision/generation/selection/state/fingerprint; 429 existing abuse limits.
No request accepts ownerUserId/actor or arbitrary scope. Existing Team guards
retain 30/IP/minute and 20/actor/minute limits; pages cap 100, Calendar range 93
dates, existing recurrence limits and DST policy remain active.

Audit/outbox actions are team.task.create/update/schedule, team.goal.create/update/
link, team.plan.create/update/review, team.item.create/update/remove and calendar.
event.create/change. Payloads carry opaque IDs/actions, never private source bodies.
Current usage ownership is Shared custody for all new records. No worker handler
or schedule was added. Team/Project reference disposal is metadata-only.
