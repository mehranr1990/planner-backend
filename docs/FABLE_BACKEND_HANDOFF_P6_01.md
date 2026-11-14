# Fable frontend integration handoff — through P6-01

> **Update 2026-11-13 (backend completion):** The FK-catalog re-pin, transfer-catalog entries and most items listed as blocked here were completed. The contract is now 960 operations. The current status, remaining items and operator setup are in [`backend-pre-frontend-integration-report.md`](backend-pre-frontend-integration-report.md).

Date: 2026-11-11 (Asia/Tehran).
Published backend code: **`7bcc10e2b133bc67976e5684f2aba82760890ea8`** on `origin/main`.
This is the integration baseline for completed Phases 0–5 and **Phase 6, batch 01 only**.
Phase 5 excludes its explicitly deferred P5-04 realtime transport. Phase 6 is not
complete as a whole. The owner authorized publication of P6-01 after local acceptance.

The Projects additions dated 2026-11-12 below are local, uncommitted working-tree
changes beyond that published SHA; they have not been deployed or published.

The owner-approved consolidated API gaps dated 2026-11-13 are also local and
uncommitted. That batch brought the contract to **860 operations** (eleven additions
to the 849-operation local Projects baseline); the newer Social additions below
bring the current local total to **863**. See the exact endpoints, response fields,
authorization, invitation-proof blocker and verification in
[the implementation report](./consolidated-api-gap-implementation.md).
X1/X2/M1/X4/M2/Company export reads are implemented; X3 reuses the existing
privacy-safe `POST /api/v1/social/discovery`. Shared remains disabled; this work
does not resolve OD-1–OD-14 or authorize Frontend activation, live tests or P6-02.

### Local stabilization (Teams, Companies, Meetings) — 2026-11-13

Local, uncommitted; contract now **864 operations**. No migration. Hints never
replace endpoint authorization.

- **M-X4**: `POST /meetings` (PROJECT/TEAM/COMPANY) accepts optional
  `participantActorIds` (source-roster `actorId`s, combined limit 199 with
  `participants`); `POST /meetings/{id}/invitations` accepts `{id, actorId}` as an
  alternative to `{id, userId}`. Actors resolve server-side within the meeting's
  space only after organizer checks; no account IDs are exposed.
- **M-X5**: `meeting.create` capability hint on existing Team, Project and Company
  root `access/me` (source management role + `work.manage`; Company: Owner only).
- **M-A1**: announcement versions add nullable `authorDisplayName`. Ack totals:
  existing manager-only `.../acknowledgements` summary. No scheduling model exists.
- **T-M2**: new Owner-only `GET /teams/{id}/ownership-handovers` (signed `after`).
- **T-M3 / C-M4 candidates**: reuse existing reads. Linked rows embed the visible
  Project; use Project overview/dashboard for dates/progress. Attach candidates:
  caller-owned independent Projects/Teams; create rechecks eligibility.
- **Blocked**: M-X6/M-X7 (new attribution FKs need owner review of the fail-closed
  shared-cleanup FK catalog); T-M1 (Team assignment/status/planning model batch);
  T-M2 settings and T-M4 (undefined Team policies/modules); C-M1 (OD-9 currency);
  C-M2 (policy UI decision); C-M3 (new staff personal-data fields/KPI definitions);
  C-M4 request records and association names/counts (ADR 0039 allow-list undefined).
  OD-1 and OD-4 remain unresolved.

### Local Company Backend completion — 2026-11-13

Local, uncommitted; contract now **910 operations** (887 after the Team batch + 23
Company). Migration `202611130049_company_completion`. Details, coverage and open
questions: [the report](./company-backend-completion-report.md). This supersedes the
C-M1, C-M3 and C-M4 entries under "Blocked" above.

- **C-M1**: `GET /companies/{id}/settings` and `PUT .../settings/currency`
  (If-Match Company revision; Owner/Org Admin). One fixed currency; locked by the
  first budget or expense version. Finance writes return `COMPANY_CURRENCY_REQUIRED`,
  `COMPANY_CURRENCY_MISMATCH`, `COMPANY_CURRENCY_LOCKED` or `COMPANY_CURRENCY_CONFLICT`.
- **C-M3**: `GET ctx/directory` (public fields only) and
  `PUT ctx/staff-profiles/{profileId}/work-details` (self or manager);
  `GET ctx/reports/kpis` (manager-only, explicit sources, goals `null`).
- **C-M4**: resource types, `PUT ctx/resources/{id}/type` (resource rows add nullable
  `typeId`), versioned role-based `resource-workflows`, resource requests with
  decision/withdraw/history; `association-summaries` and `association-candidates`.
- **Still blocked**: C-M2 named policy values, expense rejection reasons, budget-change
  requests, OD-1–OD-9 items listed in the report. Company/Project disposal fails closed
  (`CLEANUP_RETRY_REQUIRED`) until the shared-cleanup FK digest is re-pinned (831 FKs).

Recommended handoff boundary: **P6-01**, so frontend and published backend use the
same current contract. Existing Phase 5 consumers retain their API compatibility.
This document describes backend integration; it does not prescribe a replacement UI.

### Local Social identity/access completion — 2026-11-13

The local canonical contract now has **863 operations**. New authenticated reads:
`GET /api/v1/social-groups/{id}/access/me`, `GET /api/v1/meetings/{id}/access/me`
(current meeting `memberId`, closing X1-M), and
`GET /api/v1/social-groups/{id}/history` (allowlisted metadata since current admission).
Existing Social connection, join-request and membership lists now supply authorized
nullable display names without adding profile/contact or directory access.
See [the current batch report](./social-integration-completion-report.md) for exact
fields, permission checks, tests and the operator retention-version requirement.
The owner approved the policies recorded in [ADR 0051](./adr/0051-social-completion-decisions.md),
then requested completion of this batch and a stop. Activities and other P6-02+
features were not started; no Shared activation, migration application to development,
Frontend change, commit, push or deployment was authorized or performed.

### Local development readiness repair — 2026-11-11

Owner-approved repair targeted only `localhost:5432/mehran_dev`, schema `public`,
which the owner confirmed contains disposable test data. The ignored local `.env`
now sets `ERASURE_CONTROL_ROOT` to the absolute existing directory
`D:/New folder/planner-backend/.tools/private-files-erasure-control`; its signed
evidence was preserved. The relative path previously resolved under `apps/api`.

`pnpm.cmd db:migrate:deploy` exited 0 and applied all 45 pending migrations, from
`202611040001_shared_space_kind` through `202611110045_social_foundation`.
This includes `202611050020_local_security_closeout`, which adds the missing
`AccountDeletionJob.evidenceKeyId` column responsible for Prisma P2022.
Read-only verification found all 69 migrations applied, zero pending/unfinished
migrations and zero checksum mismatches; the formerly failing lifecycle query passed.

Only the local backend dev process was restarted. Replacement API PID `58224`
(Nest watcher PID `14892`) returned HTTP 200 for both `/health/live` and
`/health/ready` on `http://127.0.0.1:3000`, with the same PID throughout verification.
Readiness returned `{"status":"ok","checks":{"database":"up"}}`; startup stderr
was empty. No remaining readiness errors were observed. `mehran_test` and other
databases were not accessed; no resets, schema push, ACL/marker changes or Shared
feature activation occurred. No code, historical migrations or secrets changed.
No full quality gate, commit, push or deployment was performed.

