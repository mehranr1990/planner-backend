# Mehran Planner — Phase 0 & Phase 1 Backend Implementation Specification

**Document ID:** MP-IMP-001 · **Version:** 1.1 · **Date:** 2026-10-14  
**Status:** Implementation baseline, governed by [`PROJECT_INSTRUCTIONS.md`](./PROJECT_INSTRUCTIONS.md).  
**Goal:** Deliver **all backend capabilities of a complete, solo Personal Planner** using incremental, quality-gated batches. Phase 0 establishes only necessary technical foundations. Phase 1 completes the personal product including offline synchronization support in its final batch. No Project/Team/Company/AI/advanced automation code.

## 0. Execution instructions and non-negotiable exclusions

- Build batches **P0-01 → P0-04 → P1-01 → P1-12**, in order. Do not advance until a batch is approved. Specs below are contractual acceptance baselines; missing edge details are resolved by an ADR before coding, not through undocumented improvisation.
- Each module starts with its domain invariants, entities, API schemas and tests. Implement exactly what that batch needs. Do not create unused DB tables just because they are listed in a future batch.
- One global identity per user, exactly one private PERSONAL `Space`, one unified Task engine, one unified Goal engine; strict data isolation.
- Runtime providers: local PostgreSQL on Windows for development; self-hosted PostgreSQL and private file volume in Docker for future deployment; Prisma and Better Auth, as defined in instructions. No mandatory hosted database/storage/queue subscriptions; hosting, off-host backups and outbound email still require operational provisioning.
- API only: `/api/v1`; documents define **resource-oriented route families**, HTTP methods and semantics, not generated code. Add OpenAPI/schema definition in each feature batch.
- Explicitly excluded: Project CRUD/portfolio/Gantt, team sharing/assignment/chat, company governance, meetings service, advanced external connectors/webhooks UI, AI, native calling; no frontend component or UI/navigation work.
- When one apparently simple feature needs a hidden decision (recurrence exceptions, account balance rules, DST), adopt the defaults written below and test them. If implementation would contradict a previously approved decision, raise ADR.

## 1. Scope matrix and business boundaries

| Domain           | Phase 0                                         | Phase 1 output                                                | Future relationship                                       |
| ---------------- | ----------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------- |
| Identity         | full private account/session foundation         | preferences, export/delete workflows                          | Company/Team membership added later                       |
| Ownership        | one private personal space, scope authorization | enforced on every resource                                    | additional space kinds without rewriting personal records |
| Tasks            | no business CRUD                                | complete tasks, checklists, labels, recurrence, bulk, history | assignment/project links later                            |
| Planning         | none                                            | My Day, week planning, rollover, reviews                      | aggregated authorized shared tasks later                  |
| Calendar         | time conventions only                           | event/time block and recurring schedule                       | team/company calendars later                              |
| Habit/Goal       | none                                            | complete personal progress and routines                       | business goal associations later                          |
| Notes/Journal    | no content entities                             | notes, journal, mood, reflections                             | keep private by default                                   |
| Finance          | precision conventions                           | personal tracking/budgets/bills/savings                       | company finance separate, not mixed                       |
| Capture          | none                                            | quick capture + text/voice memo attachment, triage            | future AI classification via adapter                      |
| Notifications    | infrastructure hook only                        | due reminders, in-app, email/push adapters                    | multiuser delivery later                                  |
| Insights/Rewards | no product analytics                            | transparent rules-based trends/XP                             | future reporting scope later                              |
| Offline          | no sync implementation                          | supported personal subset with controlled conflicts           | shared offline decisions separately                       |

## 2. Phase 0 deliverables and acceptance criteria

### P0-01 — Repository skeleton and architecture enforcement

**Build**

- Bootstrap pnpm workspace, NestJS API, shared transport schemas package, typed TypeScript configs, local Windows/Node.js/PostgreSQL development and portable Docker Compose for future single-server PostgreSQL/API deployment, persistent volumes, dev scripts, README.
- Establish module skeleton only for current foundation (`account`, `spaces`, `platform/*`); other modules are created in their Phase 1 batches.
- Enforce module dependency rules and prohibited imports with dependency-cruiser + ESLint; no circular refs or `forwardRef`.
- Define error map, request/correlation ID middleware, Zod validation, uniform JSON response errors, OpenAPI generation, `/health/live`, `/health/ready` (readiness checks DB).
- Structured Pino logging with sensitive-data redaction, validated config, meaningful startup failures.
- GitHub Actions frozen install, format, lint, typecheck, architecture test, Vitest unit/integration with Supertest HTTP tests and build; isolated test DB.

**Acceptance**

- Cold clone documented boot; missing env fails clearly; health reflects DB downtime; invalid payload yields safe error with requestId.
- Architecture test intentionally importing another module's repository fails CI; no production env connections from tests.

### P0-02 — Better Auth, account and private ownership

