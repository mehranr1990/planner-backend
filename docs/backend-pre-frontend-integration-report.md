# Backend pre-Frontend integration report (Teams, Company, Shared, Messages & Meetings)

Date: 2026-11-13. Status: **COMPLETE for every approved requirement; remaining items need owner decisions (section 7).** Everything below is implemented and tested against an isolated local PostgreSQL. TM-11 (Team file library) was completed in a follow-up pass. Nothing was verified against a live backend. Shared is not activated. Nothing was committed, pushed or deployed.

Legend:

- **Implemented** means the code exists.
- **Tested** means integration tests ran against an isolated `_test` database or a sandbox schema.
- **Live** means verified against a running backend. Nothing in this report is live-verified.

## 1. Status by module

| Area                                                      | Status              | Notes                                                                                                                |
| --------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Shared cleanup and migration stabilization                | Implemented, tested | The FK catalog was reviewed and re-pinned. The transfer catalogs were extended. The historical M045 literal is kept. |
| Teams (TA, CA, GL, SP, T1, T2/CK, RM, TO, MB, PH, PM, AN) | Implemented, tested | —                                                                                                                    |
| Teams TM-11 file library (FL)                             | Implemented, tested | Folders, versioned files, private upload/download, owner/manager removal (section 2.1).                              |
| Company (OD-9/F1, CP, ER, BU, LS, AT/C4, C1–C3)           | Implemented, tested | C2 goals stay `null` because there is no Company Goal scope (OD-2).                                                  |
| Retention selection (OD-1, R1, R2)                        | Implemented, tested | Needs the operator catalog before activation.                                                                        |
| In-app invitations (OD-4)                                 | Implemented, tested | Covers Team, Company and Project.                                                                                    |
| Meetings M-X6/M-X7                                        | Implemented, tested | Action assignee, action due date, decision proposer.                                                                 |

## 2. API operations: 910 → 973 (+63)

The backend completion pass added 50 operations; the TM-11 follow-up added 13 (section 2.1).

The canonical contract is `docs/api/openapi.json`. `pnpm openapi:check` passes.

The new operations are in `packages/api-contracts/src/backend-completion{,-openapi}.ts`. They are frozen in `tooling/compatibility/backend-completion-api-signatures.json`.

### Teams (36), all under `/teams/{id}`

**Assignments**

- `GET assignments`
- `POST tasks/{sourceId}/assignments`
- `POST assignments/{assignmentId}/accept`
- `POST assignments/{assignmentId}/decline`
- `POST assignments/{assignmentId}/remove`
- `POST assignments/{assignmentId}/reassign`
- `POST assignments/{assignmentId}/remind`
- `GET assignments/{assignmentId}/history`
- `GET my-work` (Assigned to you)
- `GET now-working-on`
- `GET memberships/{accessId}/removal-preview`

**Story points**

- `GET task-points`
- `PUT tasks/{sourceId}/points`
- `GET plans/{planId}/points`

**Capacity and time off**

- `GET capacity/summary`
- `GET time-off`, `POST time-off`
- `POST time-off/{id}/decision`
- `POST time-off/{id}/cancel`
- `GET time-off/{id}/history`

**Goals**

- `PUT goals/{goalId}/period`
- `GET goals/{goalId}/key-results`, `POST goals/{goalId}/key-results`
- `PATCH goals/{goalId}/key-results/{keyResultId}`
- `GET key-results/{keyResultId}/checkins`, `POST key-results/{keyResultId}/checkins`

**Members**

- `GET member-profiles`
- `PUT member-profiles/{accessId}` (job title)

**Notifications and reminders**

- `GET notifications`
- `POST notifications/{id}/read`
- `GET reminder-settings`, `PUT reminder-settings`
- `POST checkins/{period}/remind`

**Projects and analytics**

- `GET project-summaries` (health and shared people)
- `GET analytics/cycle-time`
- `GET analytics/estimate-accuracy`

### Company (7)

- `PUT /companies/{id}/settings/legal`
- `GET ctx/expenses/{expenseId}/review-history`
- `GET ctx/finance/budgets/{budgetId}/change-requests`, `POST ctx/finance/budgets/{budgetId}/change-requests`
- `GET ctx/finance/budget-change-requests/{requestId}`
- `POST ctx/finance/budget-change-requests/{requestId}/decision`
- `POST ctx/finance/budget-change-requests/{requestId}/withdraw`

### Retention (3)

- `GET /retention-policies?context=`
- `GET /spaces/{spaceId}/retention`, `PUT /spaces/{spaceId}/retention`

### Invitations (4)

- `GET /project-invitations`
- `POST /invitations/{id}/proof`
- `POST /team-invitations/{id}/proof`
- `POST /company-invitations/{id}/proof`

### Intentional changes to existing operations

There are 18 exact, owner-approved hash transitions, recorded in `tooling/compatibility/backend-completion-api-extensions.json`:

- **Company settings:** `GET /settings` and `PUT /settings/currency` add the optional `legalName` and `fiscalStartMonth`.
- **Rejection reasons (ER/AT):** the expense decision and financial-approval decision requests now **require `reason` when the decision is `REJECT`**. This is a deliberate breaking request change: a `REJECT` without a reason now returns 400.
- **Approval history:** the financial-approval history adds an optional `reason`.
- **Meeting minutes:** the minutes version requests and responses (9 keys) add the optional `proposedByMemberId`, `assigneeMemberId` and `dueDate`.
- **Team thanks (4 keys):** add the optional `projectId` on create and `project` on read.

**Behaviour change (BU):** `POST ctx/finance/budgets/{id}/adjustments` with an amount now returns 409 `BUDGET_CHANGE_APPROVAL_REQUIRED`. Archiving through the same operation is unchanged.

### 2.1 TM-11 Team file library (13), all under `/teams/{id}`

Contracts: `packages/api-contracts/src/team-files{,-openapi}.ts`. Frozen in `tooling/compatibility/team-files-api-signatures.json`. No existing operation changed.

- `GET file-folders`, `POST file-folders`, `PATCH file-folders/{folderId}`, `POST file-folders/{folderId}/remove`
- `GET files?folderId=<id|root>`, `POST files`, `GET files/{fileId}`, `PATCH files/{fileId}`, `POST files/{fileId}/remove`
- `GET files/{fileId}/versions`, `POST files/{fileId}/versions`
- `POST files/{fileId}/versions/{versionId}/complete` (`application/octet-stream`, `If-Match` = version `revision`)
- `GET files/{fileId}/versions/{versionId}/download` (`private, no-store`, `nosniff`, attachment)