### Projects contract additions — 2026-11-12

Four additive operations preserve all existing request/response shapes. All use the
existing verified session, Project guard, Shared activation prerequisites and
current custody/scope authorization. Shared remains disabled locally; do not
enable it or supply synthetic acceptance settings for frontend integration.

| Method/path under `/api/v1`     | Fields and frontend use                                                                                                                                                | Required current permission                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `GET /projects/{id}/metadata`   | `id`, `title`, nullable `key`, `color`, `summary`, lifecycle `status`, `revision`; returns `ETag`                                                                      | Project `task.read`, including an exact named Project read grant             |
| `PATCH /projects/{id}/metadata` | Any nonempty subset of `key`, `color`, `summary`; returns updated metadata and `ETag`; trusted `Origin` and quoted `If-Match` required                                 | Existing `settings.manage` plus full-scope `task.read` (default Owner/Admin) |
| `GET /projects/{id}/members`    | Existing membership identifiers/role/state/generation/revision plus `displayName`; `items` and `nextCursor`; `limit` defaults 25, maximum 100, optional opaque `after` | Full-scope `task.read`; named-resource/grant-only access is insufficient     |
| `GET /projects/{id}/dashboard`  | `report`, `progress`, `health`; required UTC `fromAt` and `toAt`, increasing and at most 93 elapsed days apart                                                         | Full-scope `task.read`; named-resource/grant-only access is insufficient     |

Metadata: `key` is an optional, non-unique display label containing 1–32 ASCII
letters/digits/hyphens; it is not a task-number prefix. `color` is `#RRGGBB`.
Send JSON null to clear either. `summary` aliases the existing nullable description
(maximum 10,000 characters), with no duplicated stored text. `status` aliases the
existing lifecycle state and is read-only; use the existing archive/restore flows,
not a new workflow status. Continue creating Projects and editing titles with the
existing APIs, then PATCH metadata using the current Project revision/ETag.
Metadata and legacy edits share that revision; stale updates return 409.

Members: render `displayName` as plain text and use `actorId`/membership `id` as
context identifiers. No User UUID, email, avatar URL, contact details, credentials
or private profile/settings are returned. Only current active full members with
effective read permission and active accounts appear; suspended, departed,
revoked, erased, grant-only and closed-account entries are excluded. Follow the
signed cursor unchanged; authority/context changes invalidate it. No global user
directory or email/profile lookup is authorized by this endpoint.

Dashboard: `report` reuses the existing authorized current report, including Task
status counts, estimates/unknown estimates, completion-in-window, overdue Tasks,
explicit shared effort and open Risk/Issue counts. It excludes Personal Focus and
other private data. The window bounds completion/effort metrics; Task status and
health counts describe current authorized data as of `report.asOf`.
`progress.completedTasks` is DONE; `eligibleTasks` excludes CANCELED; `percent` is
DONE/eligible × 100 rounded to two decimals, or null when there is no denominator.
`health` exposes actual `overdueTaskCount`, `openRiskCount` and `openIssueCount`.
No synthetic health score, traffic-light threshold, forecast, budget or velocity
is supplied. Use these measured counts and the documented basis fields directly.

Migration `202611120046_project_display_metadata` adds only nullable Project
`key`/`color` columns and format CHECKs, with no backfill or historical SQL edits.
SHA-256: `16b337db2e1445a19763556a73dc64bca32b3a0e933121ff8ff33f0cd17ee823`.
It passed additive-SQL safety review and isolated PostgreSQL integration tests.
The owner subsequently authorized applying this migration to `mehran_dev`; all
70 migrations and live/ready HTTP 200 were verified then. The newer planning
metadata migration below remains unapplied to development. No deployment occurred.

Targeted validation: seven unit/contract cases and four PostgreSQL cases (the three
`frontend contract` cases in `project-core.spec.ts` and the populated migration
preservation case), `pnpm.cmd typecheck`, changed-TypeScript lint/format,
and `pnpm.cmd openapi:generate` / `pnpm.cmd openapi:check`. Direct comparison with
the published P6-01 snapshot also preserved all 11,023 existing operation signatures.
The dashboard fixture's
initial revision mismatch was corrected and that affected case rerun successfully.
No full quality gate, commit, push, deployment or live Shared activation occurred.

### Projects coverage matrix compatibility — 2026-11-12

Source: read-only inspection of `planner/docs/integration/API_COVERAGE_MATRIX.md`,
R1–R12, against the actual 845-operation backend. This local revision has **849
operations**: four new operations, metadata extensions and safe dependency error
details. Frontend files, live Shared settings and historical migrations were not
changed. Paths in this table are under `/api/v1/projects/{id}` unless stated.

