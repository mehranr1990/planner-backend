# P2-06 local API and invariants

All paths below are under `/api/v1/projects/{projectId}`. Strict Zod parsing,
verified sessions, no-store responses, Origin on unsafe methods, scoped signed
pagination and existing custody/account fencing apply. No Shared activation is
authorized. Existing Personal, assignment and workflow response shapes stay fixed.

| Family                                                              | Operations                                              | Authority and concurrency                                                                                             |
| ------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `/register-items`, `/{id}`, `/{id}/history`                         | list/create/get/update/retire/history                   | full-scope read; `work.manage` writes; item If-Match; create idempotency                                              |
| `/templates`, `/{id}/versions`, `/{id}/deprecate`, `/{id}/previews` | immutable template publication/read/deprecation/preview | full-scope read; `work.manage`, registry If-Match; create/publication/preview idempotency                             |
| `/change-plans/bulk`, `/change-plans/csv`, `/{id}`, `/{id}/apply`   | validate/preview/read/atomic apply                      | `work.manage` plus source operation capabilities; creator admission, 30-minute hash/source/auth checks; plan If-Match |
| `/tasks/{taskId}/estimate`                                          | read/update explicit estimate                           | named-source read/update; source If-Match                                                                             |
| `/tasks/{taskId}/work-logs`, `/{id}/void`                           | list/record/void shared effort                          | full-member source read/update; author-only void; source/log If-Match; record idempotency                             |
| `/capacity-days`, `/{id}`                                           | range list/create/get/update                            | full-scope read; `work.manage` writes; record If-Match                                                                |
| `/work-allocations`, `/{id}`                                        | range list/create/get/update                            | full-scope read; `work.manage`; current accepted assignment and recipient; record If-Match                            |
| `/workload`                                                         | date/zone-bounded explicit workload                     | full-scope read, active eligible admission and accepted current assignment only                                       |
| `/reports/current`, `/reports/snapshots`, `/{id}`                   | current report/create/read immutable snapshot           | full-scope read; `work.manage` snapshot creation and idempotency; reauthorize source visibility                       |

Risk/issue ownership is an explicit generation-bound responsibility reference,
not Task assignment or custody. Risk probability is an explicit integer percent;
issues have no probability. Severity, mitigation and status are explicit values,
without inferred scoring. Edits/retirement retain append-only history.

Project templates contain a version-1 safe plan definition: phases, sections,
milestones, fresh OPEN Tasks, explicit estimates and DAG edges. Definition UUIDs
are local keys, validated against their declared closure; they are not live
resource references. No member, file, approval, Personal or work-log links are copied.
Versions/deprecation preserve existing work. Application to the authorized owning
Project is explicit preview/apply, with fresh source IDs and no assignment consent.

Bulk supports create/update Task commands, including explicit estimates/schedules.
Every source mutation calls Tasks' existing public commands and workflow/dependency
guards. Approval-required/ambiguous status transitions cannot be bypassed. Use the
existing reschedule workflow for dependency-chain date changes. Duplicate source
commands are rejected. All-or-nothing rollback is the commit policy.

CSV is UTF-8 text, at most 256 KiB/100 data rows; quoted separators/newlines,
escaped quotes, BOM and CRLF are supported. Required header: `title`. Optional
headers: `description,priority,estimatedMinutes,plannedStartAt,dueAt,scheduledDate`.
Unknown/duplicate headers, malformed CSV, invalid values and formula-leading cells
return at most 100 row/column/error-code issues, without echoing sensitive values.
CSV creates fresh OPEN Tasks only; no arbitrary owner/member/file references or
implicit updates. Validation failure creates no plan or Task. Valid preview never
changes source data. Plans are immutable, creator/generation-bound and expire in
30 minutes; source revision or custody authorization changes invalidate apply.

Shared estimates reuse Task's existing nullable 0–10,080 minute field through its
owner. Explicit work logs are author-bound UTC intervals, second precision, at most
24 hours. They are separate from Personal Focus/TimeEntry; recorded effort is
additive, not attendance or distinct elapsed time. Corrections void and replace.
No membership/profile data is copied; history retains local actor references.

Capacity and allocations are explicit date/timezone/minute records, with unknown
capacity represented by null. Allocations require a concrete current ACCEPTED
assignment; they do not accept assignments or schedule Tasks. Workload excludes
departed/closed/old-generation participants and ended/pending assignments and counts
only actionable sources. Overbooking is a warning computed from explicit allocated
minutes and known capacity. Task estimates are shown separately and deduplicated
per member/date; contributor work does not inflate the Project estimate denominator.

Reports declare current visible Task count/status/estimate denominator, overdue
as-of time, completed-in-window count, explicit clipped work-log seconds and open
risk/issue counts. Snapshot sources have actual scoped Task FKs/revisions and are
reauthorized on every read. Ranges are at most 93 days; report/workload scans stop
with a safe size error above 10,000 relevant records, rather than return partial
totals. No private Focus, Calendar availability, Journal, Finance or scores are read.
