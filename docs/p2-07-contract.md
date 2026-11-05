# P2-07 local contracts

All routes are under `/api/v1/projects/{projectId}` with verified sessions,
Origin checks for unsafe methods, strict Zod parsing, no-store responses and the
existing account/custody transaction fence. The checked OpenAPI adds 30 operations
and preserves all earlier operation and component signatures.

| Family                                                            | Behavior                                                                                      | Authorization and concurrency                                                                                                                                                          |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `documents`, `{id}`, `{id}/versions`                              | Current document, immutable published versions, versioned retirement                          | Current Project read; `work.manage` publication; create idempotency and edit/retire If-Match                                                                                           |
| `comments`, `content/{kind}/{id}/comments`, `{commentId}/history` | Typed Project/Task/Goal/Document parent, current comments and retained author history         | Current parent read plus explicit `comment.create`; author-only edits/deletion/history; If-Match                                                                                       |
| `files`, `content/{kind}/{id}/files/{fileId}`                     | Private initiation, binary completion, safe JSON retry, authorized metadata/download/delete   | Separate `file.read` and parent mutation capability; current parent check; uploader-only completion; delete If-Match; file throttles                                                   |
| `files/reconcile`                                                 | At most 25 stale failed/deleted/expired attempts                                              | Project `work.manage` plus `file.read`; claim, private IO, fresh authorization and acknowledgment                                                                                      |
| `content/{kind}/{id}/activity`                                    | Metadata-only activity for currently visible typed parents                                    | Current source visibility; file events require `file.read`; no private bodies or raw storage keys                                                                                      |
| `views`                                                           | LIST, KANBAN, CALENDAR, TIMELINE, GANTT, DASHBOARD over existing source Tasks                 | Current Project read or one explicitly granted Task; no sibling counts/edges for narrow access; signed bounded pagination                                                              |
| `content-grant-offers`                                            | Explicit `read`, `comment`, `update`, `complete`, `file.read` within concrete target ceilings | Existing invitation proof, recipient acceptance, admission generation, issuer ceiling and revocation contracts                                                                         |
| `exports`                                                         | Bounded inline JSON or formula-safe CSV                                                       | Current export authority, current source visibility, policy/hard record and byte limits, second publication fence                                                                      |
| `transfers`, `{id}`, `{id}/accept`, `{id}/apply`, `{id}/cancel`   | Personal source to this independent Project; preview/consent/atomic apply                     | Source owner plus `custody.transfer` and selected source create/manage capabilities; current graph/auth hash, 30-minute expiry, creator admission, fresh password and idempotent apply |
| `lifecycle-job`, `recovery-proof`, `recover`                      | Closing-job metadata, fresh-password proof and one-use recovery                               | Recorded active provider-verified custodian; generation/revision; 256-bit proof in `X-Deletion-Recovery`; no recovery after deadline or purge claim                                    |

Views project current Task schedules, estimates, workflows and fields. Time-based
views require explicit date range and timezone, exclusive end, at most 93 dates.
There is no separate board, copied Task store or inferred Personal effort.

Transfer supports standalone Tasks with checklists and consented history, and
flat Goals with metrics/milestones and explicitly consented reviews. IDs survive.
Preview lists selected nodes, revisions, dependent node IDs, private-reference
counts and explicit rejection dispositions without storing private bodies.
Hierarchy, recurrence, unsupported/unknown references, labels, files and other
non-closed graphs are rejected without modification. Personal sync receives
departure metadata, and source notifications contain no former private content.
No arbitrary custody patch, clone operation or shared-to-shared transfer exists.

Files use the existing private `StoragePort`, MIME/size/hash validation and upload
timeout. Bytes stream outside database transactions. Final publication, download
return and retries re-check current authority. Unknown commit outcomes preserve
durable markers for reconciliation. Deleted files disappear from lists/exports.
No storage key, public URL, recovery proof or Personal user identity appears in
Project DTOs. Export is inline: no new retained artifact or background export job.

Shared closure uses the ADR 0029 30-day elapsed-UTC recovery window; Personal's
seven-day behavior is preserved. Cleanup runs in the existing durable maintenance
job: at most 25 private files per pass, bounded owner-facade row batches, durable
leases/stages and independently signed system evidence. Calendar bridge removal
preserves the private TimeBlock. Existing financial, journal, focus and other
Personal records are never adopted as shared work.

Missing/invalid retention configuration, outstanding typed obligations/holds,
unknown FK catalog changes, live memberships, unsafe lease state and unsupported
dispositions block destruction. The implemented disposition is PURGE;
PSEUDONYMIZE remains blocked until a reviewed algorithm is supplied. No retention
duration or release evidence is invented. Operator release is an explicit CLI
operation after build, with configured environment: `node
tooling/scripts/shared-lifecycle-admin.ts release <spaceId> <jobId> <revision>
<hold-or-obligation-id> <evidence-reference>`. It releases only that recorded item;
all other gates remain effective. Never execute against production as part of
local implementation or API startup.

Shared activation remains disabled until operator retention, security acceptance
and independent control/operational prerequisites pass. Local synthetic fixtures
do not satisfy production release acceptance. Phase 3 has not started.