**Entities** (auth-owned schema installed per provider): `User`, `AuthSession`, `AuthAccount`, `AuthVerification`; application-owned `UserSettings`, `Space`. **Do not duplicate auth tables or manually change library-controlled schemas.**

**Invariant**

- Exactly one PERSONAL `Space` per user; unique `(kind, ownerUserId)` for personal spaces, with a non-null owner conditional on PERSONAL kind; create/reconcile atomically and safely for retries.
- No Phase 0 company/team memberships or generic RBAC hierarchy. Personal access allowed only if verified session principal owns space. A future membership abstraction may be introduced when Team begins.

**Build**

- Sign up, verify email, sign in, sign out, list/revoke sessions, password reset and email change verified with session revalidation. Use Better Auth endpoints where compatible, document route aliases.
- `GET/PATCH /api/v1/me`, `GET/PATCH /api/v1/me/settings`, `GET /api/v1/me/spaces` (returns own personal scope).
- Limit sessions/recovery endpoints; protect CSRF/cookies; no tokens in logs. Seed/dev test identity tools only in isolated environment.

**Acceptance**

- Auth integration test against actual NestJS adapter, session persistence and revocation; no cross-user read by changing resource ID or scope ID; duplicate provisioning race results in one space; verify auth account lifecycle.

### P0-03 — Data/API/transaction/event baseline

**Entities:** `SecurityAuditEvent`, `OutboxEvent`, `IdempotencyRecord` (create only required minimal storage and tests; no worker yet).

**Build**

- Reusable authenticated request context, scoped base repository helper (without hiding query semantics), concurrency/version convention, cursor pagination, safe error mapping.
- Document transaction boundary pattern, event envelope and transactional outbox: write state + outbox atomically; consumer and dispatcher implemented only when first needed.
- Simple audit sink for sensitive auth/account actions; metadata-only payload.
- Add migration safety checks, schema reset for test DB, representative transaction rollback and concurrency tests.

**Acceptance**

- Crash between DB commit and eventual processing cannot silently lose outbox row; duplicate idempotency key/request fingerprint handled safely; migration from empty DB is reproducible.

### P0-04 — Private Docker volume files adapter, hardening and phase gate

**Entities:** `StoredFile` with `spaceId`, owner user, object key, filename, MIME, expected/actual size, checksum (if available), `status=INITIATED|READY|REJECTED|DELETED`, dates, metadata.

**Build**

- Private file storage abstraction; local filesystem volume adapter, authenticated `POST /api/v1/files/uploads`, `POST /api/v1/files/{id}/complete`, `GET /api/v1/files/{id}/download`, `DELETE /api/v1/files/{id}`.
- Upload finalization must verify actual saved-file metadata/size/type against authorization and initiation; filenames not used as paths or storage keys. Stream uploads and authenticated downloads through API; no exposed disk paths or public static mounts; no unsafe file inline render. Retain orphan cleanup contract; scheduled cleanup starts when worker activated.
- Rate limit sensitive endpoints; input caps; security and secret redaction tests; deployment environment and backup/runbook definitions.

**Acceptance**

- Verified private mounted-volume upload/read/delete smoke test in nonproduction, invalid completion rejected, foreign-space file inaccessible, direct filesystem URL inaccessible; tests use isolated temporary volumes.

**Phase 0 exit:** no personal feature implemented yet. Authentication, private storage, ownership, CI and DB lifecycle proven. Any Better Auth ↔ NestJS incompatibility requires approved ADR, not silent replacement.

---

## 3. Phase 1 data model blueprint

### 3.1 Shared conventions

Every primary business aggregate has `id`, `spaceId`, `createdAt`, `updatedAt`, appropriate `revision`, `createdByUserId` where creation attribution is meaningful, and optional `deletedAt` **only if justified**. For scoped child tables enforce parent containment: composite FK `(spaceId, parentId)` → unique scoped parent index, or equivalent explicit enforcement. Avoid all-purpose JSON fields for relational state; use JSON only for small, versioned, non-queryable configuration. Monetary values exact Decimal with currency. Prefer dedicated join tables over polymorphic loose references. Index scope + expected filter + sort.

**Key naming and ownership:** `Space` is an ownership/security boundary and never a company/org workspace; no nullable universal `companyId/teamId` in personal tables. `UserSettings` stores locale, timezone, preferred calendar (Jalali/Gregorian presentation only), first-day-of-week, work hours, module flags and privacy preferences. `PrivacySettings` may be folded into settings unless distinct audit/history is needed.

### 3.2 Entity registry by batch

