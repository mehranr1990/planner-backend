# Consolidated Platform Admin backend handoff: P0–P7

2026-11-27. P0-P7 are accepted for local development and published. P7 commit
`9b2d7768265fe6444be17cd4d2695fbaa798237c` was pushed and verified on origin/main.
The final Backend Integration Readiness batch adds CB-INV-1 and the narrow Admin
retention-catalog adapter; its 32 approved files were accepted and published as
`3b1e19bc59b58e4f60c5cce14749d0091b4c7f6e`, verified on origin/main.
The final Registration Diagnostics and System Email Delivery Logs batch extends
modules 03/13. The owner accepted local development and authorized publication
after review of the final evidence. This revision contains the synchronized final
OpenAPI, generated reference, consolidated handoff and 22-module matrix.
This handoff reuses unchanged phase evidence. It is not production or live frontend
acceptance.

The [22-module readiness matrix](platform-admin-integration-readiness-matrix.md)
reconciles every frontend gap G-01 through G-20. The generated
[complete Admin API reference](frontend-handoff/PLATFORM_ADMIN_API_REFERENCE.md)
maps every current Admin method/path, operation ID, capability and eligible role,
with exact closed role capability sets. Shared policy/configuration operations
are mapped to each applicable module. The synchronized [OpenAPI](api/openapi.json)
and its [frontend mirror](frontend-handoff/openapi.json) define exact wire schemas.

## Requirement coverage and source ownership

| Master Spec module       | Implementation / authority                                                                                              | Contract and retained verification evidence                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 01 Authentication/RBAC   | platform/admin, separate Better Auth realm, default-deny guard, persisted MFA, operator provisioning                    | ADR 0071; ordinary auth compatibility; P6 complete regression baseline                   |
| 02 Dashboard             | admin-management, permission-scoped metadata metrics and bounded CSV                                                    | P1 work record, dashboard unit/PostgreSQL cases                                          |
| 03 Users                 | admin-management plus Account public facade, state/bulk/session controls and observed registration history              | P1/P2 evidence, ADR 0081 and final diagnostics tests                                     |
| 04 Workspaces            | admin-management plus Spaces/Teams/Companies facades, logical child identities                                          | P1 owner-consented custody and suspension matrices; ADRs 0029/0043/0072                  |
| 05 Memberships           | existing ContextAccess/Invitation/Handover, signed admission and user consent                                           | P1 current membership, revocation, transfer and delivery evidence                        |
| 06 Security              | platform/admin, two-person critical approval, recovery, login restrictions and alerts                                   | ADR 0073; P2 security/audit PostgreSQL suite                                             |
| 07 Audit                 | category/sensitive permissions, immutable detached evidence, filter and CSV, reviewed retention                         | P2 work record and migration evidence; later control-plane regressions                   |
| 08 Privacy/Retention     | admin-management and existing account/shared lifecycle, ZIP export, dependency review, tombstone replay                 | P2 work record; Personal lifecycle regressions; P7 event portability/erasure integration |
| 09 Health                | platform/operations, real dependencies, counters, safe repairs and incidents                                            | P3 work record and operational PostgreSQL regressions                                    |
| 10 Jobs                  | existing pg-boss plus operations job allowlist, bounded state/retry/cancel/schedules                                    | P3 work record; normal durable worker retained through P7                                |
| 11 Storage               | existing StoragePort/private volume, usage/quota/orphan review, dedicated Super Admin file exception                    | P3 source-owner streaming/scanner/custody tests; no generic content browsing             |
| 12 Backup/Restore        | P3 operator console and approved adapters, signed controls, two-person restore and deletion replay                      | P3 local rehearsal/offline evidence; physical deployment drills remain below             |
| 13 Communications        | admin-engagement templates/campaigns plus source-owned unified system email metadata and safe retry                     | P4 evidence, ADR 0081 and final diagnostics tests                                        |
| 14 Support               | admin-engagement, user-supplied ticket material, queue/SLA/replies/internal-note separation, verified inbound boundary  | P4 work record and current contract; trusted inbound activation deferred                 |
| 15 Moderation            | admin-engagement, exact case-resource disclosure, audited decisions, different-reviewer appeals                         | P4 report/content/access/appeal and retention tests                                      |
| 16 Plans                 | admin-commerce, dynamic versioned catalog/allowances/prices/add-ons/overrides                                           | ADR 0077; P5 catalog and effective-entitlement tests; enforcement remains off            |
| 17 Subscriptions         | admin-commerce, scope-bound subscriptions, immutable terms/shifts/closures and notices                                  | P5 29-case suite and populated M119–M121 upgrades                                        |
| 18 Billing               | admin-commerce, exact monetary ledger, corrections/document versions, manual payments/refunds/credit/promotions         | P5 financial/concurrency history; P7 reuses this calculation owner                       |
| 19 Feature Flags         | platform/configuration, typed targeting, stable rollout, preview/publish/rollback/kill                                  | ADR 0078; P6 24-case PostgreSQL suite and immutable M122/M123                            |
| 20 Product Configuration | platform/configuration, allowlisted values with actual request/domain/file/job enforcement                              | P6 runtime, concurrency and ordinary contract regression evidence                        |
| 21 Platform Settings     | platform/configuration plus P3 independent control/recovery, three maintenance modes and readiness-gated schedules      | P6 offline built operator smoke and full regressions; no countdown-based release         |
| 22 Product Analytics     | admin-analytics, transactional metadata, cohorts/KPIs/funnels, owner-facade financial/flag reporting, reports/retention | ADR 0079; P7 work record and final acceptance evidence                                   |

