# Consolidated API gaps — 2026-11-13

Batch: owner-approved consolidated API gaps, after P6-01.
Status: **COMPLETE**, with affected gate reruns passing as recorded below.
Source: `planner/docs/integration/BACKEND_REQUIREMENTS.md`, seven technical requests.

Implemented: **X1, X2, M1, X3 (reuse), X4, M2, Company exports**.
Paths below are relative to `/api/v1`.

| ID      | New or reused operation                                                                                                        | Contract and authority                                                                                                                                                                                                                                                                                                                                                                                |
| ------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X1      | New `GET /teams/{id}/access/me`                                                                                                | `accessId`, local `actorId`, `role`, `generation`, `capabilities`; current full Team read authority, effective policy and lifecycle. Includes current channel-create and announcement-publish rights.                                                                                                                                                                                                 |
| X1      | New `GET /companies/{id}/contexts/{scopeId}/access/me`                                                                         | Same admission fields; existing Company structural/directory policies and administrative guards. Root administrators without child admission receive structural administration hints, never child staff/finance/knowledge/export hints.                                                                                                                                                               |
| X1      | New `GET /conversations/{id}/access/me`                                                                                        | Accepted current conversation admission and current source authority; participant role and read/send/leave/manage/rename capabilities. These hints never replace endpoint authorization.                                                                                                                                                                                                              |
| X2      | Existing Team memberships, Company members/staff/finance/cases/audit, Conversation members/invitations, Meeting members        | Nullable `displayName` on authorized member projections; `actorDisplayName`, `createdByDisplayName`, `beneficiaryDisplayName`, `inviterDisplayName` alongside corresponding actor references. Historical unavailable identities yield null. Names are plain text, resolved at read time; no avatar, account ID, private profile or contact additions. Inputs remain strict and reject display fields. |
| M1      | Extended `GET /conversations`                                                                                                  | Each row adds nullable `lastMessage` (`id`, `memberId`, `kind`, nullable `text`, `createdAt`), `unreadCount`, private `muted`, `lastActivityAt`, `updatedAt`. Current rich-message visibility, media/file rights, forwarding-source checks, current join floor and private read watermark apply. Count only visible incoming messages newer than both floors; own sends are excluded.                 |
| X3      | Reused `POST /social/discovery`                                                                                                | Exact `{email}` lookup; `{items:[{id,name}]}` or identical empty list for absent, undiscoverable, blocked, inactive, unverified or self. `id` supplies invitation/conversation `userId`. Existing verified session, account fences, opt-in discovery and throttling remain; Team/Company email invitations can already use the recipient email directly.                                              |
| X4      | New `GET /team-invitations`, `GET /company-invitations`                                                                        | Recipient-only pending, unexpired offers, rechecking current verified identity/email, issuer and custody. Minimal `{id,contextLabel,revision,expiresAt}`; signed `after` pagination, `limit` 1–100. No proof, recipient address, roster, private context contents or admission.                                                                                                                       |
| X4      | New `GET /teams/{id}/invitations`, `GET /companies/{id}/contexts/{scopeId}/invitations`, `GET /conversations/{id}/invitations` | Pending, unexpired existing invitation projections; current role/delegation ceiling, exact scope and current admission. Team/Company use `after`; Conversation uses `cursor`. Proofs and recipient contacts are absent. Reuse existing recipient `GET /conversation-invitations`.                                                                                                                     |
| M2      | New `PATCH /conversations/{id}`                                                                                                | Strict `{title}` (trimmed 1–200 characters), trusted Origin, quoted `If-Match`; updated existing conversation and ETag. Current accepted private-group Admin or source Owner/Admin (Company Owner/Org Admin) only; DM denied. Shared revision, custody fences, audit/outbox and stale-writer conflict are reused.                                                                                     |
| Exports | Reused `POST /companies/{id}/contexts/{scopeId}/exports`                                                                       | Existing synchronous JSON/CSV attachment, now exact dataset-specific JSON schema and `X-Export-Id` header (CORS exposed). No new export job/artifact. Existing manager/child-admission/source checks, bounds and formula-safe CSV apply.                                                                                                                                                              |
| Exports | New `GET /companies/{id}/contexts/{scopeId}/exports`, `GET /companies/{id}/contexts/{scopeId}/exports/{exportId}`              | Signed, manager-authorized publication history from existing audit records: `{id,scopeId,state:"PUBLISHED",publishedAt,downloadAvailable:false}`. Same Company/context only. Does not claim browser receipt, retained download, pending job, historical dataset/format or retry state that was never stored.                                                                                          |

Conversation timestamps describe the latest currently visible message, falling back
to creation when none is visible; `updatedAt` aliases `lastActivityAt`. Rename,
reactions, edits and personal mute do not manufacture a message timestamp. Existing
ID cursor order is preserved; clients may sort collected rows by `lastActivityAt`.