| Requirement              | Implemented / actual existing mapping                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Remaining decision or smallest safe frontend alternative                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1 — caller access       | **Added `GET /access/me`**: `accessId`, local `actorId`, `role`, active admission `state`, `generation`, `scope`, `projectState`, `capabilities[]`. Existing `/api/v1/me/work/assignments` and `/api/v1/me/work/tasks?projectId=...` are the caller's own work.                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `scope=FULL` denotes full-scope access; `PROJECT` denotes only an exact Project grant, possibly with `role=null`. Never interpret its `task.read` as permission to list Tasks/members/reports. Suspended/closed/revoked access is denied rather than disclosed. Capabilities are current hints, not authorization tokens; targets, consent, revisions and lifecycle remain checked on commands. Resolve lazily and respect existing rate limits.                                                                                                                                                                                                                                         |
| R2 — members             | Resolved: `GET /members`, names only; membership `id` is the assignment `accessId`, with generation checked.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | No email, User UUID, avatar/profile directory or inferred capacity.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| R3 — Project summary     | **Extended GET/PATCH `/metadata` with nullable `startDate`, `endDate`, `statusNote`**. `tint` maps to `color`; `progressPercent` maps to `/dashboard.progress.percent`. Count all roster pages for a **visible active full-member count**, not total admissions/seats. Own open/overdue counts can be derived from all pages of the caller's `/api/v1/me/work/tasks`, using Task status and returned schedule.                                                                                                                                                                                                                                                                                                      | Metadata dates are explicit YYYY-MM-DD declarations, not inferred Task bounds; patching them never moves Tasks. `statusNote` is nullable text (2,000 characters). Require `startDate <= endDate` when both exist. The Project lifecycle remains separate from traffic-light health. `health` thresholds/manual-vs-computed ownership and `expectedPercent` baseline/calendar/weighting require owner decisions. Render unavailable until defined; never manufacture on-track or linear expected progress. Join existing Project, metadata and dashboard DTOs instead of changing the frozen legacy Project shape.                                                                        |
| R4 — invitations         | Existing POST/GET/revoke `/api/v1/spaces/{spaceId}/invitations...`, `/api/v1/invitations/preview`, and `/api/v1/invitations/{invitationId}/accept` or `/decline`; resource offers use the existing resource-invitation family.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | **ADR 0027 conflict:** acceptance requires the verified exact recipient **and** `X-Invitation-Proof` plus revision. Proof is returned only on initial issuance. No proofless acceptance, recovered proof, recipient-profile email disclosure, inbox or resend workflow was added. Deliver the initial proof through an approved private link/fragment flow; a lost proof requires explicit revoke/reissue. Inbox discovery, safe display fields and resend/delivery semantics need a reviewed decision.                                                                                                                                                                                  |
| R5 — item-addressed seam | Resolved frontend change: retain `projectId` on item-addressed operations.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Keep context IDs and source IDs distinct; do not route shared sources through Personal `/tasks` APIs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| R6 — workflow            | `GET /views?kind=LIST` includes each Task's `workflow.binding` (workflow/version/state); resolve its immutable definition with `GET /workflows/{workflowId}/versions?version=...`. Count by bound version/state across all visible pages; unbound Tasks use base status. Publish/bind/transition and named approval routes already exist.                                                                                                                                                                                                                                                                                                                                                                           | **P2-05/ADR 0032:** multiple pinned versions are intentional; publishing never migrates old Tasks. No single inferred Project workflow, REVIEW/BLOCKED base category, WIP enforcement or new per-role edge ACL is approved. Review/blocked may be labels on existing categories only. Keep unpublished drafts client-side; a proposed version does not remove states from old bindings. Mandatory limits, automatic migration and role-based transition changes need owner decisions.                                                                                                                                                                                                    |
| R7 — fields              | `/custom-fields`, `/{fieldId}/versions`, existing Task value operations and LIST `fields.items`. `appliesTo` is Task-only by contract. Checkbox maps to `BOOLEAN`; URL text can use `TEXT` with client URL validation, without claiming server URL enforcement. Count non-null visible values by `fieldId` across all LIST pages; retain version distinctions.                                                                                                                                                                                                                                                                                                                                                      | Required-field enforcement and its effects on old Tasks, pinned versions/defaults/deprecation are unapproved product semantics. Do not pretend values are complete while only one page is loaded. No new field kind or arbitrary target type was added.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| R8 — scheduling          | **Added safe diagnostics**: HTTP 400, `error.code=VALIDATION_ERROR`, `error.details[]` contains `{path:"dependencies",code:"DEPENDENCY_CYCLE"}` or `DEPENDENCY_DUPLICATE` (same predecessor/successor/kind). Existing `PUT /tasks/{taskId}/schedule` changes only that Task and rejects dependency violations; milestone `targetDate` uses existing component PATCH. Timed CALENDAR/LIST views plus current accepted assignments provide overlap candidates.                                                                                                                                                                                                                                                        | A non-cascading schedule PUT is not a cascade preview. Keep current dependency kind immutable. Automatic milestone-to-Task rescheduling and critical-path duration/calendar/lag definitions need decisions; topological order is not a critical path. Overlap candidates are not attendance or inferred availability.                                                                                                                                                                                                                                                                                                                                                                    |
| R9 — reports/activity    | **Added `GET /reports/snapshots`**, signed pagination over existing immutable snapshots, with current source checks. Existing POST creates explicit captured points; GET by ID and `/reports/current` remain. Sort captured points by their timestamps and compare the same documented basis/window. Task `GET /tasks/{taskId}/metadata-history` exposes authorized `beforeValue`/`afterValue`; register-item history exposes typed before/after records.                                                                                                                                                                                                                                                           | No arbitrary past status is reconstructed from current Tasks. Per-assignee completion attribution (primary vs contributor, current vs historical assignment) and milestone burn baselines need decisions. General activity remains metadata-only; fetch a currently authorized title/history on demand, never add private historical bodies to the Project-wide feed. Missing historical points stay missing.                                                                                                                                                                                                                                                                            |
| R10 — imports            | **Added `POST /change-plans/csv/inspection`**, `{csv}` → `columns`, up to five `sampleRows`, `rowCount`, `samplesTruncated`, syntax/bound errors. Reuses the 256-KiB/100-row/16-column parser; sample cells are capped at 2,000 characters. Requires full read + `work.manage`, trusted Origin; no plan/source writes or idempotency key. Existing POST `/change-plans/csv` performs row validation/dry-run and returns errors plus an immutable plan; apply uses its revision/hash.                                                                                                                                                                                                                                | Map uploaded columns/values explicitly to the existing approved CSV headers before preview; render samples as plain text. No owners, grants, file references or arbitrary updates are imported. The plan's 30-minute preview expiry is **not** an undo window. Cancelling before apply is safe; post-apply undo requires conflict, later-edit, retention and compensation rules, so none was invented.                                                                                                                                                                                                                                                                                   |
| R11 — access/ownership   | Existing GET/PUT `/access-policy` exposes versioned ordinary role defaults/export limits. **Added `GET /ownership-handovers`** with signed pagination for the current Owner, including persisted pending/accepted/expired/revoked/declined states. Existing POST/GET/accept/decline/revoke `/api/v1/spaces/{spaceId}/ownership-handovers...` performs the actual ceremony.                                                                                                                                                                                                                                                                                                                                          | Fixed administrative ceilings are not editable screen toggles. A former Owner/named successor may use the existing known-ID read when permitted; the new collection remains current-Owner-only. Expiry remains enforced by database time and existing maintenance. Ownership-seat succession is not a Team/Company custody move or source transfer.                                                                                                                                                                                                                                                                                                                                      |
| R12 — detailed facets    | Build rows from LIST Task/schedule/workflow/fields, `/tasks/{taskId}/assignments` joined to membership ID+generation/name, and `/tasks/{taskId}/association` for section/milestone. Calendar uses `/views?kind=CALENDAR&from=...&to=...&timezone=...` (exclusive end, max 93 days). Milestones already have `completed`/`targetDate`; structural responsibilities use `/member-assignments` with existing `work.manage` restriction; remaining counts can use visible Task associations. Risks use `/register-items`; work breakdown uses `/work-allocations` + Task views; explicit capacity uses `/capacity-days`, and totals use `/workload`. Existing files and typed resource-grant offer/revoke flows remain. | No redundant all-in-one Task endpoint was added; adapt the seam to these authorized facets. Shared subtask visibility, dated phase plans, a single primary milestone owner, risk code/three-level probability/checklist/close-reason/new comment targets, binary folders/versions/uploader projections and guest-directory disclosure require explicit domain/permission/retention contracts. Current risk probability is 0–100; Guest is not a new role (grant-only admission has null memberRole). **P2-06 requires null for unknown capacity**: collect explicit daily records, never substitute 40 hours or a non-null default. Text-document versions are not binary-file versions. |

Current activity `action` is an open operation-code vocabulary, not a status enum.
Verified examples: `project.metadata.update`, `workflow.publish`, `workflow.bind`,
`workflow.transition`, `workflow.approval.approve/reject`, `field.publish`,
`field.deprecate`, `field.value`, `dependency.create/update/retire`,
`reschedule.apply`, `document.publish/retire`, and `comment.create/edit/delete`.
Expand slash notation to individual codes; render unknown codes with a neutral
fallback. Previews do not imply an activity event. Target/action IDs grant no
additional read permission, and actor IDs are never global account IDs.

Planning migration: `202611120047_project_planning_metadata` adds nullable Project
dates/note and a date-order CHECK only; no backfill, source movement or historical
SQL changes. SHA-256:
`8060fe8487bb8bb5d70c75d1e021de791846c68b4247c5eb7aff635b84673558`.
Prepared and tested against guarded isolated PostgreSQL only; **not applied to
`mehran_dev`**. Apply through the normal reviewed migration step after owner approval
before using this updated Prisma client with a persistent database.

