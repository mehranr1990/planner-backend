# Platform Admin P4 work record

Owner acceptance, 2026-11-26: accepted for local development after reviewing the
documented final gate logs and affected reruns, the implementation diff and exact
M116–M118 SHA256 values. All 142 tracked historical migration files match HEAD
byte-for-byte; the owner compose hash matches the baseline below. The owner
authorized publication of only P4 to origin/main and P5 implementation after a
successful push. P5 publication, P6 and deployment are excluded. Earlier status
and authorization paragraphs below describe the implementation checkpoint.

2026-11-26. Status: COMPLETE — LOCAL DEVELOPMENT.
No P4 commit/push, deployment, frontend, E2E, subagent, Guest Access or P5 work.

## Authorization and preserved baseline

The owner authorized completing every P4 production module and final checks
without intermediate approval. P3 `29aed23745ccf4905f2a80298e172d3337e7a738`
and separately accepted Client `0f9ff0a802657b1889851b1203a41e5e2da0c9e0`
were published to origin/main in the prior publication step (verified then with
git ls-remote). This P4 work remains unstaged and uncommitted. No new push occurred.
Owner compose.yaml SHA256 remains
`c42657021cd05da9ad7412dd67e675470b8029ffdabccb4b55035a363623cf20`.
All historical migration bytes/checksums remain unchanged, including:

| Migration | SHA256                                                           |
| --------- | ---------------------------------------------------------------- |
| M113      | 8b5d413ea7513c3f96013f8499641d66d8b2f7101b58a91e165fc028596533cb |
| M114      | 2b38a78f5bf54b23cc2e543df8b844e3ba677cb535f7c8816fc659ad29efa123 |
| M115      | f1afa57517ffad8c02c970149abf69459e8144b8e0f82cc2df3d5c5550eaad84 |

## Production implementation and requirement traceability

All rows below are connected through AppModule, real PostgreSQL and the existing
pg-boss worker. Existing pure policy/inbound functions and their tests are retained.
The [P4 handoff](frontend-handoff/PLATFORM_ADMIN_P4.md) inventories all **36 Admin
and 22 ordinary operations**, exact capabilities, bodies and workflow semantics.
[ADR 0076](adr/0076-platform-admin-p4.md) records engineering defaults.

| Requirement                                                                                                                           | Production owner and persistence                                                                                                     | Acceptance coverage                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1: localized versioned approved templates, safe variables, preview/test                                                              | communications.service.ts; AdminCommunicationTemplate/Target/Recipient                                                               | P4 integration: immutable templates, safe rendering, recipient locale; policy tests                                                                                                     |
| C2: users/filter/Workspace/global audiences, independent sensitive approval, scheduling/cancel                                        | CommunicationsService + Account/Spaces public facades, typed snapshots                                                               | P4: Shared admission/audience, second approver, cancellation, future scheduling, revoked authority                                                                                      |
| C3: preference/quiet-hour/device-aware SMTP, in-app and Push; durable bounded retries, dedup/reporting                                | EngagementDelivery + existing channel transport, committed claims, pg-boss worker, P4 preferences                                    | P4: preferences, NO_VALID_DEVICE, concurrent workers, retry and uncertain acceptance; existing notification regressions                                                                 |
| S1: registered-user tickets including unverified in-app, authorized metadata, queues/manual assignment, lifecycle/reopen/feedback/SLA | support.service.ts, owner context facade, SupportQueue/Ticket/Reply/CaseEvent/Notice                                                 | P4: realm/owner isolation, revision/idempotency, internal-note omission, assignment/window/SLA tests                                                                                    |
| S2: secure provider-independent inbound replies and real adapters                                                                     | existing SupportInboundProcessor/AtomicSupportInboundStore + PostgresSupportInbound/EngagementEvidence                               | P4: authenticated fixture, sender/token/current-email binding, replay/concurrent dedup/rates/atomic rollback; inbound unit tests                                                        |
| S3: private scanned evidence and retention                                                                                            | EngagementEvidence + StoragePort; metadata-before-bytes/staged disposal/reference protection                                         | P4: scan/download foreign denial, rollback/disposal; storage regressions and restore file verification integration                                                                      |
| M1: typed source reports and exact case-bound authorized content                                                                      | moderation.service.ts + Tasks/Notes/Messaging/Spaces public facades, transaction-bound reported-content proof                        | P4: exact item only, no fabricated membership, foreign/closed source denial, mandatory audited access                                                                                   |
| M2: manual penalties and history, public/private outcomes, independent appeals                                                        | ModerationCase/CaseEvent, separate P1 suspension and P2 security permissions/notices                                                 | P4: bounded restriction, self-review denial, independent appeals, denied inherited suspension, real P1 session revocation/notice, P2 escalation inbox                                   |
| X1: explicit RBAC, persisted recent MFA, Origin/strict schemas, attempts/outcomes and safe audit                                      | Engagement controllers/application services + existing AdminCommand receipts/audit                                                   | P4: expired MFA, foreign Origin, ordinary/Admin isolation, strong response contracts; P0–P3 regressions                                                                                 |
| X2: Personal portability/closure/erasure, restore and cleanup                                                                         | EngagementData owner projection and exact evidence manifest; existing Personal ZIP, LifecycleRepository and trusted operator restore | P4: real composed export including private evidence bytes, internal-note/token exclusion, hash/foreign/deleted denial, disposal; Personal lifecycle and P2 security/privacy regressions |
| X3: safe configurable retention                                                                                                       | EngagementPolicies, existing durable Admin mutation receipts; sensitive preview/publish                                              | P4: impact counts, exact candidate drift, actor/expiry/revision/value binding, acknowledgement, replay and audit                                                                        |

