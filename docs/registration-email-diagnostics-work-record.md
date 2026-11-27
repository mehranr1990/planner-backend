# Registration Diagnostics and System Email Delivery Logs

Owner-authorized backend batch, 2026-11-27. Status: COMPLETE - LOCAL DEVELOPMENT.
Owner acceptance and publication approval are recorded at the end of this file;
earlier uncommitted/next-action notes are pre-publication checkpoints.
Readiness was accepted after reviewing its final evidence, 32-file diff and ADR 0080. Its 1,038 repository / 234 affected PostgreSQL cases and quality gates were
verified. Published only those 32 files as
`3b1e19bc59b58e4f60c5cce14749d0091b4c7f6e`, verified on origin/main.
Owner compose SHA256 remains
`c42657021cd05da9ad7412dd67e675470b8029ffdabccb4b55035a363623cf20`;
all 155 predecessor migration files matched their published bytes. Only compose
remained dirty after publication. Diagnostics must remain uncommitted/unpushed.

## Inspection and execution plan

Reuse AdminIdentity/AdminAccounts directory, audited manual verification/recovery,
AdminDelivery, IdentityMailService, NotificationTransport, invitation and P4
delivery owners, existing pg-boss worker, lifecycle and policy retention.
Existing active sessions cannot establish lifetime sign-in history. Existing SENT
queue states cannot prove inbox delivery or actual historical SMTP acceptance.

Add durable registration diagnostics with explicit incomplete-history evidence;
capture successful sign-ins and verification transitions at existing authoritative
boundaries. Extend Admin filters/read contracts without changing ordinary APIs.
Add narrowly authorized, audited verification resend using fresh provider proofs
through AdminDelivery and existing rate/idempotency/revision controls.

Add metadata-only SMTP observations, never a parallel mail queue. Owning public
facades expose current existing queue state; a bounded unified Admin view merges
those projections with actual transport observations. Cover identity, all six
invitation kinds, support, security, communications and Personal system mail.
Only actual SMTP evidence may produce SMTP_ACCEPTED; sink, unknown and failure
remain distinct. No bounce receiver or confirmed inbox delivery is fabricated.
Retries are limited to existing authorized safe owner workflows and fresh proofs.

Use additive reviewed M129/M130 migrations; preserve every historical file. Update ADR,
Master Spec, contracts/OpenAPI/generated reference, consolidated handoff and matrix.
Run focused security/transport/PostgreSQL tests during development and applicable
mandatory final gates once. Reuse unchanged predecessor evidence under section 16.
No frontend, E2E, subagents, deployment, dependency changes or unrelated refactoring.

## Implemented boundaries and inspection results

Existing account directory, suspension, audited exceptional manual verification,
password recovery, source invitation resend and durable delivery infrastructure
were retained. Four new Admin operations extend modules 03/13; no additional
role, ordinary API, queue, transport provider or dependency was introduced.

- User diagnostics: registration/current-email verification dates, actual
  successful sign-in capture at the existing audit boundary, complete versus
  retained/unknown history, independent verification/login/suspension/date
  filters and nullable historical dates. Active sessions are never login history.
- Verification resend: explicit SUPER_ADMIN/SUPPORT capability, recent MFA,
  reason, current revision, idempotent queued acknowledgement, three actual
  requests per recipient per minute and fresh provider proofs in AdminDelivery.
  Worker rechecks current email, state and initiating operator authority.
- Operational mail: source-owner projections for identity mail, all six invitation
  kinds, support/moderation notices, security and operational alerts,
  communications, ordinary notifications and Admin notices. Bounded identical
  pre-page filters and the existing actor/filter-bound cursor combine these
  sources; no frontend-page-derived totals or unrelated resource content.