Validation: typecheck; 45 targeted unit/contract cases; ten targeted PostgreSQL
cases including populated migration preservation and the three prior frontend
regressions (nine passed initially; the optional-capability denial handling was
corrected and R1 rerun successfully); changed-file lint/format; canonical OpenAPI
generation/check. No Live Tests, full quality gate, reset, Shared activation,
frontend edits, commits, pushes or deployment were performed.

## 1. Instructions to Fable

Connect the existing frontend to this Mehran Planner backend. First inspect the
frontend's current framework, router, API layer and state management, and preserve
them. Read this guide and the accompanying canonical OpenAPI JSON before editing.
Replace mocks feature by feature with real authenticated requests. Keep missing or
gated features visibly unavailable; report the precise missing configuration or
operation rather than inventing an endpoint or successful response.

Use the backend's existing identity, memberships, permission checks, jobs and private
file protocol. Do not add another auth provider, browser database, payment service,
WebSocket server or parallel business rules. Do not change backend APIs, migrate or
reset databases, deploy, activate Shared features or start P6-02+ as part of frontend
integration. Report any backend contract gap with method/path and requestId.

## 2. Authoritative files and version pin

| File                                                                                                                           | Purpose                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| [`api/openapi.json`](api/openapi.json)                                                                                         | Complete implemented contract: OpenAPI 3.1.0, **849 operations**, **7,729 resolved references** |
| [`p6-01-contract.md`](p6-01-contract.md)                                                                                       | Social scope, ownership, transitions and constraints                                            |
| [`adr/0050-social-discovery-connections-and-group-admission.md`](adr/0050-social-discovery-connections-and-group-admission.md) | Approved discovery, blocking and Group admission policy                                         |
| [`p5-06-contract.md`](p5-06-contract.md)                                                                                       | REST recovery, multi-device consistency, blocks and lifecycle                                   |
| [`p5-03-contract.md`](p5-03-contract.md)                                                                                       | Private media, read/delivery consent and notification semantics                                 |
| [`p5-05-contract.md`](p5-05-contract.md)                                                                                       | Meetings, reviewed minutes, Task release and announcements                                      |
| [`p6-01-report.md`](p6-01-report.md) and [`p6-01-test-evidence.json`](p6-01-test-evidence.json)                                | Local acceptance and its operational limits                                                     |
| [`runbooks/`](runbooks/)                                                                                                       | Domain-specific implementation details when a screen needs them                                 |

The downloadable bundle provides this guide as `README.md` and preserves the
`api/openapi.json` relative path, with key policy references and runbooks. Deeper
source-code links require the repository at the pinned backend SHA.
The canonical OpenAPI has **no `servers` entry**. All business paths already contain
`/api/v1`; do not add this prefix twice. Health paths are outside that prefix.
Schemas, enum values, required headers, pagination and successful status/media types
must come from each actual operation. Schema `$ref` targets are document-local,
including nested `$defs`; the chosen reader/generator must resolve all of them.

Earlier batch reports/manifests are pre-publication evidence snapshots. Their
pending/unstaged flags describe capture time; the published backend SHA above and
the bundle's release metadata identify this handoff's current version.

The untracked legacy `docs/frontend-handoff/` materials describe Phase 1 and an old
293-operation snapshot. They were preserved and were not published with P6-01.
Do not use their bundled JSON or operation counts as this release's contract.
Do not use a future roadmap as an implemented endpoint inventory.

There is no configured Swagger UI or HTTP OpenAPI JSON service. Compiled probes of
`GET /api/v1/docs` and `GET /api/v1/openapi.json` return 404. Supply the checked-in
JSON to Fable/type tooling directly; do not add or guess a documentation URL.

## 3. Connection prerequisites — obtain these from the backend operator

| Value                                                                        | Frontend use / ownership                                                                 |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| API origin, such as `http://localhost:3000` for approved local development   | Public frontend configuration; origin only, without `/api/v1`                            |
| Exact frontend origin                                                        | Operator must approve it in backend `CORS_ORIGINS` and trusted callback configuration    |
| A verified test account and password-reset/verification delivery arrangement | Use the actual auth flow; verification mail in a local sink is operator-only             |
| Integration-environment readiness and worker status                          | Operator provides health/status; frontend never starts workers or edits the database     |
| Applicable approved retention policy version for Shared creation             | Operator supplies the exact existing version; never copy a synthetic test value          |
| Shared feature readiness                                                     | Backend-only acceptance/control configuration; unavailable Shared APIs must remain gated |

No hosted backend URL or Fable preview origin was supplied for this handoff.
`localhost` inside a remote preview/runtime refers to that runtime, not the owner's
Windows backend. A reachable integration environment must be supplied separately.
This publication is not deployment or Shared activation authorization.

Publication also does not apply migrations to an existing environment. Protected
databases were preserved. The operator must provide an approved integration database
matching this release's 69 reviewed migrations, including
`202611110045_social_foundation` (M045), before relying on its new Social tables.
Fable must not run migrations or reset a database to resolve a schema error.

Use a consistent hostname: `localhost` and `127.0.0.1` have different cookie/site
origins. The current cookies use SameSite=Lax, HttpOnly and host-only scope;
production adds Secure. Credentialed CORS alone does not make unrelated cross-site
cookie deployment work. Prefer an operator-approved same-site topology or an
already-established trusted proxy; do not change cookie/security policy as a UI fix.

Backend secrets (`DATABASE_URL`, auth secrets, SMTP credentials, private storage,
signing/control keys) never belong in Fable's browser configuration. Do not invent
`SHARED_SECURITY_ACCEPTANCE_REFERENCE` or signing values to bypass a denied request.

## 4. Browser transport, revisions and errors

- Use `credentials: 'include'` for sign-in, session lookup and all private requests.
  The browser owns HttpOnly cookies and Set-Cookie. Do not create bearer/JWT auth
  or persist session tokens from an auth response in localStorage.
- The browser supplies `Origin`. Every mutation, including bodyless DELETE,
  requires a trusted Origin. Do not manually set the browser's forbidden Origin
  header. There is no separate custom CSRF-token endpoint/header protocol.
- JSON requests use `Content-Type: application/json`. Binary upload completion
  uses the operation's raw media type. Do not send multipart/FormData unless the
  exact operation declares it; current file completion streams raw bytes.
- Allowed custom request headers: `X-Request-Id`, `X-Correlation-Id`, `If-Match`,
  `Idempotency-Key`, `X-Export-Proof`, `X-Deletion-Proof`, `X-Deletion-Recovery`,
  `X-Invitation-Proof`. Exposed response headers: `ETag`, `X-Request-Id`,
  `X-Correlation-Id`, `Content-Disposition`.
- Preserve quoted ETag exactly in `If-Match`, for example `"2"`. When an operation
  returns a JSON revision instead, use the contract's corresponding aggregate
  revision. Nested edits may version the parent rather than the child.
- A logical idempotent command keeps one key and the exact same body across a
  lost-response retry. A new user action gets a new key. Retain required client UUIDs
  for that command. Never replay a stale command after account/scope revocation.
- Treat every documented 2xx status as success as appropriate. Some query-like
  Social POST operations return 201. Handle 204 without JSON parsing; handle
  downloads as bytes. There is no universal `{data: ...}` response envelope.