| Batch | Entity candidates to implement (subject to explicit invariants)                                                                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1-01 | `Task`, `TaskChecklistItem`, `Label`, `TaskLabel`, `TaskChange`                                                                                                                                        |
| P1-02 | `TaskRecurrence`, `TaskOccurrence`, `TaskTemplate`, `SavedTaskFilter`                                                                                                                                  |
| P1-03 | `DailyPlan`, `DailyPlanItem`, `WeeklyPlan`, `PlanningReview`                                                                                                                                           |
| P1-04 | `CalendarEvent`, `EventRecurrence`, `TimeBlock`                                                                                                                                                        |
| P1-05 | `Habit`, `HabitSchedule`, `HabitEntry`, `Routine`, `RoutineHabit` (only if routines represent a needed composite action)                                                                               |
| P1-06 | `LifeArea`, `Goal`, `GoalMilestone`, `GoalMetric`, `GoalTaskLink`, `GoalHabitLink`, `GoalReview`                                                                                                       |
| P1-07 | `FocusSession`, `TimeEntry`                                                                                                                                                                            |
| P1-08 | `Note`, `NoteFolder`, `CaptureItem`, `JournalEntry`, `MoodEntry`                                                                                                                                       |
| P1-09 | `FinancialAccount`, `Transaction`, `TransactionPosting` if needed by transfer model, `FinanceCategory`, `Budget`, `BudgetPeriod`, `Bill`, `SavingsGoal`, `ExchangeRateSnapshot` (when conversion used) |
| P1-10 | `Reminder`, `Notification`, `NotificationDelivery`, `NotificationPreference`, `PushSubscription` (when web push used)                                                                                  |
| P1-11 | `AchievementDefinition`, `AchievementUnlock`, `XpLedger`, `MetricSnapshot` (only where expensive metrics require cached snapshots)                                                                     |
| P1-12 | `SyncMutationReceipt`, `SyncChange` or revision-scoped sync log, `UserExportJob`, `AccountDeletionJob` as required by operations                                                                       |

**Do not implement duplicate `TaskAttachment`, `NoteAttachment`, `ReceiptAttachment` tables without assessing integrity.** Prefer explicit domain link tables each containing foreign keys to the domain owner + StoredFile, with ownership checks; a single generalized file association only if strong referential integrity is preserved.

### 3.3 Stable domain rules and extension strategy

**Task:** Stable ID, `spaceId`, `createdByUserId`, normalized `title`, description (rich text stored with versioned content format), status `OPEN|IN_PROGRESS|DONE|CANCELED` (additional custom status deferred); priority `NONE|LOW|MEDIUM|HIGH|URGENT`; optional `parentTaskId`; `plannedStartAt`, `dueAt`, optional local date-only scheduling; `completedAt`, `revision`. Completion is an explicit transition. No duplicate tasks for personal views. Future assignments/project association through new tables.

**Task links:** parent/subtask relation acyclic and within one Space; no nesting beyond configured bound (default 5); checklist separate from subtasks (checklist completion does not necessarily complete parent). Phase 1 label names unique case-insensitively per space. History stores changed _field keys_ and safe before/after metadata, not sensitive rich descriptions.

**Goal:** One `Goal` with self-parent if needed, scope, lifeArea, target/schedule/progress mode; target progress isn't always task completion count. For goal-to-task and goal-to-habit relation use FK-bearing link tables. Company goals later use same ID/ownership pattern with additions, not a separate parallel Goal engine.

**Time:** distinguish date-only, local wall-clock schedule and UTC instant. Recurrence definition is different from materialized occurrence. An occurrence has stable series ID + recurrence identity; series edits cannot silently rewrite history. Workday boundaries use user timezone at operation time (per recorded policy). Jalali is date presentation/calculation adapter, not a separate DB timestamp calendar.

**Finance:** `FinancialAccount` is a tracking account, not a real bank integration. Canonical transfer is one transaction operation linked to balanced postings or consistent two-leg model; currency conversion requires explicit rate snapshot, conversion date and fees. Balances derived from ledger/postings or an auditable transactional projection; never editable free-floating balances after opening balance except reconciliation adjustment transaction.

**Journal/mood:** strongly private, not indexed into generic company searches or event logs. Journal day can have at most one _daily check-in_ per space/local date but multiple journal entries; check-in vs freeform entries distinctly modeled.

---

## 4. Phase 1 ordered implementation batches

### P1-01 — Core Tasks, Labels, Checklists and attachments

**APIs:**

- `POST/GET /tasks`, `GET/PATCH/DELETE /tasks/{id}`; `POST /tasks/{id}/complete`, `POST /tasks/{id}/reopen`.
- `POST/GET/PATCH/DELETE /tasks/{id}/checklist-items`, `POST/GET/PATCH/DELETE /labels`, `PUT/DELETE /tasks/{id}/labels/{labelId}`; `GET /tasks/{id}/history`.
- `POST /tasks/{id}/subtasks`, list nested subtasks (using same Task aggregate); attachment bind/unbind routes using preexisting file objects.

**Rules:** Task create defaults OPEN; done requires completion timestamp; reopen clears current completedAt but leaves immutable change history. Mutations use `revision`. Delete = recoverable soft deletion for 30 days by default; descendants policy: soft-delete subtree and restore subtree unless child has since been independently recovered. Hard deletion in account closure. Distinguish due date, scheduled date, planned start. Recurrence fields intentionally excluded until P1-02. All links same space, never cross-user. Bulk endpoint comes P1-02.

