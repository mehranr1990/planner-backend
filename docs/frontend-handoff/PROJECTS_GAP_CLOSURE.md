# Projects gap closure — backend integration

Batch P2-GAP-CLOSURE. Canonical contract: [openapi.json](../api/openapi.json),
mirrored as [handoff OpenAPI](openapi.json). There are 1,092 operations, including
36 new operations in this batch. Frontend code has not been modified.

All paths below have `/api/v1` prefix; `P` means `/projects/{projectId}`.
All operations require the existing verified session and current Project
authorization. Mutations require the existing trusted Origin. Shared activation,
retention admission, archived/closed state and role restrictions remain enforced.
Use `/projects/{id}/access/me` for current capabilities. Project resource grants
do not imply full Project access to reports, invitations, workflows or library.

`R` below means strong `If-Match: "<revision>"`. `K` means Idempotency-Key.
Create clients keep the same ID, key and body for retries. A changed request under
the same key conflicts. Read returned ETags; refresh after 409. Some existing
versioned writes intentionally use revision checks without K; do not blindly
retry those as new commands. Responses contain no private storage key/proof.

| New method/path                                         | Request → response                                     | R/K | Required additional authority              |
| ------------------------------------------------------- | ------------------------------------------------------ | --- | ------------------------------------------ |
| DELETE /projects/{id}/tasks/{taskId}                    | empty → 204                                            | R/K | task.delete                                |
| GET /projects/{id}/tasks/{taskId}/subtasks              | ProjectPageQuery → SharedTaskPage                      | —   | task.read for parent and children          |
| GET P/tasks/order                                       | ProjectTaskOrderQuery → ProjectTaskOrder               | —   | full task.read                             |
| GET P/tasks/{taskId}/checklist                          | empty → ProjectChecklist                               | —   | task.read                                  |
| POST P/tasks/{taskId}/checklist                         | ProjectChecklistChange → ProjectChecklist              | R/K | task.update                                |
| POST P/tasks/{taskId}/assignments/{assignmentId}/revert | empty → ProjectAssignmentRevertResult                  | R/K | assignment.accept; named recipient         |
| POST P/tasks/{taskId}/assignments/{assignmentId}/remind | empty → TaskAssignment                                 | R/K | assignment.assign                          |
| GET P/workflow-drafts                                   | ProjectPageQuery → ProjectWorkflowDraftPage            | —   | workflow.publish                           |
| POST P/workflow-drafts                                  | ProjectWorkflowDraftCreate → ProjectWorkflowDraft      | K   | workflow.publish                           |
| GET P/workflow-drafts/{draftId}                         | empty → ProjectWorkflowDraft                           | —   | workflow.publish                           |
| PATCH P/workflow-drafts/{draftId}                       | ProjectWorkflowDraftPatch → ProjectWorkflowDraft       | R/K | workflow.publish                           |
| GET P/workflow-drafts/{draftId}/publish-preview         | empty → ProjectWorkflowDraftPreview                    | —   | workflow.publish                           |
| POST P/workflow-drafts/{draftId}/publish                | empty → ProjectWorkflowDraft                           | R/K | workflow.publish                           |
| POST P/workflow-drafts/{draftId}/discard                | empty → ProjectWorkflowDraft                           | R/K | workflow.publish                           |
| GET /spaces/{spaceId}/invitations                       | ProjectSentInvitationQuery → ProjectSentInvitationPage | —   | current delegated invitation management    |
| POST /spaces/{spaceId}/invitations/{id}/resend          | empty → Invitation                                     | R/K | current delegated invitation management    |
| GET P/health                                            | empty → ProjectHealth                                  | —   | full task.read                             |
| GET P/structure/progress                                | empty → ProjectStructureProgress                       | —   | full task.read                             |
| GET P/activity                                          | ProjectDetailedActivityQuery → ProjectDetailedActivity | —   | full task.read; per-target checks          |
| GET P/scope-history                                     | ProjectDetailedActivityQuery → ProjectScopeHistory     | —   | full task.read; per-target checks          |
| GET P/analytics                                         | ProjectReportWindow → ProjectAnalytics                 | —   | full task.read; member-filtered aggregates |
| POST P/register-items/{itemId}/checklist                | ProjectChecklistChange → ProjectRegister               | R/K | work.manage                                |
| POST P/register-items/{itemId}/close                    | ProjectRiskClose → ProjectRegister                     | R   | work.manage                                |
| POST P/register-items/{itemId}/convert                  | ProjectRiskConvert → ProjectRegister                   | R/K | work.manage; task.create for TASK          |
| GET P/files/config                                      | empty → ProjectFileConfig                              | —   | file.read                                  |
| GET P/file-folders                                      | ProjectPageQuery → ProjectFileFolderPage               | —   | file.read                                  |
| POST P/file-folders                                     | ProjectFileFolderCreate → ProjectFileFolder            | K   | work.manage + file.read                    |
| PATCH P/file-folders/{folderId}                         | ProjectFileFolderPatch → ProjectFileFolder             | R   | work.manage + file.read                    |
| DELETE P/file-folders/{folderId}                        | empty → archived ProjectFileFolder                     | R   | work.manage + file.read                    |
| GET P/file-library                                      | ProjectFileLibraryQuery → ProjectFileLibraryPage       | —   | file.read; per-target checks               |
| GET P/files/{fileId}/metadata                           | empty → ProjectFileLibraryEntry                        | —   | file.read; per-target checks               |
| PATCH P/files/{fileId}/folder                           | ProjectFileMove → ProjectFileLibraryEntry              | R   | work.manage + file.read; source checks     |
| GET P/files/{fileId}/versions                           | empty → ProjectFileVersions                            | —   | file.read; source checks                   |
| POST P/files/{fileId}/versions                          | ProjectFileVersionCreate → ProjectFile                 | R/K | work.manage + file.read; source checks     |
| GET P/files/{fileId}/versions/{versionId}/download      | empty → binary stream                                  | —   | file.read; current source checks           |
| GET /projects/templates/catalog                         | empty → ProjectInitialTemplates                        | —   | verified session; Shared enabled           |