- Safe observations: real attempt/completion evidence, source attempts/schedule,
  sanitized failure code/provider reference and honest QUEUED/PROCESSING/
  SMTP_ACCEPTED/FAILED/BOUNCED/UNKNOWN/CANCELED/SINK_ACCEPTED states. Old SENT
  without a real receipt is UNKNOWN. Inbox delivery is always UNKNOWN; no bounce
  receiver or historical data is fabricated.
- Retry: explicitly authorized fresh verification/recovery owner flows, or a new
  delivery for failed plain account/workspace notices while preserving old
  attempt history. No arbitrary invitation/deletion/credential replay. Stable
  idempotent acknowledgement contains no proof, link or body.
- Lifecycle: existing COMMUNICATIONS retention policy/impact preview/worker sweep,
  source deletion, User/Admin cascades, pre-commit subject erasure and safe owned
  Personal portability metadata. No token/body/credential logging.

Canonical invitation context lookup was corrected from AccessScope ROOT to the
existing custody kind. This is necessary both for the six categories and for
respecting actual per-module email preferences; focused Messaging regressions
confirm that a disabled TEAM category cannot borrow SOCIAL email consent.

## Persistence and frozen SQL

One new metadata table, five UserSettings evidence fields, four nullable source
creation timestamps, two identity FKs, source/identity cleanup triggers and typed
indexes. M130 adds a non-authorizing pre-commit subject reference for old-address
erasure; M129 was already applied in the isolated test database and was not edited.
New totals: 438 tables including migration ledger and 1,331 foreign keys. Provider
User scalar fields/indexes remain unchanged; only an exact application-owned
inverse relation is registered in the existing provider schema check.

| Migration                           | SHA256                                                           |
| ----------------------------------- | ---------------------------------------------------------------- |
| M129 registration_email_diagnostics | 0ec432d1a0c38fdb5d71f997d5e30fb725943d3d5a235ef3db7972356cd9baa1 |
| M130 email_subject_erasure          | 7010c615c0f234a312fdbc21a8cc700cab4f22dfbe9c4b1341a9639775501944 |

The populated M128 upgrade preserves all 436 predecessor datasets and all 154
historical checksum ledger rows. It rehearses interrupted transactional M129,
rollback, normal M129/M130, repeat deployment, old account unknown history,
retained audit partial history, absence of session inference, legacy delivery
unknown state, pre-commit subject erasure and the exact 1,331-edge FK hash.
All configured databases remain intact; only owned guarded test schemas are used.

## Contract and handoff synchronization

Master Spec sections 03/13 and authorization record, ADR 0081, consolidated
handoff, all-22-module matrix and generated Admin reference are current.
OpenAPI and parsed-identical frontend mirror contain 1,575 operations and 14,344
resolved references; all 212 Admin operations map to the existing 22 modules.
New mutations explicitly declare required Idempotency-Key. Ordinary contracts
and all historical compatibility baselines remain unchanged.

## Verification checkpoints and corrected failures

Directly affected development checks passed: SMTP/evidence/identity transport
unit cases (37), identity lifecycle PostgreSQL cases (10), registration diagnostics
(7 before the final plain-notice case), populated upgrade, six invitation-kind
projections and notification preferences. Final full suites supersede targeted
checkpoints where their inputs changed.

The full repository checkpoint ran 1,042 cases: 1,039 passed and three failed due
only to a frozen migration-list fixture missing M129/M130 and two invitation-mail
fixtures missing canonical custody lookup. Both fixtures were updated without
changing assertions/guards; all 16 affected unit/provider compatibility cases
passed in `.tools/diagnostics-repository-affected-rerun.log` (native exit 0).
The official auth schema gate initially reported the new application-only inverse
relation; registering its exact reviewed shape fixed it. The official gate and
malformed-relation rejection tests passed. Full lint found copied unused fixture
imports and caught a fixture during its edit; imports were removed and the
complete affected-file rerun passed, exit 0. No required behavior or test was
skipped, weakened or deleted to obtain passing results.