**Tests:** validation, unauthorized IDs, cycles, nesting depth, concurrent updates, delete/restore, checklist ordering, scoping of labels/files, incorrect stale revision.

### P1-02 — Recurring tasks, templates, bulk, custom filters

**APIs:** `/task-recurrences`, `/task-templates`, `/saved-task-filters`, `POST /tasks/bulk`, `POST /task-occurrences/{id}/skip`.

**Rules:** Define supported repeat patterns (daily, selected weekdays, weekly, monthly nth or date, yearly, interval) with start/end, timezone and exclusion dates. **At-most-one occurrence per `(seriesId, recurrenceKey)`**. Task occurrence states: PENDING/DONE/SKIPPED/CANCELED. Editing a series permits `THIS_OCCURRENCE`, `THIS_AND_FUTURE`, `ENTIRE_SERIES` semantics; future-only split must retain audit linkage. No automatic duplicate generation; catch-up after downtime is idempotent. Missed occurrences remain trackable, not marked completed by default. Template application copies fields; changes to template do not retroactively mutate existing tasks. Bulk action returns per-item errors + partial success report (no unauthorized data details). Saved filters store normalized validated DSL, no arbitrary SQL.

**Tests:** DST/local midnight, leap day/Feb 29, month-end short months, duplicate execution, series exception editing, 100-item bulk with mixed permissions and stale revisions.

### P1-03 — My Day, planning, reviews and capacity

**APIs:** `/planning/days/{yyyy-mm-dd}`, `/planning/weeks/{weekStartDate}`, `/planning/reviews`, `/planning/rollover/preview`, `/planning/rollover/commit`, `/planning/capacity`.

**Rules:** My Day is a selected list of references to existing tasks, not a duplicate Task store. Unique `(spaceId, localDate, taskId)` selection; moving an item does not alter due date without explicit user action. Rollover defaults to **suggest only**, never silently change due dates; preview includes skipped/blocked/stale items and commit uses idempotency key. Capacity estimate based on explicitly planned blocks and configured available hours; no hidden AI inference. Morning/evening reflections stored in review domain or linked private Journal entry but **never duplicated**.

**Tests:** conflicting planned dates, timezone change between days, sorting, move/remove, same task in multiple plans, idempotent rollover, user setting week start.

### P1-04 — Calendar, Events, Time Blocks

**APIs:** `/calendar/events`, `/calendar/events/{id}`, `/calendar/time-blocks`, `/calendar/views?from=&to=&timezone=`, `/calendar/conflicts`.

**Rules:** Event is distinct from Task; TimeBlock may optionally reference existing Task, but cannot own/duplicate it. Store all-day date range (end exclusive) separate from UTC instants. Event recurrence uses stable series + exception semantics matching tasks. Calendar APIs return normalized occurrences within bounded date range; no infinite expansions. DST ambiguous time uses explicit resolution policy documented in response; nonexistent local times rejected with clear error or shifted only with user intent. Conflict detection is advisory; overlapping personal events allowed unless user chooses strict blocking. Jalali view transformation does not change Gregorian ISO storage.

**Tests:** all-day boundary, DST, timezone travel, event edits/recurrence, overlapping time blocks, long recurrence expansion caps, task link deleted.

### P1-05 — Habits, Routines and Water Tracker

**APIs:** `/habits`, `/habits/{id}`, `/habits/{id}/entries`, `/habits/{id}/stats`, `/routines`, `/habits/water-summary`.

**Rules:** Habit types CHECKBOX, QUANTITY, DURATION with unit and target; schedules daily/weekly/selected-day/interval; entries tied to user-local date plus immutable timestamp and time-zone context. Users may log multiple quantity entries per day; checkbox completion unique per due day (toggle represented by update/history); duration never negative. Rest days/approved skips do not break streak, but are not counted as successful completion. Pausing suspends expected occurrences. Water uses a QUANTITY habit with milliliter-based canonical unit rather than a separate tracker. Historical streak recomputed on edited entry or schedule change; do not retroactively erase history without confirmation.

**Tests:** skip, pause, missed day, cross-midnight log, multi-entry sum, schedule change, daylight saving, thresholds and streak recalculation.

### P1-06 — Goals, Milestones, Life Areas and reviews

**APIs:** `/life-areas`, `/goals`, `/goals/{id}/milestones`, `/goals/{id}/metrics`, `/goals/{id}/links/tasks`, `/goals/{id}/links/habits`, `/goals/{id}/progress`, `/goals/{id}/reviews`.