The reused local baselines are P1 936 repository / 1,231 PostgreSQL cases; P2 944 /
1,251 with documented affected corrections; P3 952 / 1,272 with documented affected
corrections; P4 999 repository plus complete checkpoint/affected PostgreSQL results;
P5 1,008 repository and its corrected runtime/scope suites. The final P6 complete
runs passed 1,018 repository and 1,362 PostgreSQL cases, superseding the older
baseline for shared functionality. Each record states the conditional live scanner
skip and actual command outcomes; no failed checkpoint is described as passing.

## API and frontend integration

All Admin APIs use `/api/v1/admin/*`. Authoritative operation/response/permission
definitions are the exported `admin*Routes` and generated
[OpenAPI](api/openapi.json), mirrored to [frontend handoff](frontend-handoff/openapi.json).
P1/P2/P3 work records contain full route inventories; P4/P5/P6/P7 have dedicated
frontend handoffs. Build the future Admin application against these contracts,
including current session/MFA, Origin, revisions, idempotency keys and bounded
pagination. Do not infer permissions from menu visibility or a Planner session.

Ordinary APIs remain under their established namespaces: account ZIP/export/deletion,
user-owned support/moderation, Workspace commercial catalog/history/renew/cancel,
authorized effective configuration and public maintenance status. P7 adds only the
authenticated allowlisted navigation-collection route. Existing Planner contracts
remain protected by compatibility snapshots; no frontend integration is implemented.

Render distinct approvals and impact previews as actual server workflows. P1
ownership succession still requires successor acceptance and reauthentication;
Admin authority cannot replace ordinary consent. Read-only/suspension, custody,
retention, restore and entitlement fences remain separate. Maintenance estimates
are advisory. No Guest or global test mode exists.

Analytics frontend requirements are detailed in [P7 handoff](frontend-handoff/PLATFORM_ADMIN_P7.md):
null/suppressed values, explicit denominators, UTC boundaries/coverage, current
flag/plan cohort labels, currency panels with integer strings, report polling,
artifact expiry and schedule cancellation. Do not present correlation as an A/B
experiment or historical MRR as available. No private-content analytics UI exists.

## Roles and permissions

`SUPER_ADMIN` receives the explicit closed Admin capability catalog; it is not a
wildcard for ordinary work content. `SUPPORT` has approved account metadata/control
and ticket rights; `SECURITY_REVIEWER` has security and exact moderation-case rights;
`BILLING_MANAGER` has billing/subscription and P7 financial-analytics read rights.
Product analytics/configuration/export/sensitive reads default to Super Admin only.
The exact current mapping is `platform/admin/admin-policy.ts` and route permission
metadata. Ordinary Space/Workspace roles and commercial entitlements are independent.

The only expanded default private-content rights remain the audited, dedicated P3
Super Admin file capability and P4 exact reported-item capability. Support sees only
user-supplied case content. Analytics and financial reports expose bounded aggregates.

## Runtime and release dependencies