- Pagination varies: Personal/messaging APIs may use `cursor`; Project/Team/Social
  APIs commonly use `after`. Use each operation's exact query/result. Cursors are
  opaque and bound to actor/scope/authority; never decode, forge or share them.

Error shape for the application exception filter:

```json
{
  "error": {
    "code": "CONFLICT",
    "message": "Resource conflict",
    "requestId": "request-uuid"
  }
}
```

| HTTP      | Frontend behavior                                                                                                           |
| --------- | --------------------------------------------------------------------------------------------------------------------------- |
| 400 / 422 | Correct the body; show documented field details when present                                                                |
| 401       | Stop private requests, clear private view state and restore/sign in again                                                   |
| 403       | Current identity/permission/account/feature gate denies access; do not assume a particular hidden reason or retry endlessly |
| 404       | Safe absence/unavailable resource or proof; never infer the existence of another person's data                              |
| 409       | Refetch the correct aggregate/state and reconcile; do not blindly overwrite with a new revision                             |
| 413 / 415 | Correct payload size or actual supported media type                                                                         |
| 429       | Stop the loop, wait and back off; no overlapping retry storm                                                                |
| 500 / 503 | Show temporary failure and bounded retry/support with requestId                                                             |

Internal labels such as `SHARED_ACTIVATION_GATED` or restore diagnostics are not
guaranteed top-level error codes: the filter emits stable generic status codes.
Sync/bulk per-item outcomes have separate typed schemas. `Retry-After` is sent for
application 429 responses, but it is not currently a CORS-exposed header. When it
cannot be read cross-origin, use the current 60-second application fallback.
Auth has its own tighter rules (sign-in: 3 attempts/10 seconds per actual IP).

Illustrative browser JSON helper; adapt it to the existing frontend client:

```ts
const API_ORIGIN = /* public, operator-supplied API origin */ '';

async function apiJson<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(new URL(path, API_ORIGIN), {
    ...init,
    credentials: 'include',
    cache: 'no-store',
  });
  if (!response.ok) {
    const body = await response.json().catch(() => undefined);
    throw Object.assign(new Error(body?.error?.message ?? 'Request failed'), {
      status: response.status,
      requestId: body?.error?.requestId,
      details: body?.error?.details,
    });
  }
  return {
    data: response.status === 204 ? undefined : ((await response.json()) as T),
    etag: response.headers.get('ETag'),
  };
}
```

Use this helper only for JSON operations. An SSR/server-side fetch does not gain
the browser's cookie jar from `credentials` alone: use the existing trusted
Cookie/Set-Cookie forwarding arrangement, if one is already configured.

## 5. Authentication and account bootstrap

1. Check `GET /health/live` and `GET /health/ready` against the API origin.
2. `GET /api/v1/auth/get-session` restores the actual session (or returns null).
3. Sign-up uses `POST /api/v1/auth/sign-up/email` with `name`, `email`, `password`
   and optional approved `callbackURL`. It does not automatically sign the user in.
4. Complete real email verification through the provider's verification link.
   Frontend never marks an account verified or reads an operator mail directory.
5. Sign in through `POST /api/v1/auth/sign-in/email` with email/password and cookies.
6. Fetch `/api/v1/me`, `/api/v1/me/settings`, `/api/v1/me/spaces` for the current
   account, preferences and authorized Personal Space. Scope changes must clear or
   partition cached data; creation attribution is not ownership authority.
7. Implement sign-out, current sessions/revocation, password reset/change and the
   provider's two-step email-change flow using the exact auth schemas. Sensitive
   operations may require fresh authentication. Callback redirects alone do not
   prove verification or login success.

Never log credentials, recovery/invitation proofs or full private bodies. Logout,
account closure, permission removal and identity switching must cancel polling,
in-flight private views and cached results from the prior account/scope.

## 6. Implemented feature boundary by phase

| Boundary | Implemented integration scope                                                                                                                                                                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0  | Account/auth, Personal ownership, revisions/idempotency/audit, private files, health/config foundations                                                                                                                                                                                                             |
| Phase 1  | Tasks/checklists/labels/recurrences/templates; day/week planning; calendar/time blocks; habits/routines/water; Goals/milestones; Focus/time entries; Notes/Journal/Mood/Capture/search; exact-decimal personal Finance; notifications/reminders; insights/rewards; bounded Personal sync, export and staged erasure |
| Phase 2  | Independent Projects and shared custody; verified invitations/narrow grants; unified Task/Goal assignments and accepted-work projections; workflow/custom fields/dependencies; risks/templates/import/reporting; authorized documents/comments/files and lifecycle                                                  |
| Phase 3  | Independent Teams, explicit Project references, shared work/planning/capacity, confidentiality-reviewed recognition/corrective records and Team lifecycle                                                                                                                                                           |
| Phase 4  | Companies, scoped hierarchy/admission, confidential staff records, allocations, expense/budget/approval/reimbursement records, private knowledge/reporting, lifecycle and approved independent association                                                                                                          |
| Phase 5  | DMs/private conversations/work channels, ordered persisted messaging with REST polling/recovery, advanced message actions, private files/images/recorded voice, consent-based receipts and Push preferences, meetings/minutes/actions and announcements; privacy/lifecycle/security closeout                        |
| P6-01    | Exact opt-in user discovery, mutual friends, pair blocking/privacy, private Circle labels, private/discoverable Social Groups, invitation/approval, roles/member management and inherited succession/departure                                                                                                      |

Actual operations in OpenAPI are authoritative even when a topic label is broad.
In particular, executable Company-child custody transfer is deferred by ADR 0043.
Company association is not a transfer and grants no automatic source access.
Personal Journal/Mood/Finance/Focus never become visible through a work/social role.

**Not available:** P5-04 WebSocket/Socket.IO/Presence/Typing; Social Activities/trips/
RSVP/polls, Social Group Chat integration, social expense splitting/settlement,
lending/Lost & Found, social albums/challenges and P6-02–P6-06; Phase 7 Admin/billing;
native live calls, real payments, new social feeds or speculative integrations.
**c09 is excluded permanently from the approved Phase 6 scope:** transferring,
reassigning or assuming somebody else's debt, receivable or financial obligation.

## 7. P6-01 workflows and identity types

| ID                     | Meaning / correct use                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------- |
| User ID                | Stable verified identity, e.g. discovery result `id` and invitation `recipient.userId` |
| Space / scope ID       | Ownership and authorization boundary; not a UI tab, Circle or universal workspace      |
| Shared actor ID        | Boundary-local attribution; do not substitute it for a User ID                         |
| Context access ID      | Current membership seat; used by membership management and `successorAccessId`         |
| Social connection ID   | A particular request/friendship record; Circle labels use this ID, not the User ID     |
| Conversation member ID | Conversation admission identity; separate from work membership and User ID             |
| Block ID               | Opaque owner-private block record used for unblock; not a counterparty User ID         |

### Discovery and friendship

Discovery is off by default. Read `GET /api/v1/social/privacy`, then let the user
explicitly choose `PATCH /api/v1/social/privacy` with revision/idempotency headers.
`allowFriendRequests` is separate from discovery. Do not publish friends, Circles,
contact details or a mutual-friend graph.