Final PostgreSQL, migration and formatting results are recorded below. No deployment, Docker, frontend, E2E, live-provider or subagent work is
claimed. Production SMTP/optional authenticated bounce evidence and inbox receipt
remain integration limitations, explicitly represented by the API's evidence.

## Mandatory gates completed so far

Native exit statuses are retained in ignored `.tools/diagnostics-*.result.json`;
logs contain no configuration values or email secrets. Commands below use the
repository's pinned pnpm/Node environment.

| Command                                                                                                                                                                                                           | Actual result / evidence                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm config:check`                                                                                                                                                                                               | PASS, exit 0; diagnostics-final-config.log                                                                                                                                           |
| `pnpm db:generate`                                                                                                                                                                                                | PASS after final subject/schema input change during implementation; generated client used by final build/types/PostgreSQL                                                            |
| `pnpm db:validate`                                                                                                                                                                                                | PASS, exit 0; diagnostics-final-prisma.log                                                                                                                                           |
| `pnpm auth:schema:check`                                                                                                                                                                                          | Initial exact inverse-relation drift corrected; PASS, exit 0, diagnostics-auth-schema-rerun.log                                                                                      |
| `pnpm build`                                                                                                                                                                                                      | PASS, exit 0; diagnostics-final-build.log                                                                                                                                            |
| `pnpm typecheck`                                                                                                                                                                                                  | PASS, exit 0; diagnostics-final-types.log                                                                                                                                            |
| `pnpm architecture`                                                                                                                                                                                               | PASS, exit 0; 882 modules / 6,090 dependencies, diagnostics-final-architecture.log                                                                                                   |
| `node --max-old-space-size=12288 node_modules/eslint/bin/eslint.js . --max-warnings 0`                                                                                                                            | Initial fixture-only failures corrected; affected complete file set PASS, exit 0, diagnostics-final-lint-affected.log                                                                |
| `pnpm test --maxWorkers=1`                                                                                                                                                                                        | 1,042 cases ran: 1,039 initially passed; three fixture failures corrected; all 16 affected unit/provider compatibility cases PASS, exit 0, diagnostics-repository-affected-rerun.log |
| `pnpm openapi:check`                                                                                                                                                                                              | PASS, exit 0 after final new-route MFA/idempotency descriptions; diagnostics-final-openapi-rerun.log                                                                                 |
| `pnpm exec vitest run --project compatibility tooling/compatibility/openapi.spec.ts tooling/compatibility/backend-integration-readiness.spec.ts tooling/compatibility/auth-provider-model.spec.ts --maxWorkers=1` | PASS, 16 cases / 3 files, diagnostics-final-contract-rerun.log                                                                                                                       |
| `node tooling/scripts/admin-integration-reference.ts --check`                                                                                                                                                     | PASS, exit 0; 212 operations / 22 modules, diagnostics-final-handoff.log                                                                                                             |
| `pnpm db:migrations:check`                                                                                                                                                                                        | PASS, exit 0; full empty/history/repeat/owned-schema and populated upgrade gate through M130, diagnostics-final-migrations.log                                                       |
| `pnpm format:check`                                                                                                                                                                                               | PASS, exit 0 at contract/document checkpoint; final changed-document check follows acceptance notes                                                                                  |

The full PostgreSQL checkpoint reported a 15-second timeout in an unchanged
Workspace retention-hold case and a subsequent restore-quarantine failure.
The complete affected 32-case suite was rerun with unchanged assertions and
unchanged timeouts: all 32 PASS, exit 0, diagnostics-workspaces-investigation.log.
The hold case completed in 4.647s and restore case in 0.248s. No product change or
extra timeout allowance was needed. Final full-suite totals will retain the
original timeout and successful affected rerun honestly.

Preservation checkpoint: HEAD is published readiness `3b1e19b`, index empty,
155 historical migration files identical to HEAD, M129/M130 frozen hashes above,
owner compose exact, and all 195 reviewed frontend files/status unchanged.
OpenAPI/mirror parse identically. No secret, local configuration, dependency,
lockfile or ignored temporary artifact is part of the 68-path diagnostics batch.

## Final local acceptance

Full PostgreSQL command `pnpm test:integration --maxWorkers=1` completed all 70
files: 1,392 passed, three failed and one conditional scanner case skipped
(1,396 discovered, 1,395 runnable). Besides the two Workspace cases documented
above, the new NUL-search assertion initially received 500 while this full run
overlapped the contracts package rebuild. The complete diagnostics suite was then
run against the final built package with unchanged assertions: **8/8 PASS**,
exit 0, `.tools/diagnostics-registration-final-rerun.log`. Its strict NUL rejection
returns 400, and all authorization, fresh proofs, unknown history, retention,
source deletion, rate limits, idempotency and safe notice retry cases pass.
The complete Workspace suite is **32/32 PASS**, unchanged. The successful
checkpoint plus both affected reruns verify all **1,395 runnable PostgreSQL
cases**; the original full command is retained as failed, never relabeled passed.

All **1,042 repository cases** are covered by the full checkpoint plus successful
fixture/provider compatibility reruns. Final contract compatibility additionally
passed all 16 affected cases after the exact new MFA/idempotency descriptions.
The new migration upgrade passes both in the full PostgreSQL checkpoint and in
the complete migration gate. No acceptance assertion, timeout, mandatory test or
security boundary was weakened or bypassed. Under section 16, unchanged passing
suites are reused instead of repeating the complete 20-minute PostgreSQL run.

The one existing scanner check requires CLAMAV_SMOKE_HOST and is SKIPPED, not
passed. Existing node-postgres concurrent-query deprecation notices are recorded
as a non-blocking tooling warning; changing unrelated fixtures/driver behavior is
outside this batch. No local implementation blocker or unresolved approved
product decision remains. Production/live SMTP, optional authenticated bounce
receipts, actual inbox confirmation, trusted inbound/scanner, Docker/HTTPS,
physical off-host restore and target migration application are NOT RUN and remain
operator/deployment integration checks. No inbox/bounce history is fabricated.

Final end-of-batch report:

- Batch: Registration Diagnostics and System Email Delivery Logs.
  Status: **COMPLETE - LOCAL DEVELOPMENT**.
- Scope/files: modules 03/13, Account/Auth and source-owner mail facades, existing
  notifications/engagement/operations/worker and lifecycle; typed contracts,
  Master Spec, ADR 0081, OpenAPI/mirror, generated reference and 22-module handoff.
- Entities/migrations/constraints: metadata-only SystemEmailObservation, actual
  UserSettings evidence and nullable source dates; additive immutable M129/M130,
  438-table / 1,331-FK catalog. All 155 predecessor migration files preserved.
- APIs/events/jobs: four additive Admin operations plus extended User detail/list
  filters; existing authoritative sign-in/verification evidence, SMTP, outbox,
  pg-boss deliveries and retention sweep. No duplicate queue or provider.
- Security/edge cases: four closed roles, explicit email/read/retry/resend rights,
  recent MFA, audit, revision/idempotency/rate and current-recipient safeguards;
  fresh proofs, unknown historical evidence, tenant/privacy/deletion boundaries,
  safe metadata only and existing per-module notification preferences.
- Tests/results: exact commands, initial failures, successful affected reruns and
  preserved historical evidence above. Final type/lint/document results are
  captured in native result files; final protected proof remains reproducible.
- Tests not run: excluded frontend/E2E/subagent/deployment work, conditional scanner
  and live-provider/inbox/bounce/physical release checks as described above.
- Deviations: no dependency, provider, ordinary Client contract, phase scope or
  entitlement change. No speculative feature or unrelated refactor.
- Outstanding issues/ADRs: no local acceptance blocker. Actual bounce/inbox evidence
  requires a separately trusted provider integration; API truthfully says UNKNOWN.
- Git: accepted readiness is published as `3b1e19bc59b58e4f60c5cce14749d0091b4c7f6e`.
  **Diagnostics is uncommitted/unpushed; index empty.** Owner compose and historical
  migration bytes/checksums, secrets/local configuration and unrelated work remain
  preserved/excluded. Frontend snapshot/status unchanged; ignored tools stay local.
- Next eligible action: owner review and separate diagnostics publication approval.
  No next implementation batch, frontend integration or deployment is started.

Final checks after the last contract/fixture edits: `pnpm typecheck` PASS, exit 0
(`diagnostics-final-types-rerun.log`); affected OpenAPI source lint PASS, exit 0
(`diagnostics-final-lint-contract.log`); final changed-document Prettier check
PASS, exit 0 (`diagnostics-final-doc-check.log`). Earlier full formatting and
full lint plus corrected affected files remain valid for all unchanged inputs.
`git diff --check` is clean. Final preservation proof is in
`.tools/diagnostics-preservation-result.json`: 68 batch paths excluding compose,
155 unchanged published migration files, 195 unchanged reviewed frontend files,
empty index, exact owner compose SHA256 and frozen M129/M130 hashes. Both HEAD
and origin/main tracking ref remain published readiness `3b1e19b`.

## Owner acceptance and publication approval (2026-11-27)

The owner accepted this batch for local development, subject to final evidence
verification, and authorized committing/pushing only the approved Diagnostics
changes to origin/main. The final diff and native acceptance logs were reviewed;
no unresolved acceptance failure remains after the documented affected reruns.
All 68 batch paths are allowlisted. Compose, every predecessor migration, secrets,
local configuration, ignored temporary artifacts and unrelated files are excluded.
Only publication metadata in these existing documents changed during this review;
implementation, schema, checksums and generated contract inputs are unchanged.
Unchanged tests are reused under AGENTS section 16. Fresh deterministic artifact,
format, checksum, staged-path and protected-file checks precede publication.

This Git revision is the final Diagnostics publication candidate; its immutable
commit is obtained with git log -1 -- docs/registration-email-diagnostics-work-record.md.
The final operator response records the actual pushed commit and live origin/main
comparison. No self-referential commit hash is embedded in its own Git contents.
Prior uncommitted/approval statements above describe the acceptance checkpoint.
No new development or deployment is authorized after this publication.

Final contract inventory: **212 Admin operations + 1,363 ordinary/public operations
= 1,575 HTTP operations**, with all 22 Admin modules mapped. The ordinary/public
count includes non-Admin authentication, health and public routes; it is not a
claim that every non-Admin route requires an ordinary authenticated session.
OpenAPI source generation, parsed-identical frontend mirror and generated Admin
reference are verified without regenerating unchanged artifacts. The consolidated
handoff and 22-module matrix in this same revision document exact current rights,
contracts, evidence semantics and deployment-only limitations.

Final migration inventory: **156 versioned migration directories/SQL files**,
comprising 154 historical migrations from accepted readiness plus immutable
M129/M130 above; with migration_lock.toml there are **157 migration files**.
All 155 predecessor files remain byte-identical to readiness. The canonical full
inventory is prisma/migrations; git ls-tree -r --name-only HEAD prisma/migrations
lists the complete published names. Current schema catalog: 438 tables including
the migration ledger, 1,331 reviewed FKs. No application or production migration
is executed by publication.

## Complete frontend handoff file catalog

All 22 files reside in docs/frontend-handoff within this backend repository;
neither frontend repository is changed. Phase/gap documents retain their approved
historical scope; the current consolidated handoff, generated reference and
OpenAPI are authoritative when later additive contracts apply.

- [`API_MODULE_REFERENCE.md`](frontend-handoff/API_MODULE_REFERENCE.md)
- [`COMPANY_GAP_CLOSURE.md`](frontend-handoff/COMPANY_GAP_CLOSURE.md)
- [`FRONTEND_INTEGRATION_CHECKLIST.md`](frontend-handoff/FRONTEND_INTEGRATION_CHECKLIST.md)
- [`FRONTEND_INTEGRATION_GUIDE.md`](frontend-handoff/FRONTEND_INTEGRATION_GUIDE.md)
- [`FRONTEND_SECURITY_AND_FILES.md`](frontend-handoff/FRONTEND_SECURITY_AND_FILES.md)
- [`FRONTEND_TYPES_AND_STATE.md`](frontend-handoff/FRONTEND_TYPES_AND_STATE.md)
- [`FRONTEND_WORKFLOWS.md`](frontend-handoff/FRONTEND_WORKFLOWS.md)
- [`MESSAGES_MEETINGS_GAP_CLOSURE.md`](frontend-handoff/MESSAGES_MEETINGS_GAP_CLOSURE.md)
- [`PERSONAL_GAP_CLOSURE.md`](frontend-handoff/PERSONAL_GAP_CLOSURE.md)
- [`PLATFORM_ADMIN_API_REFERENCE.md`](frontend-handoff/PLATFORM_ADMIN_API_REFERENCE.md)
- [`PLATFORM_ADMIN_P4.md`](frontend-handoff/PLATFORM_ADMIN_P4.md)
- [`PLATFORM_ADMIN_P5.md`](frontend-handoff/PLATFORM_ADMIN_P5.md)
- [`PLATFORM_ADMIN_P6.md`](frontend-handoff/PLATFORM_ADMIN_P6.md)
- [`PLATFORM_ADMIN_P7.md`](frontend-handoff/PLATFORM_ADMIN_P7.md)
- [`PROJECTS_GAP_CLOSURE.md`](frontend-handoff/PROJECTS_GAP_CLOSURE.md)
- [`SOCIAL_ACTIVITIES_EXPENSES.md`](frontend-handoff/SOCIAL_ACTIVITIES_EXPENSES.md)
- [`SOCIAL_GOALS_CHALLENGES.md`](frontend-handoff/SOCIAL_GOALS_CHALLENGES.md)
- [`SOCIAL_GROUP_CHAT_AND_LEDGER_ACTORS.md`](frontend-handoff/SOCIAL_GROUP_CHAT_AND_LEDGER_ACTORS.md)
- [`SOCIAL_GROUP_EXIT_RECOVERY.md`](frontend-handoff/SOCIAL_GROUP_EXIT_RECOVERY.md)
- [`SOCIAL_LENDING_LOST_FOUND.md`](frontend-handoff/SOCIAL_LENDING_LOST_FOUND.md)
- [`TEAMS_GAP_CLOSURE.md`](frontend-handoff/TEAMS_GAP_CLOSURE.md)
- [`openapi.json`](frontend-handoff/openapi.json)

Additional current backend integration documents:

- [Consolidated backend handoff](platform-admin-backend-handoff.md).
- [22-module readiness matrix](platform-admin-integration-readiness-matrix.md).
- [Canonical final OpenAPI](api/openapi.json).
- [Diagnostics decisions](adr/0081-registration-email-diagnostics.md).

Deployment-only requirements remain controlled target checksum/migration preflight
(including the historical M084 ledger discrepancy), Admin/MFA/key/retention-policy
provisioning, existing durable worker and private storage, Docker/HTTPS/trusted
proxy/private-network validation, live SMTP/Push/trusted inbound/scanner checks,
provider receipt/bounce integration if required, off-host backup/physical restore
and deletion-replay drills, capacity/alerts and actual traffic switch. SMTP
acceptance never establishes inbox delivery; unsupported receipt history remains
UNKNOWN. These are not local backend blockers and no deployment/server change
is performed. The existing conditional scanner check remains explicitly skipped.