Keep the pinned NestJS/TypeScript/Prisma/Better Auth/Zod/Vitest stack, local Windows
PostgreSQL development and future self-hosted Docker Compose. No new dependency,
hosted database, Redis, paid analytics service or financial provider is introduced.
API and existing worker use PostgreSQL/pg-boss, private StoragePort volumes, SMTP
and implemented Push adapters. Admin/operator setup, MFA, trusted origins/proxy
settings, signed independent controls, encryption/evidence keys and retention
policy provisioning follow the existing operational runbook. Do not publish keys.

Migrations are controlled one-off deployment work, never startup schema mutation.
P7 adds M124-M128; P0–P6 bytes/checksums and owner compose are preserved. Diagnostics adds M129/M130; the current
metadata FK catalog is 1,331 references; source erasure invalidates cached analytics
and P2 export/deletion includes the user's analytics metadata. Restore replay must
complete before privacy quarantine is released. Finances and audit history retain
their separate approved policies.

Deployment-only verification remains: Docker image/start/persistence/non-root and
private network, real HTTPS/proxy/firewall and production origins, live SMTP/Push/
trusted inbound/scanner, key custody and signed operator provisioning, off-host
encrypted PostgreSQL+file backups and physical restore/deletion replay drills,
production migration checksum preflight, capacity/alerts and actual traffic switch.
The existing P3 record's historical M084 local test-ledger discrepancy is not repaired
by rewriting migration bytes; preflight must reconcile target environment history.
No deployment, live charging, external delivery or production readiness is claimed.

## Contract limits

The owner-approved custody direction and unsafe-graph rejection limits in ADR 0043
remain intentional. Unsupported transfer directions are not silently enabled.
Financial history supports current snapshot MRR/ARR, not reconstructed historical
MRR or FX. Analytics supports only captured allowlisted events and retained evidence;
older distinct cohorts cannot be fabricated from summed daily counts. Live inbound
transport activation and physical backup operation depend on deployment provisioning.
These are explicit contract/release limits, not invented completed capabilities.

## Final verification and publication state

P7 is COMPLETE - LOCAL DEVELOPMENT. Full checkpoints passed 1,034 repository
and 1,376 runnable PostgreSQL cases, with one conditional live-scanner skip.
Final affected checks passed 104 current repository/compatibility cases and 87
PostgreSQL cases, followed by all 20 current P7 PostgreSQL cases. Current build,
type, lint, architecture, formatting, provider/Prisma and OpenAPI gates passed;
complete migration history and final populated M124-M128 upgrades passed.
[The P7 record](platform-admin-p7-work-record.md) contains exact commands, frozen
checksums, corrections, evidence reuse and exclusions.

PRODUCT (default) and FINANCIAL reports share the durable private inbox. Creation,
execution and download require export plus the corresponding product/financial
read capability; sensitive product filters require their additional capability.
Financial CSV separates currency and exact signed values. P5 remains the money
calculation owner. P6's public facade owns flag resolution. A shared privacy fence
keeps ordinary mutations available while consistent report snapshots execute;
concurrent consumers use bounded transaction retries without duplicate artifacts.

No unresolved approved local P0-P7 backend requirement was identified. The readiness
review closes the two additive contract gaps described below. Optional prototype
controls and unavailable projections are classified explicitly in the matrix;
frontend Live integration and deployment checks remain pending. P7 is published;
readiness is published and Diagnostics publication is owner-approved. Owner compose and all 155
published migration files are byte-for-byte preserved.

## Integration contract details

### Authentication, MFA and sessions

Use the separate Admin Better Auth realm under `/api/v1/admin/auth`, not ordinary
Planner login. Cookie prefix is `mehran-admin`, path `/api/v1/admin`, HttpOnly,
SameSite Strict, Secure in production. Send `credentials: include`; never read or
persist session tokens in browser storage. Trusted Origin, credentialed CORS and
explicit trusted proxy addresses are server configuration. No registration route
exists. Initial Admin identities and credentials are provisioned through the
restricted existing CLI; neither frontend creates operators.

Sign in with email/password. Unenrolled operators can enroll through the
allowlisted two-factor enable route with their password, receive the TOTP URI and
backup codes once, then verify TOTP. Enrollment sessions never become privileged:
perform a new sign-in and actual TOTP/backup-code challenge. Backups are secrets,
held only for the immediate user presentation. Ordinary signup, password-reset
and MFA routes cannot substitute for Admin authentication.