`POST /api/v1/social/discovery` accepts only `{ "email": "person@example.test" }`.
It matches an exact normalized verified email and returns `{items:[{id,name}]}` or
`{items:[]}`. Empty covers unknown, opted-out, unverified, closed, self and blocked
targets; show a generic result rather than an account-existence diagnostic.
There is no name/prefix/phone search or current phone-verification workflow.

Create a request with `POST /api/v1/social/connections`:

```json
{ "id": "client-command-uuid", "recipientUserId": "discovered-user-uuid" }
```

Only the recipient accepts or declines. The requester may cancel; either friend
may remove an accepted friendship. Use
`POST /api/v1/social/connections/{id}/{action}` with action
`accept | decline | cancel | remove`, current If-Match and Idempotency-Key.
Requests start PENDING; acceptance is explicit. An opposing request is a conflict,
not automatic consent. List state from `GET /api/v1/social/connections`.

### Blocking and Circles

Use `POST /api/v1/social/blocks` with `{targetUserId}`, current block revision
(initial own absent state uses revision 1), and an idempotency key. Keep the returned
block ID/revision for `POST /api/v1/social/blocks/{id}/unblock`.
`GET /api/v1/social/blocks` exposes only owner-private records; its rows deliberately
omit target identity/display name, and conversationId can be null. Do not fabricate
a person label from a block ID or infer who blocked the current user.

Blocking cancels pending requests, ends accepted friendship and removes both users'
Circle labels. Unblock restores none of these and revives no stale invitation.
Common Group membership/content and authorized old DM history remain separately
governed; blocked direct contact is not a generic Group membership revocation.

Circles are private labels over current accepted friends, never shared tenants.
Use `/api/v1/social/circles` for create/list and `/{id}` for read/edit/delete.
Label/unlabel with `PUT`/`DELETE /{id}/members/{connectionId}` and the Circle's current
revision. Refetch Circle metadata and members after changes/block/removal; label
commands return identifiers rather than a complete refreshed Circle revision.
`/social/restore-replay` and `/messaging/blocks/replay` are explicit restrictive
restore procedures, not generic retries for every 403. Follow operator guidance.

### Social Groups, invitation and approved joining

Create a Group using `/api/v1/social-groups`, a stable client UUID, name and the
operator-supplied `retentionPolicyVersion`. Private is the default. `description`
is private; `publicSummary` is the separately approved preview text. A name-only
PATCH preserves the other fields. Listing discovery never grants private access.

- `GET /api/v1/social-groups` lists the actor's authorized Groups.
- `GET /api/v1/social-groups/discover` requires a verified session and exposes only
  `{id,name,publicSummary}` for opted-in Groups. No owner identity, member count,
  private description, chat or file access is inferred.
- An applicant sends `POST /social-groups/{id}/join-requests` with `{id}` and a
  stable idempotency key. Pending state cannot read private Group data.
- Owner/Admin reviews current requests and uses
  `POST /social-groups/{id}/join-requests/{requestId}/{action}` with
  `approve | reject | cancel` as authorized and the request revision. An applicant
  may cancel only their own request. Approval creates membership from that consent.
- Owner/Admin may issue `/social-groups/{id}/invitations` with
  `{kind:"MEMBERSHIP",memberRole:"MEMBER",recipient:{userId}}` (or the documented
  email form). The recipient explicitly accepts/declines through
  `/social-group-invitations/{id}/accept` or `/decline` with `X-Invitation-Proof`
  and invitation If-Match. Issuing an invitation supplies approval but not consent.
- Proofs are private, bounded and expire after seven days. Preview uses the proof
  header and safe metadata; do not place proofs in logged query URLs/localStorage.
  An idempotent invitation retry can return `proof:null`; do not treat that as a
  usable proof or invent a proof-retrieval API.

Group roles are fixed: Owner/Admin/Member. Owner is derived custody. Owner/Admin
manage metadata, Member admissions and ordinary Member removal; only Owner appoints
or demotes Admins and initiates succession. Members read and leave. No self-promotion
or implicit Task/Goal/Conversation access exists. Friendship is not a Group right.
Use the exact membership seat ID and revision from the memberships endpoint.
Owner handover requires a verified current member's explicit acceptance and fresh
provider password reauthentication. Last-member departure uses existing 30-day
shared closure; do not pretend leaving deletes everyone's data immediately.

## 8. Phase 5 messaging and meetings integration

Create DMs/private groups/work channels using the discriminator-specific request.
For example a DM has `kind:"DM"`, `participants:[oneUserId]`, client `id` and an
approved retention version. Other named users must accept the invitation before
participating. Work membership alone never grants channel history. Rejoining has
a new generation/history floor; old cursors cannot recover pre-join content.

Use durable REST polling, with one bounded loop per conversation/device:

1. Bootstrap `/api/v1/conversations/{id}/recovery`, preserving its finite snapshot
   ceiling and initial `changeCursor` across pages.
2. After the final snapshot page, consume the documented incremental rich-message
   changes from that original cursor; do not replace it with a fresh tail cursor.
3. Upsert stable message IDs using authoritative revision/order, and apply deletion,
   self-hide and unavailable tombstones. Sequence/cursor values remain strings.
4. Keep device cursors separate. On 409, discard the invalid local projection and
   bootstrap safely; on 401/403/404, stop and evict unauthorized cached content.
5. Avoid overlapping polls. Current shared request ceilings are actor 20/IP 30
   per minute; share the budget across screens, back off on 429 and pause hidden
   or inactive views as appropriate. Do not poll each chat every second.

Use the exact rich-media, changes and receipt operations in OpenAPI. Delivered/read
acknowledgement is explicit and monotonic. Receipt sharing starts off and requires
current consent; Push routing has its own opt-in. Do not fabricate presence, typing,
online status or a WebSocket connection. A Push preference is not proof of working
browser/external Push delivery in the integration environment.

Ordinary author edit is limited to 48 hours. Within that window author
delete-for-everyone is allowed in DMs/private conversations and policy-controlled
in work channels. After it, ordinary deletion is self-only. Moderation and retained
history are different actions. Forwarding remains live-authorized at source/target;
never permanently copy a forwarded private payload to evade later revocation.

Meetings/minutes follow the actual draft/review/approval/final state machine.
Meeting acceptance, RSVP, delegation and published-document visibility differ from
work membership. Task conversion/release is explicit; do not create duplicate Tasks
optimistically. Announcements have audience generation and private acknowledgements.
No native calling or live video integration is implied by an external meeting URL.

## 9. Private files, data types and offline limits

Follow the owning operation's upload protocol: initiate metadata, stream original
bytes to its completion route, then attach/finalize in the owning authorized domain.
File IDs do not authorize access. No public storage URL, direct volume mount or
S3-presigned protocol is available. Preserve relative download paths against the API
origin and retain cookies/proofs as specified; downloads are bytes, not JSON.

Text/PDF/PNG/JPEG and contextual WAV support are explicit allowlists. Current
message voice is **WAV only, at most 120,000 ms and 10,000,000 bytes**; another
container emitted by browser recording is not accepted merely because MIME is
renamed. Use a compatible existing frontend recording/encoding path, or report the
format gap. Do not change the backend codec/provider. Generic file and attachment
limits differ by endpoint/configuration; read the actual schema and server result.
Structural media checks are implemented; full malware-engine release clearance is
still outside local acceptance. No Phase 6 social album/thumbnail API exists yet.