Schema names above have `Schema` suffix in `@mehran/api-contracts`. Exact types,
HTTP statuses and validation bounds are in OpenAPI. New folder/file-version and
draft creation return 201; new assignment/checklist/draft actions return 200.
Errors use the existing envelope: 400 invalid input/cursor, 401 no session,
403 unavailable capability/retention/preference policy, 404 foreign/inaccessible
resource, 409 stale revision/invalid state/idempotency conflict, 413 bounded-query
or upload limit, 429 rate limit. Do not display hidden resource identifiers from
failed requests. Useful specific conflicts include TASK_HAS_ACTIVE_CHILDREN,
PROJECT_PHASE_MISMATCH, PROJECT_KEY_CONFLICT, FOLDER_CYCLE, FOLDER_NOT_EMPTY,
FILE_VERSION_LIMIT and RISK_ALREADY_CONVERTED_OR_UNAVAILABLE.

Pages use existing opaque `after`/`nextCursor`, limit 1–100 default 25. Never
construct cursors. Ordering cursors bind the current scoped order snapshot; after
a reorder, restart pagination on invalid cursor. Activity is newest first by
createdAt/id and accepts taskId, actorId and action filters; queries scanning more
than 10,000 rows fail with ACTIVITY_FILTER_TOO_BROAD. Reports require UTC
fromAt/toAt with a window at most 93 days. Draft/file/folder/invitation pages use
their scoped cursors. Versions return at most 100 entries without a page cursor.

## Changed contracts and actions Claude must wire

1. Creation: POST `/projects` accepts optional key, startDate, endDate, color,
   template and ownerTeamId alongside existing identity/title/description and
   retentionPolicyVersion. Validate all fields; create setup in one request with K.
   Initial catalogue is exactly Blank/Kanban/Scrum v1. Kanban publishes native Task
   statuses; Scrum additionally creates Backlog and Ready sections. It creates no
   arbitrary sprint, task, assignee, duration or automation. Null key is supported.
   Keys are trimmed and case-insensitively unique per current owner account or
   selected Team. Original spelling and IDs/URLs remain. Handle conflicts without
   suggesting global key availability. Existing metadata PATCH still edits keys.
   Changing owner can conflict in the recipient namespace and rolls back safely.
   A normal Team portfolio reference does not change the selected key namespace.