Admin sessions expire after one hour. Every protected request rechecks current
active Admin identity, login restrictions, persisted MFA admission and session
existence; revocation is immediate and never reversed by reactivation. Recent MFA
means the persisted verification timestamp is strictly less than five minutes
old and not in the future. P1 writes and sensitive workflows enforce recent MFA;
P5/P6/P7 also require it on reads. Sign-in plus actual challenge refreshes evidence.
No generic client PIN or silent MFA disable is permitted. Controlled MFA recovery
uses independent reviewed identity evidence, distinct operators and fresh
enrollment/sign-in; its target cannot approve their own recovery.

`GET /admin/session` returns exactly ID, role and expiry. Use own list/revoke/
revoke-other-sessions operations as documented. Clear realm-scoped query caches,
in-memory keys and sensitive views on 401, logout or identity change. A revoked
session must not resume an optimistic mutation. Backend permissions, target
authority, commercial entitlement and current state are rechecked even when a
menu or cached capability list permits an action.

The exact capability sets are generated from `adminRolePermissions` in the API
reference. SUPER_ADMIN has the enumerated closed catalog, not an ordinary content
wildcard. SUPPORT includes ticket read/reply/assign and specific user assistance;
SECURITY_REVIEWER includes exact moderation-case content and security/audit rights;
BILLING_MANAGER includes the explicit commercial rights and financial analytics
read, without product analytics/export/configuration. No MODERATOR role exists.
Unknown capability names deny; provisional frontend aliases must be replaced.

### Headers, revisions, idempotency and errors

Business URLs already include `/api/v1`; add it once. Send JSON content type for
JSON commands and the exact body/query schema. Unknown keys and unused filters
reject. Supply a trusted `Origin` on mutations. Optional `X-Request-Id` and
`X-Correlation-Id` must meet the existing validated ID contract; preserve response
IDs for support. Responses use no-store, nosniff and the established security
headers. Request logging/redaction must never capture credentials or private data.

Admin mutations require `Idempotency-Key` where declared, including P7 analytical
POST queries. Keep one key for the same intended request and payload; a different
payload with a reused key conflicts. Do not automatically retry mutations or
generate a new key after an ambiguous timeout. Poll/reload the authoritative
result or retry the same idempotent request under the documented operation rules.
Authentication/provider routes use their own allowlisted state machine and must
not receive invented business idempotency/revision fields.

Admin command revisions are normally explicit body fields, not `If-Match`.
Read current state, present impact/reason, submit the current revision and handle
conflict by reloading. Preview fingerprints, captured target generations, expiry
and distinct-approver requirements are additional fences, not substitutes for
revisions. Bulk retries require new previews for the failed targets. Ordinary
resource APIs retain their existing `ETag`/`If-Match` contracts where declared;
do not mechanically translate body revisions into headers. Invitation mark-read
requires neither revision nor idempotency key and does not change offer revision;
proof/accept/decline preserve their existing proof/revision rules.

P1 directory pagination is opaque `cursor`, default limit 25, maximum 100,
deterministic creation-time/UUID ordering, and `{items,nextCursor}`. A page can be
empty with a continuation. P3-P7 families generally use `after` UUID positions
and bounded limits where their schemas declare them; some lists are explicitly
bounded inboxes with no cursor. Recipient invitation feeds use `after` opaque
recipient/kind-bound cursors. Reapply the same filters and discard cursors after
identity/filter/authority changes. Never synthesize totals from loaded pages.
UTC `[from,until)` ranges, bounds, sorts and allowed filters are operation-specific;
P1 custom dashboard ranges cap at 90 days. ACTIVE User means verified and not
effectively suspended, not evidence of recent activity.

The standard error envelope is `{error:{code,message,requestId,details?}}`.
Validation details are safe path/code entries. Handle 400/422 validation, 401
authentication, 403 denied, 404 unavailable/not found, 409 conflict, 413 payload,
415 media, 429 throttling, 500 unexpected and 503 maintenance/unavailable.
Use actual status codes rather than an assumed universal 412 revision response.
The exception filter sanitizes internal messages and unknown domain codes;
frontend must not require a distinct MFA-versus-permission reason on every 403.
Honor `Retry-After` and exposed RateLimit headers. Stream downloads/CSV according
to their media type; do not parse a binary or 204 response as JSON.

### Readiness additions and ordinary API boundaries

`GET /api/v1/invitation-notifications/unread-count` accepts no query fields and
requires a verified ordinary recipient session plus the existing Shared guard.
Response:

```json
{
  "total": 0,
  "byKind": {
    "PROJECT": 0,
    "TEAM": 0,
    "COMPANY": 0,
    "CONVERSATION": 0,
    "MEETING": 0,
    "SOCIAL_GROUP": 0
  }
}
```

Each count covers all currently authorized pending unread offers, with expiry,
issuer/source generations, contact checks and IN_APP preferences reapplied by
the owning module. Read/proof/admission/revoke/expiry/preference changes invalidate
the badge; poll/refetch after them. Counts reveal no resource IDs or addresses.
Existing invitation APIs remain unchanged. No persisted parallel unread counter,
pagination parameter or external recipient selector exists. Concurrent commits
can change later reads; no transaction spanning all owning-module reads is promised.

`GET /api/v1/admin/workspaces/retention-policies?context=TEAM|COMPANY` requires
`admin.workspaces.create`. It returns the existing `{items}` catalog, capped at
200 applicable safe summaries; use the returned version in workspace creation.
It shares the Spaces catalog parser and excludes malformed/inapplicable policies,
holds, obligations and operator references. It does not create or activate policies.
Ordinary `/retention-policies` retains its verified ordinary-session contract.

Ordinary P4 routes include owner-scoped support tickets/replies/evidence, reported
items/appeals, communications preferences/inbox and support notices; the exact
inventory is in [P4 handoff](frontend-handoff/PLATFORM_ADMIN_P4.md). Ordinary P5
contracts cover authorized scope catalog/entitlements, subscription status and
Owner renewal/cancellation, financial-authorized terms/records, plus the limited
anonymous published pricing catalog. [P5 handoff](frontend-handoff/PLATFORM_ADMIN_P5.md)
defines their independent commercial authority. P6 ordinary effective configuration
requires current Workspace authority; `/platform/maintenance` is public sanitized
status. P7 navigation accepts only its allowlisted page/event fields and current
authorized Workspace; it never accepts private content or arbitrary events.
Regenerate types from OpenAPI, not from examples or guessed route names.

### Financial, content, storage and maintenance boundaries

Keep exact integer minor-unit strings and one ISO currency per financial document.
Never merge currencies, fabricate revenue from grants, multiply current prices
into past revenue, or implement a second revenue ledger. P5 owns verified money,
immutable invoice/payment/refund/credit history and entitlement calculations.
P7 consumes its facade; current MRR/ARR snapshots and gross/net labels must remain
explicit. Commercial enforcement defaults off. Online charging and automatic
monetary retry are inactive; manual methods/refunds are not payment-gateway actions.
Ordinary financial visibility requires current Owner or explicitly granted
financial authority; member entitlement status does not reveal amounts. Company
child Teams have logical customer scopes independent of physical Company custody.

Administrative account suspension, Workspace suspension, retention/legal holds,
custody, commercial entitlement and feature-flag resolution are separate controls.
No flag grants RBAC or entitlements. No quota reduction deletes existing content.
Successor acceptance and reauthentication remain required for ownership handover;
unsupported custody directions fail closed. Privacy deletion/restore replay and
minimum analytics cohorts cannot be bypassed by an Admin export.

Private bytes stay behind StoragePort and authorized downloads, not public paths
or directly mounted proxy volumes. Cleanup requires current preview/protection
checks. Exact P3 Super file access and exact P4 reported-item access are separate
audited exceptions; general metadata, tickets, analytics and billing do not confer
content browsing. Respect scan readiness, hashes, private artifact expiry, current
download permissions and audit on every attempt/outcome. Support internal notes
never appear in ordinary responses or portability exports of another identity.

Maintenance modes are NORMAL, READ_ONLY and FULL. Backend domain/request fences
enforce them; frontend disabled controls alone are insufficient. Wire the public
status and P6 configuration/readiness workflows, translate prototype display
states explicitly, and keep ETA advisory. Reopening requires passing readiness,
fresh authority/approvals where configured and durable schedule checks. The
independent signed operator control path remains available for database failure
and restore recovery; no client-only recovery switch is introduced.

## Final integration action and remaining checks

The Admin frontend must update its `b9746e1` snapshot, generated types, permission
presentation, Live transport and coverage record against the current contracts.
All 22 modules have implemented local backend mappings. Page-specific prototype
controls outside those contracts stay unavailable. No frontend files, browser
tests or E2E were changed/run by this backend batch. Ordinary Client integration
needs only the additive unread-count contract and refreshed types; unrelated
Client fixes are not authorized.