Preserve decimal money/quantity strings, currency codes, opaque IDs and large
sequence strings. Do not perform money math with JavaScript floating point.
Store/transmit Gregorian ISO date-only values, UTC instants and explicit IANA zones
as the contract requires; Jalali/locale display must not rewrite source dates.

The existing Personal offline subset is exactly TASK, CHECKLIST, LABEL, DAILY_PLAN,
HABIT_ENTRY, NOTE and CAPTURE, using the allowed command union. Do not queue auth,
file bytes, Finance, shared work, invitations, roles, messages or Social mutations
through Personal sync. Implement typed APPLIED/DUPLICATE/CONFLICT/REJECTED outcomes,
tombstones and safe cursor-expiry recovery; no blind last-write-wins.

Exports and staged account erasure use authenticated, expiring proof-based jobs.
Do not put private artifacts/tokens into public URLs, logs or long-lived caches.
Personal seven-day erasure grace and shared 30-day recovery are different policies.

## 10. Fable completion criteria

1. Record the backend SHA and OpenAPI file hash used. Confirm approved API/frontend
   origins, a real verified test account, cookie behavior and shared-feature readiness.
2. Integrate auth/account first, then existing Personal modules, then authorized
   Project/Team/Company contexts, communication/meetings and P6-01 Social features.
3. Use existing frontend client/types; generate or map only from this OpenAPI.
   Remove mocks from connected paths and make unimplemented/gated features explicit.
4. Prove each connected screen's happy path plus validation, 401/403/404/409/429,
   stale revision, response-loss retry and empty/paginated states. Use distinct
   verified users for outsider, friendship, pending and approved Group scenarios.
5. Check account/context switching, revocation, logout and block/unblock across
   reload and two sessions. Clear private state and stop unauthorized polling.
6. Report actual method/path failures with sanitized requestId, not secrets or full
   private bodies. List unresolved connectivity/contract gaps and remaining mocks.
7. Do not call the whole Phase 6 complete; do not add P6-02+, realtime or c09 features.

Backend local evidence includes one full 13-stage gate with findings resolved by
affected reruns, 717 distinct non-integration and 997 integration cases cumulatively,
final migration rehearsal and actual compiled API/worker restart smoke. This is not
evidence of a deployed public endpoint, completed Fable integration or operational
production acceptance. Backend deployment/activation remains a separate owner step.

## 11. Actual API topic index

The following topic counts are extracted from this release's canonical JSON.
Use them to navigate all 849 operations, then read each operation schema.

| Actual primary tag    | Operations | Example implemented paths                                                                                                                                                             |
| --------------------- | ---------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| account               |          5 | `/api/v1/me`, `/api/v1/me/settings`, `/api/v1/me/spaces`                                                                                                                              |
| auth                  |         15 | `/api/v1/auth/sign-up/email`, `/api/v1/auth/sign-in/email`, `/api/v1/auth/sign-out`                                                                                                   |
| calendar              |         13 | `/api/v1/calendar/events`, `/api/v1/calendar/events/{id}`, `/api/v1/calendar/time-blocks`                                                                                             |
| companies             |        140 | `/api/v1/companies`, `/api/v1/companies/{id}`, `/api/v1/companies/{id}/departments`                                                                                                   |
| company-lifecycle     |         12 | `/api/v1/companies/{id}/archive`, `/api/v1/companies/{id}/restore`, `/api/v1/companies/{id}/delete`                                                                                   |
| files                 |          4 | `/api/v1/files/uploads`, `/api/v1/files/{id}/complete`, `/api/v1/files/{id}/download`                                                                                                 |
| finance               |         41 | `/api/v1/finance/accounts`, `/api/v1/finance/accounts/{id}`, `/api/v1/finance/categories`                                                                                             |
| focus                 |         19 | `/api/v1/focus/sessions`, `/api/v1/focus/sessions/{id}`, `/api/v1/focus/sessions/{id}/history`                                                                                        |
| goals                 |         29 | `/api/v1/life-areas`, `/api/v1/life-areas/{id}`, `/api/v1/goals`                                                                                                                      |
| habits                |         18 | `/api/v1/habits`, `/api/v1/habits/{id}`, `/api/v1/habits/{id}/schedules`                                                                                                              |
| health                |          2 | `/health/live`, `/health/ready`                                                                                                                                                       |
| insights              |          6 | `/api/v1/insights/overview`, `/api/v1/insights/tasks`, `/api/v1/insights/habits`                                                                                                      |
| labels                |          5 | `/api/v1/labels`, `/api/v1/labels/{id}`                                                                                                                                               |
| meetings              |         52 | `/api/v1/meetings`, `/api/v1/meetings/invitations`, `/api/v1/meetings/invitations/{invitationId}/respond`                                                                             |
| messaging             |         63 | `/api/v1/conversations`, `/api/v1/conversations/{id}`, `/api/v1/conversations/{id}/members`                                                                                           |
| notifications         |         20 | `/api/v1/reminders`, `/api/v1/reminders/{id}`, `/api/v1/reminders/{id}/pause`                                                                                                         |
| personal-lifecycle    |          8 | `/api/v1/me/export`, `/api/v1/me/exports/{id}`, `/api/v1/me/exports/{id}/download`                                                                                                    |
| planning              |         18 | `/api/v1/planning/days/{date}`, `/api/v1/planning/days/{date}/items/{taskId}`, `/api/v1/planning/days/{date}/items/{taskId}/move`                                                     |
| project-collaboration |         30 | `/api/v1/projects/{projectId}/exports`, `/api/v1/projects/{projectId}/files/reconcile`, `/api/v1/projects/{projectId}/content/{targetKind}/{targetId}/comments/{commentId}/history`   |
| project-execution     |         35 | `/api/v1/projects/{projectId}/register-items`, `/api/v1/projects/{projectId}/register-items/{itemId}`, `/api/v1/projects/{projectId}/register-items/{itemId}/history`                 |
| project-tools         |         26 | `/api/v1/projects/{projectId}/workflows`, `/api/v1/projects/{projectId}/workflows/{workflowId}/versions`, `/api/v1/projects/{projectId}/tasks/{taskId}/workflow`                      |
| projects              |         44 | `/api/v1/projects`, `/api/v1/projects/{id}`, `/api/v1/projects/{id}/archive`                                                                                                          |
| rewards               |          5 | `/api/v1/rewards/preferences`, `/api/v1/rewards/progress`, `/api/v1/rewards/achievements`                                                                                             |
| shared-collaboration  |         13 | `/api/v1/spaces/{spaceId}/invitations`, `/api/v1/spaces/{spaceId}/invitations/{id}`, `/api/v1/invitations/preview`                                                                    |
| shared-work           |         19 | `/api/v1/projects/{projectId}/assignment-policy`, `/api/v1/projects/{projectId}/tasks/{taskId}/assignments`, `/api/v1/projects/{projectId}/tasks/{taskId}/assignments/{assignmentId}` |
| social                |         40 | `/api/v1/social/privacy`, `/api/v1/social/discovery`, `/api/v1/social/connections`                                                                                                    |
| sync                  |          3 | `/api/v1/sync/status`, `/api/v1/sync/pull`, `/api/v1/sync/push`                                                                                                                       |
| tasks                 |         45 | `/api/v1/tasks`, `/api/v1/tasks/{id}`, `/api/v1/tasks/{id}/complete`                                                                                                                  |
| team-analytics        |          6 | `/api/v1/teams/{id}/capacity`, `/api/v1/teams/{id}/capacity/{capacityId}`, `/api/v1/teams/{id}/workload`                                                                              |
| team-interactions     |         21 | `/api/v1/teams/{id}/cases`, `/api/v1/teams/{id}/cases/{caseId}`, `/api/v1/teams/{id}/cases/{caseId}/entries`                                                                          |
| team-lifecycle        |         12 | `/api/v1/teams/{id}/archive`, `/api/v1/teams/{id}/restore`, `/api/v1/teams/{id}/delete`                                                                                               |
| teams                 |         43 | `/api/v1/teams`, `/api/v1/teams/{id}`, `/api/v1/teams/{id}/memberships`                                                                                                               |
| writing               |         37 | `/api/v1/notes`, `/api/v1/notes/{id}`, `/api/v1/notes/{id}/history`                                                                                                                   |