2. Team selection: send only an authorized Team ID. Creation atomically adds the
   existing TeamProjectReference; Project custody and admissions stay independent.
   Being a Team member does not admit anyone into the Project. Existing Team
   transfer/retention controls remain. Rehome key namespaces if a Team is removed;
   a collision blocks deletion and requires an explicit owner key edit.
3. Tasks: existing POST tasks adds parentTaskId; PATCH adds parentTaskId (null
   detaches), position and sectionId (null clears). Depth remains five. Parent
   deletion with active children conflicts: detach/move/delete children explicitly.
   DELETE is a tombstone; history/files/comments/time records remain, active
   assignments close and dependencies retire. Existing bulk/CSV command schemas
   retain their earlier fields; use direct task endpoints for new hierarchy/order.
   Render ordered IDs from tasks/order, then current source data; legacy LIST
   entries also add sectionId/position. Standalone Task URLs remain supported.
4. Checklist and assignment recovery: use Task revision for checklist, assignment
   revision for revert/remind. Withdrawal keeps immutable accepted history and
   creates a new pending assignment; render both returned records. No arbitrary
   withdrawal window. Reminders support pending or accepted overdue work, enforce
   once per UTC day and reuse in-app preferences/outbox. Notification kind adds
   WITHDRAWN/REMINDER. Do not create another browser reminder scheduler.
5. SharedTask adds optional createdAt, parentTaskId and nullable firstStartedAt;
   startedAt is evidence from persisted IN_PROGRESS events, never creation time.
   Shared projections embedded in Team/MyWork/Calendar add these optional fields;
   existing Team request contracts remain unchanged.
6. Workflow editor: save drafts, preview removal effects, then publish/discard with
   current revision/K. Published versions and existing bindings remain intact.
   Preview reports task counts pinned to removed states, not automatic rebinding.
7. Invitations: management list includes authorized recipientEmail, state,
   createdAt/sentAt, expiresAt, role and private declineNote. sentAt is the in-app
   offer time, not confirmed email delivery. HTTP creation returns proof:null;
   use existing recipient inbox/proof endpoint before recipient accept/decline.
   Resend rotates proofs and returns no acceptance token; use new revision.
   Decline accepts an optional note up to 500 characters; omitted body/no note
   preserves existing behavior. Existing revoke remains available. Terminal
   recipient identity stays scrubbed. Never persist/display inviter acceptance proof.
8. Planning: phase create/patch/output adds startDate/endDate. Existing milestone
   completed/targetDate/phaseId remains authoritative. Use structure/progress for
   counts and percent; CANCELED excluded, empty denominator null. Conflicting
   explicit phase relationships reject both task-link and component edits.
9. Health: show advisory state, reasons, observed metrics and asOf. Missed Project
   deadline with unfinished eligible work gives OFF_TRACK; overdue/blockers give
   AT_RISK; all eligible work complete gives ON_TRACK; ambiguous data gives UNKNOWN.
   No hidden score and no lifecycle transition follows from this read.
10. Workload: retain existing Project capacity/allocations/workload/report APIs.
    Do not infer a working week or import private Personal colleague schedules.
    Missing explicit authorized Project availability means UNKNOWN. New analytics
    adds current visible tasks, current primary assignees, overdue/completed,
    estimates, shared recorded effort, on-time denominator, seven-day throughput
    buckets and median cycle seconds. Read the returned basis fields. Reopen
    intervals count from first recorded IN_PROGRESS to current DONE. Missing start
    evidence is unknown. Overlapping logs union per recorded member.
11. Scope/activity: display actual events only; changes contain safe old/new fields.
    Earlier events may have no changes. Draft details require workflow.publish;
    file events require file.read. Deleted tasks expose removal tombstones in
    scope history without retained private titles. Do not merge with security audit.
12. Risks: register output adds code, checklist, closeReason/closeNote/closedAt/
    closedByActorId and convertedIssueId/convertedTaskId. Use numeric probability
    0–100; severity remains separate. Close requires reason; existing PUT reopens
    and clears current closure metadata while preserving history. Conversion
    creates ISSUE or TASK atomically and retains source risk/status. Use existing
    comments endpoints with target kind REGISTER_ITEM; comment history is reused.