Runtime remains the pinned Node/pnpm/NestJS/Prisma/PostgreSQL stack, existing
pg-boss worker, private files, configured SMTP/Push/scanner and independently
secured control storage. Run the worker for durable deliveries, policy schedules,
aggregation, exports/reports and recovery. Provision approved retention policies,
Admin identities/MFA, trusted origins/proxies and keys through existing runbooks.
No dependency, environment secret or local configuration is added by readiness.
Readiness added no migration. Diagnostics adds M129/M130; all 155 published
predecessor migration files remain frozen. No new dependency or configuration
secret is required.

Deployment-only requirements remain those listed above: production checksum
preflight (including the recorded historical local M084 ledger discrepancy),
controlled migration application, Docker/HTTPS/private-network verification,
real delivery/scanner/inbound activation, off-host backup/physical restore and
deletion-replay drills, key custody, capacity and traffic switch. They are not
backend contract blockers or local test passes. No deployment is performed.
See the [readiness work record](backend-integration-readiness-work-record.md)
for its final exact commands/results and protected-file evidence. Readiness is
published; Diagnostics publication has now received separate owner approval.

Final readiness acceptance, 2026-11-27: COMPLETE - LOCAL DEVELOPMENT.
All 1,038 repository tests passed. All 234 affected PostgreSQL cases passed using
the three unchanged successful suites and the corrected 109-case Messaging rerun.
Build, types, lint, architecture, formatting, OpenAPI and generated handoff checks
passed. Final contract: 1,571 operations, 208 Admin operations, 22 mapped modules.
The readiness work record contains exact commands, initial fixture/style failures,
successful reruns, preserved-file evidence and reused P0-P7 verification. No new
migration or dependency and no unresolved approved backend contract blocker.

## Final registration and system email diagnostics contracts

The final batch extends existing modules 03 and 13; all 22 module mappings and
exact closed role sets are regenerated in the API reference. There is no new
mail provider, queue, worker, role or frontend change. Ordinary Client request and
response contracts are preserved. See [ADR 0081](adr/0081-registration-email-diagnostics.md)
and [the verification record](registration-email-diagnostics-work-record.md).

| Method / path under `/api/v1/admin`              | Permission                        | Role / additional requirements                                                              |
| ------------------------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------- |
| `GET users`, `GET users/:id` (extended existing) | `admin.users.read`                | SUPER_ADMIN, SUPPORT, SECURITY_REVIEWER                                                     |
| `POST users/:id/resend-verification`             | `admin.users.verification.resend` | SUPER_ADMIN, SUPPORT; recent MFA, reason, revision, Idempotency-Key                         |
| `GET system-emails`                              | `admin.email.read`                | SUPER_ADMIN; recent MFA, audited read                                                       |
| `GET system-emails/:id`                          | `admin.email.read`                | SUPER_ADMIN; recent MFA, audited read                                                       |
| `POST system-emails/:id/retry`                   | `admin.email.retry`               | SUPER_ADMIN; recent MFA, reason, Idempotency-Key and action-specific revision/attempt count |

User list filters add `verificationStatus=VERIFIED|UNVERIFIED`,
`loginStatus=RECORDED_SUCCESS|NO_RECORDED_SUCCESS`,
`loginHistory=COMPLETE|PARTIAL|UNKNOWN`; existing `status`, `search`, registration
`from`/`until` and cursor limits remain. Verification and suspension are independent.
Detail `registration` returns registeredAt, verificationStatus, emailVerifiedAt,
verificationDateEvidence, firstSuccessfulLoginAt, firstLoginEvidence,
firstRecordedSuccessfulLoginAt, lastSuccessfulLoginAt, loginStatus, loginHistory
and loginEvidence. `NO_RECORDED_SUCCESS` means no retained recorded evidence; it
must not be displayed as "never signed in" for UNKNOWN/PARTIAL history. For legacy
users, lifetime first login remains null even when retained audit proves an older
successful login. Capture completeness is established only at new registration.
Historical verification dates remain unknown until an actual current-email
transition is observed. Active session counts remain independent metadata.

Mail list accepts `limit` 1-100 (default 25), opaque `cursor`, `category`, `status`,
`sourceKind`, exact `userId`/`resourceId`, escaped literal `search` (recipient/source
ID, max 100, no controls), and UTC creation range `from` inclusive / `until`
exclusive. Unknown creation times remain null and are excluded from dated ranges.
Every owning projection filters before its bound; the merged page uses the existing
actor/filter-bound cursor and has no invented total. Follow nextCursor until null.
Detail IDs identify stable typed source projections, not tokens or admission links.