## 12. Actual P6-01 operation index

`K` = required Idempotency-Key; `R` = required If-Match;
`P` = required X-Invitation-Proof. Mutations also require trusted browser Origin.
Success codes come from the generated contract; do not assume query-like POST is 200.

| Method | Actual path                                                     | operationId                                           | Required K/R/P | Success |
| ------ | --------------------------------------------------------------- | ----------------------------------------------------- | -------------- | ------- |
| GET    | `/api/v1/social/privacy`                                        | `socialgetsocialprivacy`                              | —              | 200     |
| PATCH  | `/api/v1/social/privacy`                                        | `socialpatchsocialprivacy`                            | K, R           | 200     |
| POST   | `/api/v1/social/discovery`                                      | `socialpostsocialdiscovery`                           | —              | 201     |
| GET    | `/api/v1/social/connections`                                    | `socialgetsocialconnections`                          | —              | 200     |
| POST   | `/api/v1/social/connections`                                    | `socialpostsocialconnections`                         | K              | 201     |
| POST   | `/api/v1/social/connections/{id}/{action}`                      | `socialpostsocialconnectionsidaction`                 | K, R           | 201     |
| GET    | `/api/v1/social/blocks`                                         | `socialgetsocialblocks`                               | —              | 200     |
| POST   | `/api/v1/social/blocks`                                         | `socialpostsocialblocks`                              | K, R           | 201     |
| POST   | `/api/v1/social/blocks/{id}/unblock`                            | `socialpostsocialblocksidunblock`                     | K, R           | 201     |
| POST   | `/api/v1/social/restore-replay`                                 | `socialpostsocialrestorereplay`                       | —              | 201     |
| GET    | `/api/v1/social/circles`                                        | `socialgetsocialcircles`                              | —              | 200     |
| POST   | `/api/v1/social/circles`                                        | `socialpostsocialcircles`                             | K              | 201     |
| GET    | `/api/v1/social/circles/{id}`                                   | `socialgetsocialcirclesid`                            | —              | 200     |
| PATCH  | `/api/v1/social/circles/{id}`                                   | `socialpatchsocialcirclesid`                          | K, R           | 200     |
| DELETE | `/api/v1/social/circles/{id}`                                   | `socialdeletesocialcirclesid`                         | K, R           | 200     |
| GET    | `/api/v1/social/circles/{id}/members`                           | `socialgetsocialcirclesidmembers`                     | —              | 200     |
| PUT    | `/api/v1/social/circles/{id}/members/{connectionId}`            | `socialputsocialcirclesidmembersconnectionId`         | K, R           | 200     |
| DELETE | `/api/v1/social/circles/{id}/members/{connectionId}`            | `socialdeletesocialcirclesidmembersconnectionId`      | K, R           | 200     |
| POST   | `/api/v1/social-groups`                                         | `socialpostsocialgroups`                              | K              | 201     |
| GET    | `/api/v1/social-groups`                                         | `socialgetsocialgroups`                               | —              | 200     |
| GET    | `/api/v1/social-groups/discover`                                | `socialgetsocialgroupsdiscover`                       | —              | 200     |
| GET    | `/api/v1/social-groups/{id}`                                    | `socialgetsocialgroupsid`                             | —              | 200     |
| PATCH  | `/api/v1/social-groups/{id}`                                    | `socialpatchsocialgroupsid`                           | R              | 200     |
| GET    | `/api/v1/social-groups/{id}/memberships`                        | `socialgetsocialgroupsidmemberships`                  | —              | 200     |
| PATCH  | `/api/v1/social-groups/{id}/memberships/{accessId}`             | `socialpatchsocialgroupsidmembershipsaccessId`        | R              | 200     |
| POST   | `/api/v1/social-groups/{id}/invitations`                        | `socialpostsocialgroupsidinvitations`                 | K              | 201     |
| GET    | `/api/v1/social-groups/{id}/invitations/{offerId}`              | `socialgetsocialgroupsidinvitationsofferId`           | —              | 200     |
| POST   | `/api/v1/social-groups/{id}/invitations/{offerId}/revoke`       | `socialpostsocialgroupsidinvitationsofferIdrevoke`    | R              | 201     |
| POST   | `/api/v1/social-groups/{id}/join-requests`                      | `socialpostsocialgroupsidjoinrequests`                | K              | 201     |
| GET    | `/api/v1/social-groups/{id}/join-requests`                      | `socialgetsocialgroupsidjoinrequests`                 | —              | 200     |
| POST   | `/api/v1/social-groups/{id}/join-requests/{requestId}/{action}` | `socialpostsocialgroupsidjoinrequestsrequestIdaction` | R              | 201     |
| POST   | `/api/v1/social-groups/{id}/leave`                              | `socialpostsocialgroupsidleave`                       | R              | 201     |
| POST   | `/api/v1/social-groups/{id}/handovers`                          | `socialpostsocialgroupsidhandovers`                   | K              | 201     |
| GET    | `/api/v1/social-groups/{id}/handovers/{handoverId}`             | `socialgetsocialgroupsidhandovershandoverId`          | —              | 200     |
| POST   | `/api/v1/social-groups/{id}/handovers/{handoverId}/decline`     | `socialpostsocialgroupsidhandovershandoverIddecline`  | R              | 201     |
| POST   | `/api/v1/social-groups/{id}/handovers/{handoverId}/revoke`      | `socialpostsocialgroupsidhandovershandoverIdrevoke`   | R              | 201     |
| POST   | `/api/v1/social-groups/{id}/handovers/{handoverId}/accept`      | `socialpostsocialgroupsidhandovershandoverIdaccept`   | R              | 201     |
| GET    | `/api/v1/social-group-invitations/preview`                      | `socialgetsocialgroupinvitationspreview`              | P              | 200     |
| POST   | `/api/v1/social-group-invitations/{id}/accept`                  | `socialpostsocialgroupinvitationsidaccept`            | R, P           | 201     |
| POST   | `/api/v1/social-group-invitations/{id}/decline`                 | `socialpostsocialgroupinvitationsiddecline`           | R, P           | 201     |

Canonical OpenAPI SHA-256: `ea8c49ef225d6a5e23d00522550e93f96b6b8bba18522b047fb9ea7dc262463f`.