**Rules:** Goal status PLANNED/ACTIVE/PAUSED/COMPLETED/ABANDONED. Progress strategies MANUAL, METRIC and WEIGHTED (explicit weight sum normalization/validation); clamp visible percentage to 0..100 but retain raw source values in computation. Subgoals allowed with cycle prevention, within one space. Linked task/habit may contribute only if configured; a task linked to multiple goals doesn't duplicate tasks or monetary expenses. Goals don't gain automatic completion merely due to progress=100 unless rule specified. Historical progress snapshots record rule version.

**Tests:** cycle, weight normalization, zero denominator, moved/removed task link, milestone completion, stale updates and private source access.

### P1-07 — Focus/Pomodoro, time logging and productivity

**APIs:** `/focus/sessions`, `/focus/sessions/{id}/start|pause|resume|finish`, `/time-entries`, `/productivity/summary`.

**Rules:** Session lifecycle IDLE/RUNNING/PAUSED/FINISHED/ABANDONED; single active focus session per user by default; server stores start/pause/resume events, calculates elapsed durations from instants (not client timer trust). Session may link to task. Time entry is explicit actual work record; avoid double counting if focus session generates one. Estimates live on tasks; logged time on TimeEntry. Eisenhower quadrant is derived from importance/urgency flags or dedicated task properties added in this batch, explicitly defined once. Breaks don't count as work.

**Tests:** parallel start requests, pause after finish, app closed, clock drift, duplicate session finish, linked task deletion, time-zone and duration precision.

### P1-08 — Notes, Journal/Mood, Quick Capture and privacy

**APIs:** `/notes`, `/notes/folders`, `/journal/entries`, `/journal/daily-checkins`, `/moods`, `/capture`, `/capture/{id}/triage`, `/search/personal`.

**Rules:** Note content format versioned; folders cannot be cyclic; text search respects space; journal and mood not included in general search by default, explicit opt-in needed. Daily mood check-in per local day; freeform journal supports multiple entries. Capture types TASK/NOTE/EXPENSE/HABIT_LOG/JOURNAL/VOICE_MEMO/DRAFT; classify **explicitly user-selected**, with optional deterministic parsing only; no AI. Capture item processed atomically when possible, retains source id and target reference on successful triage, retries are idempotent. Voice memo = private file attachment only; no built-in transcription service (deferred unless a separate approved phase-1 functional request). Personal note/file privacy and content logging rules are strict.

**Tests:** journal non-disclosure in search/analytics without opt-in, triage duplicate, failed conversion rollback, journal date, file ownership, folder cycles, large notes and safe rich text.

### P1-09 — Personal Finance (complete, ledger-consistent)

**APIs:** `/finance/accounts`, `/finance/categories`, `/finance/transactions`, `/finance/transfers`, `/finance/budgets`, `/finance/bills`, `/finance/savings-goals`, `/finance/reports`, `/finance/export`.

**Rules:** Account tracks manual personal value, opening balance as posting. Transactions types INCOME/EXPENSE/TRANSFER/ADJUSTMENT. Use canonical `Transaction` + signed `TransactionPosting` per account; same-currency transfers have net zero across postings (excluding explicit fees). Cross-currency transfers include source amount, destination amount, recorded rate and fee details; never assume automatic live FX without provider. All amounts exact Decimal and ISO currency with positive input amounts and ledger-signed postings. Account balance computed as opening + postings, with optional auditable projection; no direct arbitrary balance patch. Delete/modify ledger entry by explicit reversal/superseding posting policy preserving history. Budget periods anchored to user timezone and calendar choices; spending excludes transfers by default. Recurring finance items require a template/schedule and explicit or opt-in automatic posting with idempotent period key (default: **reminder/preview only**, no unapproved automatic actual expense). Bills can be marked PAID and linked to transaction. Savings progress may link to tracked account or manual contribution, never double-count. Export amounts as decimal strings.

**Tests:** precision, debit/credit posting sum, double-submit transfer, concurrent writes, reversal, FX precision, period boundary, missing rate, overspend (warning, not default blocking), export cross-user IDOR.

### P1-10 — Reminders, notification delivery, push and scheduled jobs

**APIs:** `/reminders`, `/notifications`, `/notifications/preferences`, `/notifications/{id}/read`, `/push/subscriptions`, `/notifications/test` (nonproduction only).

**Rules:** Notification channels IN_APP, EMAIL, WEB_PUSH where configured. `Reminder` stores target, due rule (absolute time or relative to due/planned date), timezone and state; changes to due date deterministically recalculate future pending reminders. Completed/deleted task cancels pending reminders; reopen only reactivates if future due rule and user settings permit. Quiet hours defer nonurgent delivery without losing intended event. Snooze creates new scheduled delivery referencing original; never duplicates target side effects. Retries bounded; unique delivery fingerprint `(reminderId, scheduledAt, channel)`; opt-in web push subscription. Activate pg-boss on PostgreSQL and outbox dispatch now (not in Phase 0); no Redis service. Scheduled worker sweep repairs missed jobs after downtime. Notification payload excludes finance/journal text in push by default.