Rules:

- **Storage:** the existing private `StoredFile`/`StoragePort` lifecycle (initiate → claim → write → ready/reject; delete → remove → cleanup). No public URLs; existing MIME, filename and `FILE_MAX_BYTES` limits apply.
- **Create and upload:** any member with `task.create` (Viewers cannot). Only the uploader can stream bytes for a version (others get 403).
- **Read and download:** any current Team member, Viewers included. Every download re-checks Team access and the exact file revision after opening the bytes.
- **Edit, new version and removal:** the file owner or a work manager (`work.manage`). Removal hides the file, deletes every version's private object and finishes cleanup.
- **Folders:** the creator or a work manager renames or removes; removal requires an empty folder. Folders are never moved, so no cycles are possible.
- **Limits:** 100 versions per file, 1,000 folders and 10,000 live files per Team. No storage quota was invented (none is approved).
- **Revisions and idempotency:** `If-Match` on every edit; `Idempotency-Key` on every create; all writes audited.

## 3. Rules and formulas (as implemented)

### Assignments (TA)

- **States:** `PENDING → ACCEPTED | DECLINED`, and `REMOVED` with `endReason` `REMOVED` or `REASSIGNED`.
- **Who can assign:**
  - Assigning someone else needs `work.manage`.
  - A member may assign only themself, and the assignment is accepted automatically.
  - Viewers cannot be assignees.
- **Limits:** one open assignment per Task and member.
- **Concurrency and history:** every change uses `If-Match`. Every change is recorded in `TeamTaskAssignmentEvent` and audited.
- **Decline reason:** visible only to the assignee, the issuer and work managers.
- **Removal preview:** counts the member's open and pending assignments, in-progress assigned Tasks, pending and upcoming time off, and future capacity days.

### Capacity (CA)

- **Net available minutes:** `available − approved time off`, floored at 0.
- **Unknown availability:** when availability is unknown for a day, net availability is `null`. No 40-hour week is assumed.
- **Reserved minutes:** estimates of accepted, open, assigned Tasks scheduled on that day.
- **Actual minutes:** non-voided Shared work logs that start on that day, in the requested time zone.
- **`bookedBasisPoints`:** `reserved ÷ net`. It is `null` if any day is unknown or `net` is 0.
- **Viewers** receive only their own row.

### Goals (GL)

- **Key-result progress:** `clamp((current − start) ÷ (target − start))`.
  - For `MANUAL` key results, the current value is the latest check-in.
  - For `TASKS` key results, it is the number of `DONE` linked Tasks.
- **Goal progress:** the unweighted mean of active key results. It is `null` if any key result is unknown.
- **Expected progress:** elapsed inclusive days of the goal period, in the goal's time zone.
- **Pace:** `ON_TRACK` when progress ≥ expected, otherwise `BEHIND`.

### Story points (SP)

- Story points are an integer from 0 to 1000 per Task.
- They are stored separately from time estimates.
- Switching planning mode never converts anything.

### Check-ins (T2/CK)

- Late replies are allowed for 24 hours after closing, for both `DAILY` and `WEEKLY` check-ins.

### Reminders (RM)

- **Delivery:** in-app only, through a Team inbox. Rows are deduplicated per recipient admission and key.
- **Manual reminders:** sent by work managers. Assignment reminders are limited to one per day.
- **Scheduled check-in reminders:**
  - Optional, set in minutes before close (`reminder-settings`).
  - Created when the recipient reads their inbox.
  - They share the manual reminder's deduplication key.

### Time off (TO)

- **Who can decide:** work managers, never on their own request.
- **Privacy:** reasons and decision notes are visible only to the requester and managers. Viewers see only their own entries.
- **Rules:** overlapping requests are refused, and every change is recorded in history.

### Membership (MB)

- **Job title:** optional, set per admission generation, by the member or `settings.manage`.
- **Invitations:** the existing Owner/Admin-only invitation policy is unchanged; members cannot invite.

### Project health (PH)

| State       | When                                   |
| ----------- | -------------------------------------- |
| `UNKNOWN`   | The Project has no Tasks.              |
| `OFF_TRACK` | Any open Task has `dueAt` before now.  |
| `AT_RISK`   | Any open Task has an open predecessor. |
| `ON_TRACK`  | None of the above.                     |

`progress` is `DONE ÷ (all − CANCELED)` Tasks.

A Project is listed only when the caller can read it independently; unreadable Projects are omitted.

### Identity mapping (PM)

- Shared people are matched only by the shared account `userId` behind each space-local actor.
- Shared people appear only for Projects the caller can read independently.

### Analytics (AN)

- **Cycle time:** the median from the first recorded change to `IN_PROGRESS` until `completedAt`.
- **Estimate accuracy:** the median of `actual ÷ estimate`, counted only for Tasks that have both an estimate and work logs.
- **Thanks linked to a Project:** shown only while the Project stays linked to the Team and the caller can read it.

### Company

- **Rejection reasons:** stored in `CompanyDecisionReason`, next to the immutable review or approval events. They are erased on identity erasure.
- **Budget change requests:**
  - One pending request per budget.
  - Bound to the budget revision at submission.
  - Decided by another scope manager; self-approval returns 403.
  - A rejection requires a reason.
  - Approval appends the immutable adjustment.
- **Legal settings:** `legalName` and `fiscalStartMonth` (1–12) are editable by admins only, with `If-Match` on the Company revision.
- **Existing rules kept:** the policies capability engine (CP), the approval workflows with self-approval prohibition (AT/C4), the staff directory (C1), the KPIs (C2) and the association summaries (C3) are unchanged.

### Retention (R1/R2)

A change is allowed only when the target policy:

- comes from the catalog and parses as valid;
- applies to the space kind;
- has the same market scope;
- has the same disposal action, audience and export authority for every class;
- keeps every active hold and outstanding obligation;
- shortens no class and lengthens at least one.

Other conditions:

- The custody must be `ACTIVE` or `ARCHIVED`.
- No Company custody transfer may be pending.
- Teams and Projects already held in Company custody return 409 `RETENTION_DOMAIN_SCOPED`.
- The catalog read never exposes holds or obligations.