Support sees only tickets, authorized metadata and user-provided evidence. Ticket
reassignment is manual. Moderation reads only the exact reported source and linked
case evidence through explicit capability, recent MFA and mandatory audit. Appeals
require a different authorized operator throughout review. Existing P0–P3 behavior
and Client APIs are preserved; the stable global Task report reference is explicitly
recognized by the existing consented transfer registry without exposing case data.

Communications claim external work durably before network I/O. Unknown acceptance
is AMBIGUOUS and not resent; explicitly retryable rejection is bounded. Push uses
existing registered subscriptions and a generic safe inbox hint. Test sends target
only the initiating operator. SMTP acceptance is not proof of receipt or reading.

Inbound transport/domain remain null and disabled in the production composition.
Concrete PostgreSQL/private-storage processing is exercised with authenticated
fixtures. Sender verification, exact current verified email, revocable hashed
correlation, message dedup/fingerprint, replay time, limits, scanning, audit and
loop prevention are implemented. No invented provider, live inbound activation or
successful live email delivery is claimed. Required trusted-provider/mailbox setup
and deployment verification are in the separate
[inbound deployment runbook](runbooks/support-inbound-email.md).

## Additive database changes

M116–M118 add 16 tables and 43 FKs. Schema total: 397 tables and 1,249 reviewed FKs.
Frozen migration registry: tooling/testing/reviewed-admin-p4-migration.ts.

| Migration                    | SHA256                                                           |
| ---------------------------- | ---------------------------------------------------------------- |
| M116 platform_admin_p4       | 3118358bb1cada13f77f35b33d2ff99de861c57befcb594a57b834368b0be71a |
| M117 p4_delivery_preferences | 08a17230fe9cdd043dce1fe6932e3c20b7ae4ae7f5af4e669a2cf4bd10aca557 |
| M118 p4_audience_scope       | ec12f0821e8025f07d6e380badec84701d7a45abc99db63d0485382a6bb6608b |

Canonical FK catalog SHA256:
`1c9526945ea43445b056b84a1280f2f8e229129d7ed2068c6fcbc9417240bb7c`.
M116 owns queues/tickets/replies, campaigns/templates/recipients, cases/events,
evidence, receipts/rates/notices/policy. M117 adds delivery state/type preferences;
M118 adds independent audience targets and same-Space logical context references.
All were applied only to isolated test schemas. Populated upgrade preserves 380
predecessor datasets, 141 historical checksums and existing constraints, with
three interrupted rollbacks, resume and repeat deployment. No schema push/reset,
production migration or historical SQL rewrite occurred. Prisma generated only
when schema inputs changed; frozen checksums and successful prior rehearsals reused.

## Actual final verification evidence

Commands run from the repository root. Logs are excluded local .tools artifacts;
this table retains the reviewable outcomes without committing temporary files.