Files/modules: Teams, Companies, Messaging, Meetings and Spaces public authority /
identity projections; contracts/OpenAPI, CORS header, focused integration/contract
tests and compatibility tooling. The shared migration-inventory test now includes
the two pre-existing local Project migrations; their SQL is unchanged.
No Frontend or unrelated Personal/Project feature
implementation. Existing uncommitted Project work remains.

Events/jobs: rename uses the existing Shared audit/outbox with
`messaging.conversation.rename`; no new job, worker or export artifact.

Entities, migrations and constraints: **none created or applied by this feature**.
No Prisma schema changes from this work; pre-existing Project schema/migrations
remain owned by the prior work. Isolated test setup may deploy existing migrations
to its explicitly guarded test database and disposable schemas; development data
is untouched. Existing invitation proofs, retention and Shared activation stay intact.

API: **860 operations**, up from the actual local 849; eleven new operations.
The 85 exact approved successful-response extensions are frozen in
`tooling/compatibility/consolidated-api-response-extensions.json`. Every historical
snapshot stays unchanged; other request/security/response hashes remain mandatory.
Mutation tests reject changes to the new shapes and neighboring fields.

Security/edge cases: outsiders and pending invitees denied content, exact scope and
current-generation checks, archived capability filtering, erased/closed identity
redaction, proof-required acceptance, private mute/read state, prejoin/hide/delete
and revoked-forward exclusion, strict rename inputs, optimistic concurrent writers,
private bounded inline exports and context-isolated status reads.

Tests and results:

- `pnpm.cmd typecheck`: PASS.
- `pnpm.cmd test:integration apps/api/test/integration/messaging.spec.ts apps/api/test/integration/company-knowledge.spec.ts apps/api/test/integration/meetings.spec.ts -t 'consolidated gaps'`: PASS, 8 tests. The full suite ran subsequently.
- Targeted contract/compatibility Vitest: PASS, 9 tests across two runs.
- `pnpm.cmd quality`: all 13 stages ran. Configuration, generation, provider-auth schema, Prisma validation, build/typecheck, lint, architecture, OpenAPI and migration gates passed. Initial aggregate exit was **1**: formatting, two stale unit inventory counters, an exact staff DTO assertion, the cached pre-fix case-name redaction projection, and one concurrent fixture-teardown lock error required the affected reruns below. Do not interpret the initial aggregate exit as a clean run.
- Unit/contract/architecture/compatibility stage: 721/723 initially passed. `pnpm.cmd exec vitest run --project unit apps/api/src/platform/database/foundation.spec.ts packages/api-contracts/src/advanced-messaging.spec.ts`: PASS, 10 tests after exact inventory/counter updates. No required assertions were removed.
- Full PostgreSQL suite: 1,013/1,015 tests initially passed; one additional suite teardown exhausted shared locks while another isolated run was finishing. `pnpm.cmd test:integration apps/api/test/integration/company-staff.spec.ts apps/api/test/integration/company-knowledge.spec.ts apps/api/test/integration/project-execution.spec.ts`: **PASS, 74/74**, serially, including the final redaction regression and both failed assertions.
- Final `pnpm.cmd build`, `pnpm.cmd typecheck`, affected-file ESLint, `pnpm.cmd format:check`, `pnpm.cmd openapi:check` and `git diff --check`: PASS after corrections. Architecture: zero violations across 577 modules.
- Migration gate: PASS, additive safety/history/checksum checks, empty/populated upgrades, interruption/rollback/resume and repeat deployment through the existing release baseline. No existing database reset. The two newly created fixture namespaces left by lock-exhausted teardown were identified by exact UUID, migration creation timestamp and synthetic fixture version, then successfully disposed serially; no pre-session data was removed.

Detailed local command evidence: ignored `.tools/consolidated-*.log` files.
Tests not run: live API/worker smoke, Shared activation, Docker/hosted CI and
deployment/release checks, as restricted by the owner and this local work scope.

Deviations: none from the seven approved technical requests. Reused discovery and
synchronous export history avoid introducing a second lookup policy or export engine.
Remaining owner decisions: OD-1 through OD-14 remain unresolved and unimplemented;
**OD-4 still blocks choosing proof delivery/resend UX**, not safe invitation lists.
**OD-14 still blocks Frontend/Shared activation**. No live tests, activation,
Docker release checks, commits, pushes or deployment were performed.

Git: 61 modified and 15 untracked entries, zero staged; nothing committed or pushed.
All prior uncommitted work is preserved. No independent Backend implementation
blocker remains; the owner decisions above still apply to integration/activation.
Next eligible batch: **P6-02, NOT STARTED and not authorized by this request**.