**Tests:** scheduled delivery, cancel/reopen, dedup, changed due date, quiet hours crossing DST, invalid push endpoint cleanup, worker restart/backfill, user logout/session vs subscription.

### P1-11 — Analytics, explainable insights, optional gamification

**APIs:** `/insights/overview`, `/insights/tasks`, `/insights/habits`, `/insights/goals`, `/insights/time`, `/insights/finance`, `/rewards/achievements`, `/rewards/progress`, `/rewards/preferences`.

**Rules:** Metrics have canonical definitions, denominators, timezone boundaries, source types, and data freshness. No fabricated analytics. Task completion rate for selected period must state whether measured by scheduled/due/completed date and make denominator explicit. Habit consistency excludes non-required rest days, distinguishes skip from achieved. Finance aggregations must not count transfers as expenses; amounts grouped by currency unless explicitly converted using recorded exchange-rate snapshots. Insights are deterministic rules, never use mood/journal data without opt-in. Insight explanations include evidence metric IDs/time range but no sensitive payload. XP is additive ledger with unique source-event ID; duplicate events cannot double reward; no punitive streak or negative mood scoring; achievements optional and may be disabled/recalculated.

**Tests:** zero data, multi-currency, moved task dates, stale snapshot invalidation, rejected opt-in, repeated event, historical recompute, aggregation cross-space leakage.

### P1-12 — Personal data lifecycle, resilience and offline sync

**APIs:** `/me/export`, `/me/exports/{id}`, `/me/deletion-request`, `/sync/push`, `/sync/pull`, `/sync/status` (sync routes only for approved entity subset).

**Scope:** Offline sync is intentionally **not built in Phase 0**. In final Phase 1 batch support personal Task/Checklist/Labels, Daily Plan, Habit Entries, lightweight Notes, Quick Capture, and new personal expense drafts/committed mutations only if transactional idempotency tested. Exclude auth, file binary sync, session operations, bulk permission changes and other high-risk operations. Offline cache/local persistence implementation belongs to client; backend supplies revisioned sync contracts and durable change feed.

**Sync rules:** Every push operation requires stable client mutation ID, actor scope, base revision and operation type, bounded payload. Server validates ownership and applies in transaction; push returns APPLIED, DUPLICATE, CONFLICT or REJECTED **per operation**. Reject stale edits to long-form text with preserved server/client versions for user resolution; no blind last-write-wins. Append-only habit log can deduplicate on client generated entry ID; checkbox changes version-checked. Server returns stable ordered per-space cursor feed for supported changes/deletions with tombstones; cursor expiry triggers full safe resync. Revocation and account closure prevent further pull. Do not cache secrets or unbounded private personal data on the client.

**Data lifecycle:** Export is scoped to user's personal data, signed private download with expiry, includes attachments manifest, versions and export metadata, with bounded processing and audit. Delete request requires reauthentication, staged confirmation, termination/revocation of sessions, immediate account access restriction, documented grace/retention period then FK-safe cascade/anonymization + private-volume cleanup. Legal retention exceptions must be explicit. Job resumability and failures are visible to operator without exposing personal content.

**Tests:** two-client race, replay, cursor loss, deletion tombstone, cross-user sync ID, offline-to-online resubmission, journal/finance authorization, corrupted download/export, interrupted deletion and orphan-file cleanup.

---

## 5. Module integration and consistency contracts

| Producer/owner | Event (version 1)                                                                 | Consuming modules / rule                                                                |
| -------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Tasks          | `task.created`, `task.updated`, `task.completed`, `task.reopened`, `task.deleted` | planning read refresh, goals recompute, rewards idempotent XP, notifications reschedule |
| Tasks          | `task.due_changed`                                                                | reminders recomputed from canonical task state                                          |
| Habits         | `habit.entry_recorded`, `habit.entry_corrected`                                   | goals/insights/rewards, recompute only affected ranges                                  |
| Goals          | `goal.progress_changed`                                                           | insights, notifications if explicitly enabled                                           |
| Calendar       | `time_block.changed`, `calendar_event.changed`                                    | capacity/read models only                                                               |
| Finance        | `finance.transaction_posted`, `finance.transaction_reversed`                      | finance reporting, insights; **no sensitive amounts in broadcast generic event**        |
| Capture        | `capture.triaged`                                                                 | search/read-model invalidation                                                          |
| Account        | `account.timezone_changed`, `account.deletion_requested`                          | reschedule future local-time reminders, cleanup protocols                               |

All event types are versioned. Consumers retrieve privileged detail through authorized owner façade if needed; avoid embedding journal/mood/finance content in events. No generic system-wide event bus exposing all private data. Consumers at-least-once/idempotent. Keep processing result and retry visibility.

### Cross-module examples