Safe fields include recipient plus OBSERVED/PLANNED/UNKNOWN evidence, category,
related user/resource, nullable createdAt with evidence, sourceState, status,
attemptCount and observedAttemptCount, firstRecordedAttemptAt,
lastRecordedAttemptAt, lastRecordedCompletionAt, nextAttemptAt, sanitized failureCode
and providerMessageReference. Recorded timestamp/count labels describe retained
observations, not fabricated lifetime history. No raw provider error, body,
password, proof, secret URL, credential or queue payload is returned.

Statuses are QUEUED, PROCESSING, SMTP_ACCEPTED, FAILED, BOUNCED, UNKNOWN, CANCELED
and SINK_ACCEPTED. Only the transport's actual accepted recipient establishes
SMTP_ACCEPTED; it never establishes inbox receipt. Historical SENT without that
evidence is UNKNOWN. Missing SMTP receipt or expired processing evidence remains
UNKNOWN. `inboxDelivery` is always UNKNOWN. BOUNCED is reserved for authoritative
bounce evidence; no authenticated bounce feed is configured by this batch and SMTP
rejection is FAILED, never a fabricated bounce. Sinks are explicit local evidence.

Read returned retryActions; refresh after mutations. Verification/recovery actions
require a current account revision and their existing supplemental account
permission. Responses acknowledge `{action,queuedDeliveryId}`, not delivery.
The existing worker rechecks recipient/state, verification/suspension and operator
authority where required, then generates fresh provider verification/recovery
proofs. Idempotent replay returns the same queued acknowledgement without another
send or rate-limit charge. Verification queueing permits at most three actual
requests per recipient per minute. Existing recovery and ordinary provider limits
remain enforced. Failed plain ACCOUNT_CHANGED/WORKSPACE_CHANGED notices alone
support RETRY_NOTICE with exact attempts; a replacement outbox record preserves
the original attempt history. Invitation, deletion-link and other credential
messages cannot be blindly replayed through this view; use existing owner APIs.

Existing 400/401/403/404/409 sanitized error handling, strict schemas, Admin realm,
Origin policy, five-minute MFA evidence and command audit/idempotency rules apply.
No Admin identity may call ordinary recipient APIs as a user or bypass invitation
preferences, current admission, tenant, commercial or lifecycle boundaries.

M129 records actual registration evidence and adds metadata-only observations;
M130 retains a private pre-commit subject reference so deleting a user erases old
address observations even when signup mail preceded the provider transaction's
commit. That reference confers no authorization and is not exposed unless an
actual User exists. Existing source deletion triggers and User/Admin ownership
cascades apply. Personal portability includes only the owner's safe mail metadata;
erasure removes it. The existing P4 COMMUNICATIONS retentionDays policy, impact
preview and worker sweep expire observations; source queues retain their existing
owner policy. Stale processing is marked UNKNOWN, never automatically replayed.

Run the existing durable pg-boss worker and existing SMTP configuration; migrate
M129/M130 only through the controlled release process. No production migration was
performed here. Live SMTP acceptance/provider receipt behavior, optional trusted
bounce ingestion, real inbox receipt and production retention/restore drills are
operational integration checks, not local successes. Inbox delivery remains
unknown until an authoritative integration exists. Frontend Live wiring and
operator provisioning remain separate; no genuine approved backend contract gap
is deferred to a frontend workaround.

Final diagnostics acceptance, 2026-11-27: **COMPLETE - LOCAL DEVELOPMENT**.
The full checkpoints and successful affected reruns cover 1,042 repository and
1,395 runnable PostgreSQL cases; the conditional live-scanner case remains
skipped. Build/types, official provider schema, Prisma, configuration, architecture,
lint, formatting, exact API/reference compatibility and full migrations through
M130 pass with recorded affected corrections. See the diagnostics work record for
exact original failures and successful reruns; full failed commands are not
relabeled passed. All 212 Admin operations map to 22 modules. No genuine approved
local backend contract blocker remains. Readiness is published as `3b1e19b`;
Diagnostics is accepted and approved for publication in this revision. Live provider/receipt and
production release checks above remain explicit; no production readiness claimed.