| Command/check                                                                                                                                                                                                | Actual result                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pnpm.cmd config:check                                                                                                                                                                                        | PASS, exit 0                                                                                                                                                  |
| pnpm.cmd auth:schema:check                                                                                                                                                                                   | PASS, exit 0                                                                                                                                                  |
| pnpm.cmd db:validate                                                                                                                                                                                         | PASS, exit 0                                                                                                                                                  |
| pnpm.cmd build                                                                                                                                                                                               | PASS full workspace; final affected API build also PASS                                                                                                       |
| pnpm.cmd typecheck                                                                                                                                                                                           | PASS full checkpoint and final affected typecheck, exit 0                                                                                                     |
| pnpm.cmd test --maxWorkers=1                                                                                                                                                                                 | PASS: 999 tests / 229 files, exit 0                                                                                                                           |
| pnpm.cmd test:integration                                                                                                                                                                                    | Full checkpoint: 1,301 passed, 5 failed, 1 conditional skip / 65 files; all five failures addressed by affected reruns below                                  |
| pnpm.cmd db:migrations:check                                                                                                                                                                                 | PASS full gate, exit 0; historical rehearsals plus P4 preservation/rollback/resume/repeat and exact catalog                                                   |
| pnpm.cmd test:integration apps/api/test/integration/platform-admin-engagement.spec.ts --maxWorkers=1                                                                                                         | PASS: 27 tests / 1 file, exit 0; real ZIP bytes, concurrent retention publish, impact preview and security boundaries                                         |
| pnpm.cmd test:integration apps/api/test/integration/personal-lifecycle.spec.ts apps/api/test/integration/platform-admin-security-audit.spec.ts --maxWorkers=1                                                | PASS: 30 tests / 2 files, exit 0                                                                                                                              |
| pnpm.cmd test:integration apps/api/test/integration/platform-admin-engagement.spec.ts apps/api/test/integration/project-collaboration.spec.ts                                                                | PASS: 56 tests / 2 files, exit 0; includes new stable case-reference transfer regression                                                                      |
| pnpm.cmd test:integration apps/api/test/integration/platform-admin-engagement.spec.ts apps/api/test/integration/meetings.spec.ts -t "creates registered-user tickets\|creates private personal action tasks" | PASS: 2 tests, exit 0; 67 intentionally unselected, not a disabled test                                                                                       |
| pnpm.cmd test:integration apps/api/test/integration/personal-completion.spec.ts apps/api/test/integration/platform-admin-engagement.spec.ts                                                                  | PASS: 35 tests / 2 files, exit 0                                                                                                                              |
| pnpm.cmd lint; pnpm.cmd architecture; pnpm.cmd format:check                                                                                                                                                  | PASS final full lint and architecture, exit 0; initial findings fixed; final formatting verified after documentation                                          |
| OpenAPI generate/check + compatibility                                                                                                                                                                       | PASS generate/check, exit 0; 1,470 operations and 13,513 resolved references; 114 affected policy/contract/architecture/compatibility tests passed / 26 files |
| git diff --check; owner compose hash; historical SQL diff                                                                                                                                                    | PASS; exact owner hash and no historical migration diff                                                                                                       |

Full integration failures were: exact new incoming Task FK missing from the safe
transfer registry (Project and Meeting), unverified private-source report guard,
security escalation route dispatch, and one concurrent notification read/dismiss 500. The first four were fixed and passed the affected regression selections/files.
The notification failure did not reproduce: its entire unchanged file passed in
the final 35-test P4/notification bridge run. No test was weakened/removed/skipped to
obtain a pass. The full 18-minute suite was not repeated after successful affected
reruns, following AGENTS section 16. Initial formatter/lint/type errors were also
fixed and checked at the affected gates. Existing pg-driver concurrent-query
deprecation warnings are non-blocking and do not claim pg9 compatibility.

NOT RUN: E2E/frontend/deployment, production migrations, live inbound/SMTP/Push
provider delivery, Docker/TLS/proxy/off-host restore release drills. These are
excluded from this local task or require verified deployment infrastructure.
The one existing live-ClamAV conditional test is skipped without a live scanner
endpoint; deterministic scanner/security and private-storage tests passed.

## Remaining work and boundary

All implementation and mandatory local acceptance checklists are complete. No
blocking requirement or unapproved deviation remains. The optional live-scanner
skip and deployment-only checks above remain explicit. Sensitive broadcasts need
independent approval; inbound activation still needs verified deployment transport.

Files/modules changed: admin-engagement (application, PostgreSQL, evidence, inbound,
controllers, durable worker, public lifecycle), narrow Account/Spaces/Tasks/Notes/
Messaging/Notifications owner facades, existing Admin/Personal lifecycle/storage
and trusted restore wiring, API contracts/OpenAPI/handoff, additive Prisma SQL and
reviewed migration/catalog checks, P4 unit/integration/security regressions. Existing
Client behavior is unchanged. Generated Prisma/OpenAPI artifacts were refreshed
only after their inputs changed. There are no new libraries or live providers.

Git: main remains at the already published Client commit 0f9ff0a. P4 changes are
unstaged and uncommitted; compose.yaml is the preserved owner modification. No
commit, push, deployment, secrets/config publication or historical SQL edit occurred.
Temporary artifacts and local evidence remain excluded under .tools.
Next eligible phase: P5 — NOT STARTED and not authorized by this task. Any P4
commit/push also requires separate owner approval; this completion does not grant it.

Final affected contract command:

`pnpm.cmd exec vitest run --project unit --project contract --project architecture
--project compatibility packages/api-contracts/src/admin-engagement.spec.ts
apps/api/src/platform/admin/p4-policy.spec.ts
apps/api/src/platform/admin/support-inbound.spec.ts
apps/api/src/platform/admin/support-inbound-store.spec.ts
tooling/architecture-tests/admin-p4-migration.spec.ts tooling/compatibility
--maxWorkers=1`: PASS, 114 tests / 26 files, exit 0.

Final acceptance logs: .tools/p4-final-gates.tsv (original full checkpoint),
.tools/p4-gate-test.log, .tools/p4-gate-test-integration.log,
.tools/p4-gate-db-migrations-check.log, .tools/p4-close-gates.tsv,
.tools/p4-close-p4-integration.log, .tools/p4-close-export-integration.log,
.tools/p4-final-affected-integration.log,
.tools/p4-final-security-transfer-regressions.log,
.tools/p4-final-notification-bridge-regressions.log and final closure log/status.
These local logs are excluded artifacts; the actual outcomes are retained above.