- **Create task from capture:** Capture validates request -> Tasks public command creates task -> Capture marks triaged, using orchestrated transaction if both DB writes must be atomic; idempotency prevents duplicate Task.
- **Plan task into My Day:** Planning stores reference to Task after Tasks façade validates same-space ownership. Reassignment of due date is separate explicit Tasks command.
- **Complete task:** Tasks commits status + outbox; API responds immediately; rewards/insights/notifications process asynchronously; failed reward does not undo completion.
- **Journal evening review:** PlanningReview may reference JournalEntry, but same content must not be duplicated. Journal confidentiality applies to all such links.
- **Record money transfer:** Finance owns entire operation and atomic postings; no Event-driven split across accounts.

## 6. Authorization / privacy / attack scenarios

Acceptance test suite must include:

1. User A cannot read, list, filter, count, mutate or download User B's task, attachment, goal, finance row, mood or journal entry (including nested IDs and exports).
2. Session revocation takes effect across endpoints and pending export links have appropriate expiry/authorization control.
3. Input overposting cannot set owner, `spaceId`, `createdByUserId`, financial balance or internal audit states.
4. Upload cannot be finalized for an object larger/different than initiated; unknown object cannot be claimed by guessing key.
5. Notification push cannot leak journal/mood/finance contents to external lock screens by default.
6. Idempotency keys cannot be reused by another user or with different request body; stale revisions rejected safely.
7. SQL/HTML injection, malicious filenames, pagination abuse and resource exhaustion are mitigated/tested.
8. Security and privacy event logging excludes passwords, bearer tokens, private files, note/journal body, and full financial narratives.
9. Account deletion prevents orphaned private files, prevents partial resurrection of data, and does not erase another user's content.
10. For future-proofing, restricted domain actions cannot bypass public façade/ownership checks by directly referencing a foreign `spaceId`.

## 7. Offline, timezone and recurrence edge-case matrix

| Case                                   | Required behavior                                                                                                                                    |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| User changes timezone                  | Past local-date records retain original recorded date context; future reminders reschedule per explicit policy; no silent journal/habit date rewrite |
| Spring-forward nonexistent time        | Reject or resolve with explicit documented policy, never silently shift undetected                                                                   |
| Fall-back duplicated time              | Deterministic first/second occurrence choice with test                                                                                               |
| Monthly recurrence on 31st             | Defined skip-or-last-day policy (default **skip** months lacking day; user-selectable later via ADR)                                                 |
| Leap-day yearly recurrence             | Default skip non-leap years; explicit policy saved per series                                                                                        |
| Recurrence schedule edited             | Historical completed/skipped occurrences remain; only selected future segment changes                                                                |
| Task completed before reminder         | Pending future reminders canceled; delivery re-checks current state                                                                                  |
| Task done twice concurrently           | Single completion transition and single XP reward event                                                                                              |
| Habit edited retrospectively           | Recalculate affected streak range; preserve change history                                                                                           |
| Offline mutation replayed              | Same client operation ID returns duplicate receipt; no repeated side effects                                                                         |
| Network resumes after long absence     | Bounded paginated catch-up; stale cursor requires scoped resync                                                                                      |
| Private space later transferred/shared | Not supported in Phase 1; no uncontrolled direct FK rewrite                                                                                          |

## 8. Acceptance gates at phase boundaries

### Phase 0 exit — GO only if

- API boots with isolated test database; auth email verification/recovery/session revocation works; personal space provisioned reliably.
- Private volume upload/download/delete smoke verified; metadata and ownership protected; secret redaction correct.
- Migrations tested from empty DB and compatible prior schema; CI covers architecture rules, unit/integration/contracts.
- Observability, minimal operational runbook and environment validation exist; **no Personal business features** prematurely delivered.

### Phase 1 exit — GO only if

- Every P1-01 through P1-12 endpoint, state transition, job and event meets stated acceptance tests.
- Full domain isolation test matrix passes, including nested entities, search, files, report exports and synchronization.
- Recurrences, DST, habit streaks, goals weighted progress, ledger precision, reminders after reboot and offline conflict policies pass deterministic tests.
- Real background job smoke, data export/delete smoke, concurrent user smoke and migration upgrade smoke all pass.
- OpenAPI contract and feature-to-tests traceability are complete; zero unapproved future modules; no orphan files/jobs.

## 9. Exact batch handoff template

At the beginning of **each** batch, developer/agent must supply:

```text
Batch: P0-xx / P1-xx
Scope: exact requirements in this document
Will create/edit: modules, files, entities, migrations, API routes, events
Will not create/edit: explicit out-of-scope features
Risks/ADRs: only genuine blockers
```

At completion report:

```text
Batch: ...
Implemented: ...
Changed modules/files: ...
Schema and migrations: ...
API contracts and sample error codes: ...
Events/jobs and idempotency: ...
Test commands + observed results: ...
Security/tenant isolation checks: ...
Manual provisioning/smoke needed: ...
Known limitations strictly within current scope: ...
Ready for review; DO NOT continue to next batch without approval.
```

## 10. Remaining explicit pre-code gates (no unapproved guessing)