### Invitation proofs (OD-4)

- **Who can get a proof:** only the verified intended recipient, and only while the issuer still has authority.
- **Rotation:** issuing a proof rotates its hash and bumps the revision, so every earlier proof (including the inviter's copy) stops working.
- **Response:** the proof is returned once, with `no-store`.
- **Unchanged:** accept and decline work exactly as before.
- **Enumeration:** all other callers get 404.

## 4. Frontend coverage

E = EXISTING, I = IMPLEMENTED now, B = BLOCKED, NA = not applicable.

### Teams

| Screen        | Coverage                                                                                                                                                                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TS-01 / TM-00 | E: directory and `access/me`. I: `forYou` (`my-work`). B: create needs OD-1 values from the catalog — the backend is now I (`/retention-policies`), but the operator must load policies first.                                                |
| TM-01         | I: "Now working on", booked % (`capacity/summary`). E: everything else.                                                                                                                                                                       |
| TM-02 / TM-15 | I: assignees, pending assignments, accept, decline, remind, revert (remove or reassign), per-assignment history. E: board state and estimate. B: checklist progress and `blockedBy` (no Team decision). Comments: NA (not approved for Team). |
| TM-03         | E: calendar. I: time-off entries come from `time-off` (calendar writes stay `work.manage`).                                                                                                                                                   |
| TM-04 / TM-05 | I: members plan their own work (self-assignment plus existing items), points, sprint points. E: everything else. Weekly ↔ Sprint: no conversion, by decision.                                                                                 |
| TM-06         | I: health and shared people (`project-summaries`).                                                                                                                                                                                            |
| TM-07         | I: periods, key results, pace.                                                                                                                                                                                                                |
| TM-08         | I: weekly summary from daily capacity, time off, job title, removal preview, Viewer-only own bookings.                                                                                                                                        |
| TM-09         | I: daily 24h late window, remind and schedule.                                                                                                                                                                                                |
| TM-10         | I: Thanks → Project.                                                                                                                                                                                                                          |
| TM-11         | I: folders, files, versions, upload, download, rename/move, owner/manager removal.                                                                                                                                                            |
| TM-12         | I: cycle time, estimate accuracy, booked %. B: export snapshot (no Team export model approved).                                                                                                                                               |
| TM-14         | I: reminder settings. E: invite policy (Owner/Admin).                                                                                                                                                                                         |

### Company

| Screen        | Coverage                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------- |
| CO-14         | I: legal name and fiscal month. E: currency. B: time-boxed grants (C9).                   |
| CO-08 / CO-09 | I: rejection reason and review history. E: approval chains (versioned, no self-approval). |
| CO-10         | I: `requestBudgetChange` → change requests.                                               |
| CO-02         | E: policies (capability rules, per CP). B: move (OD-5).                                   |
| CO-03         | E: directory and work details. I: invitation delivery (proof).                            |
| CO-05         | B: OD-2 (no Company Goal scope).                                                          |
| CO-06         | E: resource requests. B: room grid and heat (OD-3).                                       |
| CO-07         | B: OD-6.                                                                                  |
| CO-11         | B: OD-7.                                                                                  |
| CO-12         | B: OD-8 sealed file.                                                                      |
| CO-13         | E.                                                                                        |

### Messages & Meetings

| Area                                                                                                           | Coverage                |
| -------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Conversations (M1 summary, M2 rename, X1 `access/me`, X2 names, timeline, threads, media, receipts, blocks)    | E                       |
| X3 person lookup                                                                                               | E (`/social/discovery`) |
| M-X6 / M-X7                                                                                                    | I                       |
| Meetings: create, RSVP, agenda, minutes review and finalize, action → Task, announcements and acknowledgements | E                       |
| Global search (OD-11), channel settings (OD-10), busy-only calendar (OD-12), announcement remind (OD-13)       | B (owner decisions)     |

### Personal and Projects (addendum)

These were reconciled against `API_COVERAGE_MATRIX.md`; no approved Backend gap was found to implement.

- **Personal:** all phase rows are E.
- **Brain Dump (B3):** B, needs a model decision.
- **Insights patterns (B4):** B, needs a metric decision.
- **Projects:** R1–R12 are E after earlier batches. Project invitations now have the I recipient list and proof.

## 5. Migrations and Shared cleanup

New migrations. All are additive and pass `assertAdditiveMigration`:

- `202611130048_meeting_minutes_attribution`
  - 2 FKs.
  - Byte-identical to the earlier reviewed scratch version, which was already applied to the local test database.
  - Its name sorts before `…048_team_completion`. That is harmless: the two migrations are independent, and nothing has been deployed.
- `202611130051_team_file_library`
  - 3 tables (`TeamFileFolder`, `TeamFile`, `TeamFileVersion`), 13 FKs.
- `202611130050_backend_completion`
  - 11 tables.
  - Adds `TeamSetting.checkinReminderMinutes`, `TeamThanks.projectId`, `Company.legalName` and `Company.fiscalStartMonth`.
  - 45 FKs.

FK catalog:

- The reported Company-era digest `dfe92757bbc4195af37ee19a4d76adc5c7a2ee1726675c1a7135d49e36374b29` (831 FKs) was recomputed independently and matched.
- The Team (35) and Company (19) relations were each verified against the live schema.
- After backend completion the digest was `d5e952906b3367adf34d36dc3b483793b048f2b118fb8e9935251c92b344bc2a` (878 FKs).
- The final digest, after TM-11, is `22158f4960768799fc03ea7fcc67654a1ab66be4e7a7287d30b2e19da817137f` (891 FKs, 272 tables), pinned in `shared-cleanup-catalog.ts`.

Cleanup ownership:

- **Team rows:** `TeamCleanupService` deletes every new Team table first (children before parents).
- **Company rows:** `CompanyCleanupService` deletes `CompanyDecisionReason` and `CompanyBudgetChangeRequest` before their events, budgets and adjustments.
- **Meeting rows:** meeting cleanup deletes actions and decisions before admissions.
- **Task and Goal links:** cascade.
- **TM-11 rows:** Team cleanup deletes file versions, files and then folders from their leaves in the `TEAM_CONTENT` stage, before stored-file rows are purged in `STORAGE`.
- **Custody graph:** every new Team table is registered.

Transfer catalogs:

- **Task:** `TeamTaskState_task`, `TeamTaskAssignment_task` and `TeamTaskPoints_task` were added to the known list.
- **Goal:** `TeamKeyResult_goal` was added.
- All of these are Team-scope keys that a Personal row can never satisfy. Any other unknown FK still fails closed.

`social-upgrade.ts` keeps only the historical M045 assertion (`3554e0a2…`, 777 FKs).

Not changed in the database: Team free text in the new tables, including the time-off reason, follows the existing Team precedent. It is space content kept under the space's retention policy; there is no per-table erasure hook.

## 6. Verification

| Check                                                                                                     | Result                                                                                              |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`                                                                                          | PASS                                                                                                |
| `pnpm architecture`                                                                                       | PASS (602 modules, 0 violations)                                                                    |
| ESLint (changed files, `--max-warnings 0`)                                                                | PASS                                                                                                |
| Prettier (changed files)                                                                                  | PASS                                                                                                |
| `pnpm openapi:check`                                                                                      | PASS (973 operations)                                                                               |
| `pnpm test` (unit, contract, architecture, compatibility)                                                 | PASS: 157 files, 740 tests                                                                          |
| `pnpm db:migrations:check`                                                                                | PASS                                                                                                |
| Integration, focused: `team-completion`                                                                   | 11/11 (includes the TM-11 test)                                                                     |
| Integration, focused after TM-11: team-lifecycle, company-lifecycle, scoped-cleanup, custody-graph, files | 55/55                                                                                               |
| Integration, focused: Company completion, finance and settlements                                         | 49/49                                                                                               |
| Integration, full suite (before TM-11; not repeated)                                                      | PASS: 48 files, 1039 tests (migrations 048–050 deployed to the isolated `_test` database; no reset) |

Not run:

- live tests;
- Playwright;
- Docker;
- Shared activation;
- a populated-data upgrade fixture for migration 050 (it contains only new tables and nullable columns).

## 7. Remaining items

Superseded for the 15 items below by section 9 (all implemented on 2026-11-13; see 9.7 for what remains).

### 7.1 Owner-decision inventory

Sources: the Frontend `docs/integration/BACKEND_REQUIREMENTS.md` (section 6), `API_COVERAGE_MATRIX.md`, `DECISIONS_AND_BLOCKERS.md`, and the earlier Team report. "Live Mode impact" means the Frontend must refuse that one seam ("Not available yet"); no other screen is blocked.

**Phase:** the binding docs assign none of these items to a phase. Phase 6 is the Social roadmap (P6-01 to P6-06, per ADR 0050 and the P6-01 contract) and Phase 7 is Admin/billing; none of them lists these items. Each is therefore "unassigned — owner decision".

| ID                | Exact requirement                                                                                                                               | Backend today                                                                                                                                    | Live Mode impact                                                  | Frontend recommendation on record                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | --------------------------------------------------------- |
| OD-2              | CO-05 Company goals: `goals`, `createGoal`, `updateKeyResult`.                                                                                  | Missing. There is no Company Goal scope; KPI `goals` is `null`.                                                                                  | CO-05 tab and the KPI goal card are refused.                      | Hide in Live Mode until goals exist.                      |
| OD-3              | CO-06 `rooms`, `bookRoom` and `capacity` heat (per-person/per-day series).                                                                      | Partial. Rooms can be modelled as resource types booked through approval requests (C-M4). There is no day grid or heat series.                   | Room day grid and heat are refused.                               | Rooms = resources (no day grid); hide heat.               |
| OD-5              | CO-02 `previewMove`, `moveDepartment` (reparent).                                                                                               | Missing. The tree is fixed at two levels (department → unit) and there is no reparent operation.                                                 | Move UI is refused.                                               | Drop the move UI.                                         |
| OD-6              | CO-07 `kbSave`, `kbCreate`, `kbVersionBody`, `kbRestore` (rich-text body); `kbAck`, `kbRemind`.                                                 | Partial. The knowledge base is file-versioned (upload, publish, download, search). There is no rich text, read acknowledgement or reminder.      | Rich-text editing, acknowledgement and reminders are refused.     | Adopt the file model; drop acknowledgement and reminders. |
| OD-7              | CO-11 `paymentRuns`, `createRun`, `confirmRun`.                                                                                                 | Partial. Per-reimbursement payment acknowledgements exist; there is no batch payment run.                                                        | Payment runs are refused.                                         | Per-reimbursement acknowledgement only.                   |
| OD-8 (+C9)        | CO-12 `employeeFile`, `requestFileAccess`, `addDocument`, `downloadPack`; CO-14 time-boxed grants.                                              | Partial. Employee cases exist. There is no sealed file, access grant or download pack; owner/admin authority still does not open sealed records. | File tab and grants are refused.                                  | Keep corrective-action cases; hide the file tab.          |
| OD-10             | MS-08 channel settings beyond author-delete (`linkPreviews`, `newcomerHistory`, `membersCanPin`, `collapseBlocked`); conversation-level report. | Partial. Author-delete policy and message-level report exist.                                                                                    | Extra toggles and conversation report are refused.                | Hide extra toggles; report via a message.                 |
| OD-11             | MS-07 global message search with filters.                                                                                                       | Partial. Search exists per conversation only.                                                                                                    | Global search is refused.                                         | Scope MS-07 to one conversation.                          |
| OD-12             | Busy-only meetings in source calendars for non-invitees (`forCalendar`).                                                                        | Missing. Non-invitees see nothing.                                                                                                               | Busy-only blocks are not shown.                                   | Hide for non-invitees.                                    |
| OD-13             | MT-04 announcement `remind`.                                                                                                                    | Missing. Acknowledgements and manager totals exist.                                                                                              | Remind is refused.                                                | Drop.                                                     |
| Team checklist    | TM-02 checklist progress on Team Tasks.                                                                                                         | Missing for Team. Checklists exist for Personal Tasks only; there is no Team checklist contract.                                                 | Checklist progress is refused.                                    | None recorded; needs a decision.                          |
| Team dependencies | TM-02 `blockedBy` and Flow view.                                                                                                                | Missing for Team. The Task dependency engine exists for Projects (and drives Project health); the Team design marks it "mock until confirmed".   | `blockedBy` and Flow are refused (Board `BLOCKED` state works).   | None recorded; needs a decision.                          |
| Team export       | TM-12 export snapshot.                                                                                                                          | Missing. There is no Team export model (Company and Project exports exist).                                                                      | Export is refused.                                                | None recorded; needs a decision.                          |
| Personal B3       | Brain Dump: per-day page with ordered lines, sort tags and strike.                                                                              | Missing. Captures and notes exist, but no per-day page model.                                                                                    | Brain Dump stays on the mock adapter; "send to Inbox" is refused. | Backend model, or e.g. one Note per day.                  |
| Personal B4       | Insights patterns: hour-of-day focus distribution, time per context, mood/energy signals, habit-vs-mood, estimate accuracy per category.        | Missing. `/insights/*` returns generic metric cells; Journal/Mood analytics are rejected by design.                                              | Insights tabs show their error state.                             | Backend metrics, or compute client-side.                  |

### 7.2 Operator configuration before Shared activation (OD-14)

- Load the approved `SharedRetentionPolicy` rows with the correct `applicableContexts`. The catalog is empty until then, so create calls cannot choose a version.
- Apply migrations 048–051 as a controlled deploy step.
- Shared remains disabled.

### 7.3 Frontend

- Map the 63 new operations (50 + 13 TM-11).
- Upload Team files in two steps: `POST files` (or `POST files/{id}/versions`), then `POST …/versions/{versionId}/complete` with the raw bytes and `If-Match`.
- Send `reason` on every `REJECT`.
- Replace direct budget adjustments with change requests.
- Use `POST …/proof` instead of expecting the inviter's proof.
- Read Team reminders from `/teams/{id}/notifications`.

## 8. Git working tree

Everything is uncommitted. Earlier uncommitted work is preserved; only files listed in this report were edited.

New files:

- `prisma/migrations/202611130048_meeting_minutes_attribution/`, `prisma/migrations/202611130050_backend_completion/`, `prisma/migrations/202611130051_team_file_library/`
- TM-11: `teams/application/team-files.service.ts`, `teams/http/team-files.controller.ts`, contracts `team-files{,-openapi}.ts`, `team-files-api-signatures.json`, `team-files-responses.spec.ts`
- Team: `team-operations.service.ts`, `team-insights.service.ts`, `team-operations.controller.ts`, `domain/operations{,.spec}.ts`
- Company: `company-finance-requests.{service,controller}.ts`
- Spaces: `retention-selection.service.ts`, `retention-transition{,.spec}.ts`, `http/retention.controller.ts`
- Contracts: `backend-completion{,-openapi}.ts`
- Compatibility: `backend-completion-api-{signatures,extensions}.json`, `backend-completion-responses.spec.ts`
- Tests: `test/contract/backend-completion-routes.spec.ts`
- This report

Modified files: the schema, the OpenAPI snapshot, the cleanup catalog, the transfer catalogs, the services and controllers named above, the Goal and Task facades, `meeting-documents.ts`, the meetings contracts, the compatibility tooling and pins, and the Team, Company, Meetings and settlement integration specs.

## 9. Final Phase 1–5 gap closure (2026-11-13)

Owner-approved scope: the 15 items in section 7.1. This section supersedes the "Backend today" column of 7.1 for those items. Nothing here was committed, pushed or deployed, and Shared stays disabled.

### 9.1 Feature status

| Item                                         | Status                                                                                       | Operations (new)                                                                                                                                           |
| -------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OD-2 Company goals                           | Implemented (Company scopes on the shared Goal engine; KPI `goals` now reports key results). | `contexts/{scopeId}/goals` list/create/read/patch, key-result add/patch, check-ins create/list (8)                                                         |
| OD-3 Rooms and capacity heat                 | Implemented. A room is a Company resource with a room profile.                               | `resources/{resourceId}/room` PUT, `rooms` (day bookings), `reports/utilization` (3)                                                                       |
| OD-5 Department move                         | Implemented as an **employee transfer** between departments (owner text). See 9.7.           | `department-transfers/preview`, `department-transfers` (2)                                                                                                 |
| OD-6 Knowledge base                          | Implemented: Markdown versions, publish, acknowledgements, deduplicated reminders.           | `knowledge/documents/{documentId}/page` read, `versions`, `publish`, `acknowledge`, `acknowledgements`, `remind`; `notifications` list/read (8)            |
| OD-7 Payment runs                            | Implemented as an internal workflow. No money moves.                                         | `finance/payment-runs` eligible/list/create/read/confirm/cancel (6)                                                                                        |
| OD-8 / C9 Sealed employee files              | Implemented: sealed by default, time-boxed grants, documents, download pack.                 | `employee-grants` list/create/revoke; `employee-files/{subjectAccessId}` read, `access-requests`, `documents` create/complete/download/remove, `pack` (10) |
| OD-10 Channel settings, conversation reports | Implemented and enforced (pin restriction, full newcomer history).                           | `conversations/{id}/settings` GET/PATCH, `preferences` PATCH, `reports` create/list/resolve (6)                                                            |
| OD-11 Global message search                  | Implemented over the caller's current conversations.                                         | `GET /messaging/search` (1)                                                                                                                                |
| OD-12 Busy-only meetings                     | Implemented, opt-in per meeting by the organizer.                                            | `meetings/{id}/busy-visibility` PUT, `GET /meeting-busy` (2)                                                                                               |
| OD-13 Announcement reminders                 | Implemented: one reminder per recipient per day, private inbox.                              | `announcements/{id}/versions/{versionId}/remind`, `announcement-reminders` list/read (3)                                                                   |
| Team checklists                              | Implemented on Team Tasks (Task revision `If-Match`, max 100 items).                         | `tasks/{sourceId}/checklist` GET/POST (2)                                                                                                                  |
| Team dependencies (`blockedBy`)              | Implemented on the Project dependency engine; cycles are refused.                            | `dependencies` GET/POST, `dependencies/{id}/retire`, `task-readiness` (4)                                                                                  |
| Team export                                  | Implemented (`work.manage`, audited, Team-visible data only).                                | `POST /teams/{id}/exports` (1)                                                                                                                             |
| Personal B3 Brain Dump                       | Implemented: per-day page, ordered lines, sort tags, strike, undo, send to Inbox.            | `brain-dump/pages` list; `pages/{period}` GET/PUT, `lines`, `sort`, `strike`, `unsort`, `send-to-inbox`, `remove`, `restore` (10)                          |
| Personal B4 Insights patterns                | Implemented for focus, time, signals and habits. Estimates are `unavailable` (see 9.7).      | `GET /insights/patterns` (1)                                                                                                                               |

### 9.2 New and reused operations

- **OpenAPI: 973 → 1040 operations (+67).** All 67 are frozen in `tooling/compatibility/gap-closure-api-signatures.json`, and each maps to exactly one compiled handler (`backend-completion-routes.spec.ts`).
- **One changed response, owner-approved:** `GET …/contexts/{scopeId}/reports/kpis`. `goals` changes from always `null` to `null` or `{source:'COMPANY_GOAL_KEY_RESULTS', goalCount, measuredGoals, averageProgress}`. The transition is recorded in `gap-closure-api-extensions.json`.
- **Reused, unchanged:**
  - Payment acknowledgements (`…/payments/{id}/decision`): confirming a run proposes them, and each beneficiary still acknowledges.
  - Knowledge folders and documents: pages attach to existing documents.
  - Company resources and allocations: rooms and utilization read them.
  - `POST /capture`: Brain Dump "send to Inbox" creates a real capture.
  - Team Task creation; Project dependency semantics.

### 9.3 Migrations and cleanup

- `202611130052_gap_closure`: additive only (22 tables). It passes the generic additive review. Tables: 272 → 294.
- `202611130053_company_goal_source`: replaces `project_source_shape()` so that shared **Goal** rows may also sit in an existing Company context. Task rows stay Project/Team only, and all other branch rules are unchanged.
  - Its bytes are pinned in `tooling/testing/reviewed-company-goal-source-migration.ts`.
  - It is a new migration because 052 is already applied in the isolated test database, so 052's bytes stay unchanged.
- Shared cleanup FK catalog: 946 FKs (55 new), digest `4f789a5d…`. 053 adds no FK.
  - Messaging and Meetings rows are deleted by their own cleanups.
  - Company rows are deleted in `COMPANY_CONTENT` before their sources; Company goals are deleted leaf-first, then through the Goal batch.
  - Brain Dump is removed through the Personal Space cascade.
- Transfer catalogs list `CompanyGoal_goal`.
- Deployment: apply 052 and 053 as one controlled step. The OD-14 retention-policy rows are still required before Shared activation.

### 9.4 Tests

| Check                                                                                                                         | Result                                                         |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `pnpm typecheck`                                                                                                              | PASS                                                           |
| `pnpm lint`, `pnpm format:check`                                                                                              | PASS                                                           |
| `pnpm architecture`                                                                                                           | PASS (620 modules, no violations)                              |
| `pnpm openapi:check`                                                                                                          | PASS (1040 operations)                                         |
| `pnpm db:migrations:check`                                                                                                    | PASS (294 tables; 052 additive review; 053 byte-pinned review) |
| `pnpm test` (unit, contract, architecture, compatibility)                                                                     | PASS: 158 files, 742 tests                                     |
| Integration, 16 files: the 6 feature specs plus the lifecycle, cleanup, custody, erasure, goals and insights regression specs | PASS: 16 files, 365 tests (276 s)                              |

New integration tests cover all 15 items: writing (B3, B4), team-completion (checklist, dependencies, readiness, export), messaging (OD-10/11), meetings (OD-12/13), company-completion (OD-2/3/5/6/8) and company-settlements (OD-7).

They found and fixed three defects:

- `GET /insights/patterns` was shadowed by `/insights/:family`; the controllers are now registered in the right order.
- Conversation reports returned internal `generation`/`reviewerId` columns, failing the contract; only contract fields are projected now.
- Company Goal rows were rejected by `project_source_shape()`; migration 053 fixes this.

NOT RUN: Docker build and start (DEFERRED per AGENTS.md §14), the full integration suite beyond these 16 files, and Playwright or visual tests (out of scope).

### 9.5 Frontend connection requirements

- Map the 67 new operations and the changed KPI `goals` shape.
- Settings rows (conversation, meeting busy, room profile, knowledge page) read `revision: 1` while unset. The first stored write returns 2. Always send the last `revision` as `If-Match`.
- **Brain Dump:** to sort a line, create the destination first (Task, Note, Journal or Event), then call `sort` with its `targetId`. "Send to Inbox" creates the capture itself. Keep `removed` from `remove` to offer undo through `restore`.
- **Insights:** handle `collecting {have, need}` and `unavailable {reason}`. Estimates always return `unavailable`.
- **Utilization:** send up to 12 Gregorian `from/to` ranges. Convert Jalali months on the client.
- **Knowledge:** page bodies are Markdown; render them without raw HTML. Members see only the published version.
- **Employee files:**
  - Upload in two steps: create the document, then send raw bytes to `complete` with `If-Match`.
  - `download` and `pack` stream bytes (`pack` is a ZIP file).
  - A `sealed` result means request access.
- **Reminders:** read Company reminders from `contexts/{scopeId}/notifications` and announcement reminders from `/announcement-reminders`.
- **Global search:** `has` supports only `link`.

### 9.6 Unresolved policy and security items

None of these block the implemented behaviour. Each uses the most restrictive safe default and needs owner confirmation; no new legal, financial or privacy policy was invented.

1. **OD-8 grants.**
   - Only the Company OWNER issues or revokes employee-file grants. Self-grants are refused, and every grant needs a future expiry.
   - The subject always sees their own file.
   - No legal retention period for employee documents was invented: they follow the Company lifecycle.
2. **OD-7.** A run only records the internal workflow and proposes acknowledgements. No payment provider, bank file or tax handling exists.
3. **Retention class.** Brain Dump pages are deleted with the Personal Space (account erasure). The precedent still applies that Team text and time-off reasons are not erased on identity erasure.

### 9.7 What prevents declaring Phase 1–5 complete

1. **OD-5 mismatch (owner decision).** The Frontend seam `previewMove`/`moveDepartment` reparents a department. The owner's text asked for an employee transfer, which is what was built. A department reparent is still not implemented: the tree stays two-level. The Frontend must either call the transfer operations or the owner must approve reparenting.
2. **B4 estimate accuracy per category** cannot be computed: Tasks have no category field. It returns `unavailable: TASK_CATEGORIES_NOT_RECORDED` until a category model is approved.
3. **Smaller gaps:**
   - Room bookings carry no title, because allocations do not store one.
   - Global search does not index media.
4. **Operational gates, unchanged:**
   - The Docker build and start checks are DEFERRED.
   - The OD-14 retention policy rows must be loaded.
   - Migrations 048–053 need a controlled deploy.
   - Shared stays disabled until the owner activates it.

### 9.8 Git status

Nothing was committed, pushed or deployed. The working tree has 125 modified and 95 untracked paths, including all pre-existing uncommitted work, which is preserved.

This batch added:

- the migrations `202611130052_gap_closure/` and `202611130053_company_goal_source/`;
- `gap-closure{,-openapi}.ts`;
- the `gap-closure-api-{signatures,extensions}.json` records and `gap-closure-responses.spec.ts`;
- `reviewed-company-goal-source-migration.ts`;
- these services and controllers:
  - Team work tools
  - Messaging and Meeting extensions
  - Company goals, rooms, knowledge pages, payment runs, employee files and the Company gap controller
  - Brain Dump
  - Insight patterns
  - `goals/application/owned-goals.ts` and `goals/domain/key-results.ts`.

## 10. Final Phase 1–5 closure (2026-11-14)

This section resolves the blockers in 9.7 items 1–3. Nothing was committed, pushed or deployed, and Shared stays disabled. Nothing here is live-verified.

### 10.1 OD-5 department restructuring

Both operations now exist:

- **Employee transfer** (unchanged): `department-transfers/preview`, `department-transfers`.
- **Unit move** (new): a unit moves, as a whole, under another department.

The tree stays Company → department → unit. A context's level is its immutable identity (a DB guard, `AccessScope.kind`), so a department never becomes a unit and a unit never becomes a department. A move keeps the following:

- the unit id, URL and revision chain;
- active seats (they bind to the Company root, never to the department);
- Project/Team scopes under the unit;
- budgets;
- the unit's own policy.

| Rule          | Behaviour                                                                                                                                                                                                                                                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who           | Company OWNER or ORG_ADMIN only. Anyone else gets 403; non-members get 404.                                                                                                                                                                                                                                                                                   |
| Refusals      | Returned as the preview `refusal` or as the move's 409 `code`: `MOVE_SELF_PARENT`; `MOVE_CYCLE` (a department under its own unit); `MOVE_LEVEL_CHANGE` (a department under anything, a unit to the root or under a unit); `MOVE_SAME_PARENT`; `MOVE_POLICY_CONFLICT` (the unit's own DEFAULT rule would no longer be a valid override under the destination). |
| Concurrency   | `If-Match` is the unit revision (`STALE_REVISION`). The body `id` makes the move idempotent; reusing an id for another destination returns `IDEMPOTENCY_CONFLICT`.                                                                                                                                                                                            |
| Authorization | The policy chain is evaluated live on every request, and no access derives from department membership. The destination's rules (including MANDATORY ones) therefore apply from the next request, and nothing inherited from the old department survives. `accessChanges` counts the seats whose structure or directory visibility changes.                    |
| Audit, DB     | `company.context.move` is audited. `CompanyContextMove` is immutable and written first; `company_domain_guard()` lets `CompanyUnit.departmentId` change only to match that record.                                                                                                                                                                            |

### 10.2 B4 Estimates

The Task engine had no category field: labels are free-form and multi-valued.

**Model.** `Task.category` is nullable and limited to `design | admin | writing | errands`, the Frontend's `EstimateCategory` ids. It is set only by the user and never inferred. A DB CHECK allows it on Personal tasks only (`scopeId IS NULL`). Existing tasks stay `NULL`. Project and Team Task contracts are unchanged.

**Calculation.** Window: Personal tasks with status DONE and `completedAt` in the requested range.

- A task is **measured** when it has a category, `estimatedMinutes > 0` and recorded time.
- **Actual** is the union of the task's current RECORDED time entries (TRACKED and MANUAL), so overlapping entries count once.
- Per category, `ratio = Σ actual ÷ Σ estimated`, rounded to 2 decimals. A category needs at least 3 measured tasks; rows are sorted by biggest ratio first.
- Below 5 measured tasks overall the result is `collecting {have, need: 5}`.
- **Suggestion:** given for the top row when its ratio is at least 1.10. `bufferPercent = (ratio − 1) × 100`, rounded to the nearest 5 and clamped to 5–100. Applying it is opt-in on the client.
- `excluded` counts tasks left out as `uncategorized`, `unestimated` or `untracked`.
- The `unavailable` variant stays in the union, but estimates no longer return it.

### 10.3 Confirmed policies

| Policy                 | State                                                                                                                                                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sealed employee grants | Unchanged and confirmed: Company OWNER only, a future `expiresAt` is required, and self-grants are refused (`SELF_GRANT_FORBIDDEN`). The subject always sees their own file.                                                      |
| Employee documents     | They follow the Company lifecycle only. No legal retention period was invented and no automatic deletion was added; this waits for valid OD-14 configuration.                                                                     |
| Payment runs           | An internal accounting workflow; no money moves.                                                                                                                                                                                  |
| Room booking title     | **New.** Optional (at most 120 characters) and set by the booker only. It is private by default (others, including managers, read `title: null`) and visible to everyone in the context only when the booker sets `shared: true`. |
| Global message search  | Text search over the caller's current conversations; `has` supports only `link`. No OCR, video indexing or media extraction.                                                                                                      |

### 10.4 Frontend mappings (all paths under `/api/v1`)

**`previewMove(companyId, departmentId, newParentId)`**

- Call `GET /companies/{id}/context-moves/preview?scopeId={departmentId}[&parentId={newParentId}]`. Omit `parentId` for the root.
- It returns `{scopeId, kind, fromParentId, parentId, people, teams, budgets[{currency, limit}], accessChanges, revision, allowed, refusal}`.
- Map `MovePreview.people` from `people` and `teams` from `teams`.
- `budget` is per currency: show it only when there is exactly one currency, never as a sum.
- Disable "Move" when `allowed` is false and show `refusal`.

**`moveDepartment(companyId, departmentId, newParentId)`**

- Call `POST /companies/{id}/context-moves` with body `{id: <new uuid>, scopeId, parentId}` and `If-Match` set to the preview's `revision`.
- It returns 201 `{id, scopeId, fromParentId, parentId, revision, accessChanges, createdAt}`.
- Then refetch the department and unit lists: the unit appears under the new department, with the same id.
- Moving a top-level department, or anything to the root, returns 409 `MOVE_LEVEL_CHANGE`. Drag targets should therefore offer departments only, and only for units.

**Employee transfer** (existing): `department-transfers/preview` and `department-transfers` (see 9.1).

**Task category** (task editor)

- `GET /tasks/{id}/category` reads it.
- `PUT /tasks/{id}/category` with `{category: 'design'|'admin'|'writing'|'errands'|null}` sets it. Send `If-Match` with the Task revision.
- The write bumps the Task revision, and the ETag is returned. Personal tasks only.

**`EstimatesPanel`** (`InsightPatternResult<EstimatesPattern>`)

- Call `GET /insights/patterns?id=estimates&from&to&timezone`.
- `ready.pattern.categories[{id, ratio}]` and `suggestion` match `EstimatesPattern`.
- The extra fields `tasks`, `estimatedMinutes`, `actualMinutes` and `excluded` are optional to show.
- Handle `collecting {have, need}`.

**Room booking title** (rooms screen)

- Call `PUT /companies/{id}/contexts/{scopeId}/allocations/{allocationId}/title` with `{title | null, shared}`.
- Send `If-Match`: 1 while unset; the first write returns 2.
- The room list adds `bookings[].title`, which is `null` when private or unset.

### 10.5 Contracts, migration and cleanup

- **OpenAPI: 1040 → 1045 operations (+5).** They are frozen in `tooling/compatibility/final-closure-api-signatures.json`, and each maps to one compiled handler.
- **Approved response transitions** (`final-closure-api-extensions.json`; nothing else changed):
  - `GET /insights/patterns`: adds the `estimates` pattern.
  - `GET …/rooms` and `PUT …/resources/{resourceId}/room`: booking items add `title`.
- **Migration `202611140054_final_closure`.** It is byte-pinned (`tooling/testing/reviewed-final-closure-migration.ts`). Contents:
  - `Task.category` and its CHECK;
  - the `SecurityAuditEvent_productivity_fields` CHECK gains `category`, as a superset added `NOT VALID` and then validated;
  - the tables `CompanyContextMove` and `CompanyRoomBookingTitle` (294 → 296 tables);
  - `company_domain_guard()`, identical to before except that recorded unit moves are allowed.
- **Shared cleanup.** The FK catalog grows 946 → 951 (digest `5a2f9c1b…`).
  - `CompanyContextMove` rows are deleted before units, departments and actors.
  - `CompanyRoomBookingTitle` rows are deleted before allocations.
  - Both deletions run in `COMPANY_CONTENT`.
- **Deployment.** Apply 052–054 as one controlled step. The OD-14 retention policy rows are still required before Shared activation.

### 10.6 Tests

| Check                                                                                                                                                                                                        | Result                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check`                                                                                                                                                           | PASS                                                                                                                                          |
| `pnpm architecture`                                                                                                                                                                                          | PASS (624 modules, no violations)                                                                                                             |
| `pnpm openapi:check`                                                                                                                                                                                         | PASS (1045 operations)                                                                                                                        |
| `pnpm db:migrations:check`                                                                                                                                                                                   | PASS (296 tables; 054 byte-pinned review; deployed to the isolated test DB and sandbox only)                                                  |
| `pnpm test` (unit, contract, architecture, compatibility)                                                                                                                                                    | 161 files / 751 tests: 749 PASS, 2 FAIL (expected counters: OpenAPI count, reviewed-migration list), updated; both files then PASS (19 tests) |
| Integration (12 files): company-completion, companies, company-lifecycle, company-staff, writing, insights-rewards, focus, tasks, scoped-cleanup, shared-personal-erasure, custody-graph, personal-lifecycle | PASS: 12 files, 210 tests (189 s)                                                                                                             |

NOT RUN: Docker build/start (DEFERRED), the full integration suite beyond these 12 files, Frontend/Playwright tests.

### 10.7 Remaining gates (unchanged)

- The Docker build and start checks are DEFERRED.
- Shared stays disabled.
- OD-14 configuration must be loaded.
- Migrations 048–054 need a controlled deploy.
- Nothing is live-verified.

## 11. Retention Policy Catalog v1.0 and final Backend status (2026-11-14)

**Implementation is complete. Nothing is live-verified.** Shared stays disabled, and nothing was deployed.

### 11.1 Retention catalog

The full mapping is in `docs/retention-policy-catalog-v1.md`. No schema, migration or OpenAPI change was needed.

- **Seeded** (development and pre-production only; immutable rows; PURGE only; no holds):
  - `mp-rpc-v1.0-work` covers PROJECT and TEAM. Content is kept for 0 after closure and audit records for 2 years.
  - `mp-rpc-v1.0-conversation` keeps messages for 3 years.
  - `mp-rpc-v1.0-meeting` keeps minutes and decisions for 5 years.
- **Seed command:** `pnpm retention:catalog:seed --target=development|pre-production [--apply]`.
  - It is a dry run by default and idempotent.
  - It never overwrites a differing row and never triggers cleanup.
  - It has been applied to the local development database only.
- **Not seeded:**
  - COMPANY: financial records (7 years proposed) and sealed employee files are pending legal review.
  - SOCIAL_GROUP: v1.0 defines no rule.
  - Until a COMPANY policy is approved, Company creation has no catalog version to choose.
- **Outside the catalog:** Personal data, notification, invitation and temporary-upload rules have no catalog class. Their existing lifecycles are unchanged.

### 11.2 Final verification

| Check                                                     | Result                     |
| --------------------------------------------------------- | -------------------------- |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check`        | PASS                       |
| `pnpm architecture`                                       | PASS (624 modules)         |
| `pnpm openapi:check`                                      | PASS (1045 operations)     |
| `pnpm db:migrations:check`, `pnpm db:validate`            | PASS                       |
| `pnpm test` (unit, contract, architecture, compatibility) | PASS: 162 files, 755 tests |
| `pnpm test:integration` (full suite, isolated test DB)    | PASS: 49 files, 1057 tests |

NOT RUN: Docker build and start (DEFERRED), live and Frontend tests.

### 11.3 Remaining before Live Test

- The operator approves the catalog for production.
- Legal review of the COMPANY policy (finance, sealed employee files).
- A SOCIAL_GROUP rule is decided.
- Migrations 046–054 are deployed as a controlled step.
- Docker build and start checks pass.
- Shared is activated only after the steps above.