13. Files: read config for effective maxBytes/types. Existing initiate/complete byte
    endpoints remain; creation adds folderId and output adds uploader actor ID.
    Folder archive requires no live children/files. Library metadata revision is
    distinct from StoredFile revision. Initiate a version with metadata revision
    and K, then upload its real bytes through the returned existing pipeline.
    Highest numbered READY binary is current, failed/incomplete uploads cannot
    replace it. Original is version 1; use explicit version download route.
    Existing attachment references remain stable. Root deletion denies all versions.

## Integration corrections (2026-11-17)

- **D9 manual Project Status:** no approved manual status vocabulary or initial
  value exists in the inspected contracts or ADR 0053. `metadata.status` remains
  the read-only custody lifecycle; `statusNote` remains editable text. The advisory
  `/health` endpoint remains computed and separate. Do not render lifecycle or
  health as an editable manual status. Owner decision needed: exact manual status
  values and initial value for existing/new Projects, before adding its API.
- **Workflow editor:** remove the promise to map/move tasks out of removed
  statuses during publication. Use: "Publish a new workflow version. Existing
  tasks keep their current version and status." Preview counts describe pinned
  bindings, not a task migration. ADR 0053 preserves those bindings; a mapping
  payload is not supported. Resolve a publication conflict by refreshing the
  workflow and draft before retrying with the current revision.
- **PB-18:** HTTP 409 keeps `error.code: "CONFLICT"`, the generic message and
  requestId. Optional `error.details` uses the existing array shape. A resource
  reason has `path: ""` and one of these codes: `PROJECT_KEY_CONFLICT` (creation
  or metadata key collision), `TASK_HAS_ACTIVE_CHILDREN` (parent deletion),
  `WORKFLOW_PUBLICATION_CONFLICT` (stale draft/base workflow revision or conflicting
  publication), `WORKFLOW_DRAFT_TERMINAL` (already published/discarded draft).
  Handle absent/unknown details with the generic conflict UI. Other errors and
  authorization behavior remain unchanged; no private IDs or SQL are returned.
- PB-13 probability remains numeric 0–100; PB-14 capacity remains UNKNOWN without
  sufficient authorized availability. Guest-grant extensions remain deferred.
- Local Shared activation still requires the actual security prerequisites.
  ADR 0049 requires malware-engine integration/scanning before Shared activation;
  structural file validation is not that clearance. The authorized development
  activation request does not itself supply completed scanner evidence.

## Existing extra capabilities are preserved

The backend already supports **custom Project templates**: create, publish new
versions, read/list, deprecate, preview and apply inside the Project through
existing `/templates` and `/change-plans` routes. These remain available if the
frontend wants to expose them later. This batch adds no custom-template features;
the three initial creation templates are a separate catalogue.

Existing resource invitation/grant, guest and viewer capabilities also remain.
Their previous per-resource restrictions still apply. **No new Guest Grants**
were implemented or removed. Existing Goals, dependencies, custom fields, shared
work logs, exports, report snapshots, Team planning and file attachments are reused.

## Migration and verification state

Baseline commit `892b79aa2b5d3cada942e985bd1405de00a1ed34` and all 84 historical
migrations remain. Following separate owner approval on 2026-11-16, additive
migrations 060–070 are applied to both local mehran_dev and mehran_test: 95
successful migrations each, with matching applied checksums and no unresolved
failures. Existing development records were preserved. Production application and
Shared activation remain separately controlled and were not performed. New typed
FKs are reviewed against fail-closed shared cleanup. The original Company-finance
disposal failure was a shared FK-catalog regression from two Personal Routine
references; its 20-test suite passed after the prerequisite fix. Final gate
results and any remaining limitations are recorded in the batch completion report.

Account erasure: an irreversibly ERASED current owner loses the account key
namespace identity; a private erased-owner tombstone preserves the original key
and Project history without retaining the User ID or blocking Personal erasure.
Migration 070 enforces this in the existing actor-erasure and identity-FK pipeline.