The following matters are **implementation configuration**, not permission to expand scope:

1. Validate chosen NestJS/Better Auth adapter and supported versions in a real Phase 0 spike; pin the tested versions.
2. Choose Docker host and environment domains; provide TLS reverse proxy, disk-capacity alerts, restart/healthcheck policy and storage durability. Host costs are an operational decision.
3. Confirm production SMTP credentials, verification sender/domain, delivery monitoring and limits (dev remains local/test sink).
4. Define retention numbers and account-deletion waiting period with business/legal owner; defaults above are product proposals, not legal advice.
5. Lock task recurrence ambiguity behavior and explicit `TaskOccurrence` versus master task mapping; the tests in P1-02 are binding after ADR approval if requirements evolve.
6. Decide exact Phase 1 offline-supported field/entity subset and whether committed ledger transactions may be sent offline. **Default: finance drafts offline, actual posting online** unless separately approved.
7. Establish per-environment backup/restore and disaster recovery acceptance; Docker PostgreSQL and file-volume backups must be encrypted/off-host, retention-defined, and restore-tested.

These gates may be recorded as scoped ADRs without reopening chosen domain boundaries. **No developer should invent alternative infrastructure, paid dependencies, AI features, or team/company entities to bypass them.**

## 11. Scope checklist: what must exist before Phase 1 can be called complete

- [ ] Auth/account/private ownership/data export/deletion
- [ ] Tasks and nested checklists, labels, bulk, templates, history
- [ ] Recurrence/occurrences and schedule exceptions
- [ ] Daily/weekly planning, capacity, reviews, rollover
- [ ] Calendar events, time blocks, recurring schedules and timezone behavior
- [ ] Habits/routines/water and consistent historical streaks
- [ ] Goals, life areas, milestones, measurable progress and links
- [ ] Focus/Pomodoro, breaks and time tracking
- [ ] Notes, journal, mood and privacy controls
- [ ] Personal finance accounts, ledger/transactions, budgets, bills, savings and multi-currency
- [ ] Capture/triage (text and private voice memo attachment)
- [ ] In-app notifications, reminders, email/push adapters, quiet hours
- [ ] Explainable analytics, period comparisons, opt-in private-data use
- [ ] Optional gamification and XP ledger
- [ ] Personal offline sync contract and tested conflicts for approved subset
- [ ] Security, observability, documented migrations and complete acceptance tests

**Completion criterion:** A user can run their entire personal planning workflow through the backend without requiring a Project, Team or Company. All next phases add new modules and relationships around stable personal entities, rather than creating parallel Task/Goal identities.

## Docker-only deployment amendment (ADR-006, approved)

**Service topology:** `api` + `postgres` in Phase 0; add `worker` (same application image with worker entrypoint) when Phase 1 requires durable jobs. A reverse proxy provides HTTPS in deployment configuration. There is no managed database, Redis, R2, or MinIO dependency.

**PostgreSQL:** persistent named volume, internal-only network, credentials from secrets, health check, immutable image tag, controlled migrations and tested encrypted off-host backups. No public DB port.

**File uploads:** `StoredFile` metadata in PostgreSQL; blob bytes in a dedicated private named volume. StoragePort hides provider details. Upload/init/finalize/download/delete endpoints remain authorization-checked; API streams bytes and validates size/type/hash. Do not issue S3 presigned URLs in this phase. Backups and recovery cover database rows and corresponding blobs.

**Queue:** use pg-boss when reminders/notification deliveries/export/cleanup require durable processing. Use PostgreSQL as source of truth; idempotent handlers, retries, missed-job sweeps, worker crash tests and retention required. No BullMQ or Redis.

**Docker release acceptance (DEFERRED from local P0-01):** `docker compose up -d --build` reliably boots API+PostgreSQL; DB state survives container recreate. This gate remains mandatory before Docker-based release. **P0-04 extra acceptance:** file data survives API recreate and unauthorized direct access is impossible. **P1 notifications acceptance:** job and reminder persistence survives worker restart/redeploy, without Redis.

**Deployment completion gate:** HTTPS, secrets, host firewall, restart policies, backup/restore drill, capacity/disk monitoring, and SMTP delivery configuration must be verified. Single-host Docker does not provide high availability by itself.

## Approved local development amendment (2026-10-27)

Local development and P0-01 acceptance use Windows + Node.js 24 LTS via NVM + local PostgreSQL + pnpm. NestJS runs directly on Node.js and Prisma connects to local PostgreSQL. Vitest is mandatory for unit/integration testing; Supertest verifies HTTP integration. Docker Compose remains the future deployment target, not a local prerequisite. Do not install Docker/WSL or run Docker commands for local P0-01. Docker image/startup/persistence checks are DEFERRED and remain mandatory before Docker release. Other applicable local quality gates remain required. Use an explicitly isolated test database and never reset a database or perform destructive operations without approval. Existing production deployment and architecture rules still apply to future deployment.
