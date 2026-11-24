# Platform Admin P1 work record

Continuation verification, 2026-11-24: staging exposed Git normalization of M100's
mixed line endings, which would change its reviewed/applied checksum. The owner
explicitly approved a file-specific `.gitattributes` byte-preservation rule and
three master-spec Markdown whitespace corrections. SQL bytes, exact-byte guards,
existing migration ledgers and the owner's compose.yaml remain unchanged.
Fresh serialized repository tests passed 936/936 in 212 files, exit 0; OpenAPI
check passed, exit 0. The initial parallel repository run had one architecture
timeout (935 passed, exit 1); assertions/timeouts were not changed. Staged-byte
verification and whitespace checks are required before the authorized P1 commit.
This continuation authorizes P1 commit/push, then P2 implementation without P2
commit/push; historical P1-only authorization statements below describe prior work.

Batch: Platform Admin P1. Status: COMPLETE for local development — acceptance recommended after final complete-suite verification.
Updated: 2026-11-24. P0 remains `651b0ecdf30e4a59215ad7aa8d56b5b4b4942026`, pushed to origin/main.
P1 is uncommitted and unstaged. No production migration, deployment, P2 work or subagents.

## Implemented endpoint inventory

All paths are relative to `/api/v1/admin/`. P0 authentication/session routes remain unchanged.

| Method | Path                               | Permission after `admin.`      |
| ------ | ---------------------------------- | ------------------------------ |
| GET    | dashboard                          | dashboard.read                 |
| GET    | dashboard/export                   | dashboard.export               |
| GET    | users                              | users.read                     |
| GET    | users/{id}                         | users.read                     |
| PATCH  | users/{id}                         | users.update                   |
| POST   | users/{id}/suspend                 | users.suspend                  |
| POST   | users/{id}/reactivate              | users.reactivate               |
| POST   | users/{id}/verify-email            | users.verify_email             |
| POST   | users/{id}/revoke-sessions         | users.sessions.revoke          |
| POST   | users/{id}/recovery                | users.recovery_initiate        |
| POST   | users/bulk/preview                 | users.bulk_manage              |
| POST   | users/bulk/execute                 | users.bulk_manage              |
| GET    | workspaces                         | workspaces.read                |
| POST   | workspaces                         | workspaces.create              |
| GET    | workspaces/{id}                    | workspaces.read                |
| PATCH  | workspaces/{id}                    | workspaces.update              |
| POST   | workspaces/{id}/suspend            | workspaces.suspend             |
| POST   | workspaces/{id}/reactivate         | workspaces.reactivate          |
| POST   | workspaces/{id}/owner-transfers    | workspaces.transfer_owner      |
| GET    | workspaces/{id}/memberships        | memberships.read               |
| GET    | users/{id}/memberships             | memberships.read               |
| POST   | workspaces/{id}/memberships        | memberships.add                |
| POST   | workspaces/{id}/memberships/remove | memberships.remove             |
| PATCH  | workspaces/{id}/memberships/role   | memberships.update_role        |
| GET    | workspaces/{id}/invitations        | memberships.read               |
| POST   | workspaces/{id}/invitations/cancel | memberships.invitations.manage |
| POST   | workspaces/{id}/invitations/resend | memberships.invitations.manage |

Shared Workspace mutations require an ASCII `Idempotency-Key` of 1–128 characters.
Keys bind the Admin identity, explicit capability and exact validated route/target/input.
A changed fingerprint conflicts; a valid retry returns its persisted result after current
session/permission checks. Personal/account mutations retain revision conflict protection.
All mutations require successful server-recorded MFA within five minutes; a new Admin
MFA sign-in renews that proof. No private-content or ordinary impersonation capability exists.

## Role matrix

| Role              | Grants                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| SUPER_ADMIN       | All explicit P1 catalog entries, P0 own-session read/revoke and admin.super                                                           |
| SUPPORT           | P0 own-session; Dashboard read/export; User, Workspace, Membership read; User name update, recovery initiation and session revocation |
| SECURITY_REVIEWER | P0 own-session; Dashboard read/export; User, Workspace, Membership read; User session revocation                                      |
| BILLING_MANAGER   | P0 own-session read/revoke only                                                                                                       |

Unknown roles and unknown capabilities deny, including for SUPER_ADMIN. There is no wildcard.

## Domain and implementation

User/AuthSession/AuthAccount and Better Auth remain identity truth. UserSettings stores
application-owned suspension and administrative revision. Space/SharedCustody own physical
custody; AccessScope and DomainScopeCustody preserve Company child coordinates. ContextAccess
and ContextAccessInterval own membership generations. OWNER is derived from primary custody,
never an assignable role. ContextInvitation and OwnerHandover remain the only invitation and
succession models. Team/Company owner facades perform profile creation and editing.

An attribution-only SharedActor state ADMIN records the actual AdminUser FK. It has no
ordinary User identity or membership. A database trigger rejects using that actor in any
ContextAccess row. Initial owner admission remains an eligible ordinary account; creator
and owner are separate. There is no fabricated owner session or creator attribution.

Creation reuses SharedKernel provisioning, retention checks, feature/security limits and
initial ownership/policy/usage records. Profile edits preserve omitted descriptions and
cannot change type, custody or ownership. Profile revisions are separate from administrative
suspension revisions and custody revisions; GET detail exposes all three.

Adding a member creates a real invitation, not a membership. Recipient acceptance, current
Admin issuer permission, issuer admission generation and Company root/child bindings still
apply. Cancellation clears proofs; resend rotates proofs. Email-only existing invitations
can be resent through the same SMTP adapter. Queued proofs are encrypted with the existing
Better Auth secret and are never returned in Admin responses. Recipient-bound in-app proof
issuance remains available. Removing an owner requires succession; dependency checks retain
active resource allocations, pending resource requests/reviews and unreturned assets.
Membership changes use the existing Personal/User/custody lock order, intervals, usage,
restrictive signatures, delegated-grant invalidation, outbox and replay capture.

Admin handover initiation creates a pending OwnerHandover and does not change ownership.
The successor must remain eligible, explicitly accept and verify their provider password.
Acceptance updates ownership atomically under the original revision/generation checks.
The ordinary successor is the accepting actor; completion audit does not pretend that
an Admin executed the acceptance. Both owners receive post-commit notices.

## Suspension and security

Effective suspension means suspendedAt exists and expiry is absent or strictly after now.
At expiry access resumes without a worker; revoked sessions never return. Administrative
suspension does not use deletion/lifecycle closure or remove data, ownership or memberships.

Account suspension and session revocation commit together. Provider session creation checks
admission before and after creation; protected sessions, shared commands, Personal fences,
file publication and background authority also recheck. The ordinary profile update now uses
the same Personal fence and rechecks the exact session. An already-fenced mutation can commit
before suspension wins; later work is denied. Owner-account suspension leaves shared custody
available to other eligible members.

Workspace read-only state is enforced in Personal fences, shared capability checks and signed
mutation beginnings. Read capabilities remain available. Company child state is scoped to
AccessScope, never an invented child physical Space. Signed replay includes root and affected
scope administrative state; restored versions cannot serve writes before replay completes.

A valid password sign-in to a suspended account returns the URI-encoded public explanation
in `X-Account-Suspension-Reason`. This header is CORS-exposed and documented; the ordinary error
JSON contract is unchanged. Invalid credentials disclose no suspension information. Internal
Admin notes never enter identity admission, ordinary responses or notifications.

## Dashboard and discovery

Today/7/30/90-day ranges use UTC calendar boundaries; custom intervals are capped at 90 days.
All use `[from,until)`. Current totals are snapshots; registration, growth, invitation creation
and usage trends use the selected interval. ACTIVE users are verified and not effectively
suspended; INACTIVE means unverified and not effectively suspended, not inferred activity.

Workspace totals combine real Personal/independent Team/Company roots and DomainScopeCustody
Team coordinates. Affiliation alone does not create Company ownership. Membership counts
count active admitted seats, not distinct people. Invitation expiry is derived at read time.
Security warnings count denied Admin attempts. Operational warnings count failed Admin
outbox deliveries. Usage is net SharedUsageEntry delta by feature, with no private resources
scanned. Per-metric permissions filter responses. Unsupported per-account/resource projections
and commercial capacity explicitly report unavailable rather than fabricated numbers.

Discovery uses bounded cursor pages and deterministic creation-time/UUID order. User search
supports name/email; Workspace search matches IDs; membership/invitation search matches IDs
and user IDs. Role/status/date filters reflect actual persisted or derived states. Invalid
unused filters reject. CSV is separately authorized, quoted and formula-neutralized, capped
at 1 MiB, and uses a static safe attachment filename and no-store/nosniff headers.

## Delivery, audit and contracts

AdminDelivery is a transactional PostgreSQL outbox swept by the existing pg-boss worker.
SMTP and ordinary provider recovery remain in use. Claims use SKIP LOCKED, a lease, bounded
retry/backoff and lease takeover. Delivery is at least once; it never controls account-state
enforcement. Recovery observes the actual SMTP promise even when the provider intentionally
hides public delivery failures. Reset links/tokens are never returned to Admin. Email-bound
invitation jobs recheck state, expiry, proof hash and recipient binding before delivery.
`INVITATION_ACCEPT_URL` must be configured for invitation email; otherwise jobs remain
retryable and eventually report failure. Retain BETTER_AUTH_SECRET through delivery/MFA
recovery; rotating it requires the existing operational key procedure.

`ADMIN_BULK_MAX` is configurable from 1 to 100, default 25. Previews persist for five minutes,
bind exact distinct targets and observed revisions, require explicit confirmation, and report
per-target outcomes. Successful target receipts replay without repeated mutations/notices.
Current permission, MFA and configured maximum are rechecked. No bulk deletion or MFA bypass.

Mutation/export registry keys are audit actions; bulk uses BULK_suspend/BULK_reactivate.
Shared domain audit/outbox actions retain their existing operation names. Administrative
attempts and denied/failed outcomes retain request, actor, target and capability evidence.
Successful changes and safe before/after metadata commit with audit and delivery intent.
ADMIN_HANDOVER_ACCEPTED links the initiating Admin and accepting ordinary user explicitly.
No credentials, proofs, cookies, private work bodies or confidential notes enter public outputs.

All 27 P1 operations have strict exported Zod request/response contracts, runtime success
validation, OpenAPI and synchronized generated frontend handoff. Ordinary API baselines
remain intact. No frontend code was added. The canonical full API contains 1,354 operations.

## Additive migrations

- 202611230095_platform_admin_p1: account/physical Workspace suspension, revisions,
  Admin audit metadata and persisted bulk previews/outcomes.
- 202611230096_platform_admin_p1_completion: attribution-only Admin actors and membership
  rejection trigger; child-scope suspension; Admin initiation references; mutation receipts
  and durable delivery intents.
- 202611230097_admin_invitation_delivery: nullable account recipient plus email recipient
  and an at-least-one-recipient CHECK for existing email-only invitations.

Only isolated local PostgreSQL fixtures received these migrations. Historical SQL and
existing application databases were not reset, recreated or migrated. Procedural/constraint
changes have exact-byte review guards; generic unsafe migration rejection remains enabled.

## Company-owned Team custody resolution — 2026-11-24

The owner explicitly approved only `INDEPENDENT_TEAM → COMPANY_OWNED_TEAM` and amended
ADR 0043. Ordinary Team provisioning is reused. Three additive ordinary commands under
`/api/v1/teams/{id}/company-custody/` implement `preview`, `{transferId}/consent` and
`{transferId}/apply`. These are consent-bearing Planner commands, not Admin impersonation.
The 27 Admin operations remain under `/api/v1/admin/*`.

The mapper supports an ordinary-created Team with its one original active Owner and no
additional work, invitation, historical-participant, file, resource or incoming dependency
graph. Source and Company captured retention versions must match. Other graphs reject with
typed eligibility errors and preserve every row. Both owners must already hold current
Company-root and selected Department/Unit admissions. Each owner explicitly approves the
30-minute hashed manifest; the source Owner also explicitly accepts the participant mapping.
Every consent and apply verifies a provider password; consent proof must be under five
minutes old. Root/child role catalogs and generations remain distinct.

Existing owner graph facades hash bounded row keys and payloads in PostgreSQL; work bodies
are never duplicated into the manifest. Apply rechecks the complete manifest after the
existing sorted Personal/account/identity/custody locks. Team ID, scope ID, metadata,
creation identity, historical intervals and evidence are preserved. Original authors become
non-authorizing historical aliases; the consenting scoped Owner receives an explicit new
admission bound to an existing Company-root generation. Only the empty old physical boundary
is retired. `DomainScopeCustody` points at the actual Company Space and Department/Unit.

Preview, consent and completion are audited with the actual ordinary actor. Durable notices
commit with the effects. Source retirement and Company apply use independent signed attempt
IDs; the successful retirement ID is frozen in the transfer receipt. Rollback leaves the
old graph intact, concurrent applies return one result, and a committed receipt can reconcile
a missed terminal append. A pre-transfer backup cannot reconstruct missing consented data:
it remains fenced until a compatible snapshot is restored.

Admin discovery/detail now exposes explicit `companyId` and `parentScopeId`; source profile
editing uses the Team facade and no longer returns the old child-profile blocker. Scoped
suspension, memberships, invitations, role changes and accepted owner handover use the same
domain paths. Domain invitations bind the recipient's exact Company-root generation and
restore generation. Root Company membership never confers Team content admission.

New SQL artifacts are `202611240098_independent_team_company_custody`,
`202611240099_team_company_custody_protocol` and
`202611240100_team_scoped_disposal`. M098's first isolated-test deployed bytes are
preserved (SHA-256 cecd385df2a46b837b1cc50fe0afcf18fa83545436870c82889c5a17b345417f).
M099 completes invitation/policy and retirement retry guards as a forward-only migration.
M100 adds the reviewed P1-only child disposal predicate and retained-history guard.
Its DB-owned clock uses PostgreSQL clock_timestamp with no runtime override.
Only the newly owned integration-test schema replaces that function temporarily
to advance time without rewriting immutable closure/deadline evidence; finally
restores it. No application schema, trigger or constraint is bypassed.
No old migration ledger is repaired and no application/production database is migrated.

Company-to-Company moves, detachment, Company-to-independent moves, Project transfers and
other arbitrary custody changes remain prohibited. Existing fail-closed transfer-disposal
retention safeguards remain; this is not authorization for root-wide disposal of child data.
The child worker now selects scoped jobs and drains only that Team through owner
cleanup facades. It requires a current purge lease and intersects source, captured
Company and current Company retention policies. Active holds/obligations, live
membership and unresolved references block disposal. Transfer aliases and consent
history drain in bounded passes only after an immutable custody witness is saved.
The terminal job and signed lifecycle effect survive removal of the source Team;
a lost post-commit terminal append is reconciled from that effect. Company metadata,
other Teams, sibling tasks and canonical Company actors remain intact.
Administrative read-only state or unavailable ancestry pauses the child worker
without changing the job, deadline or attempt count; reactivation resumes it.
Final complete-suite exits and all applicable local gates passed as recorded below.

## Verification — current custody resolution

Current focused evidence: the four affected integration files passed **81/81**
tests in 122.70 seconds, exit 0, including all **31** Admin Workspace/custody tests.
This covers scoped terminal disposal, unchanged sibling data, a missed terminal
append, read-only pause/resume and an active captured retention hold. The final
complete non-DB run passed **936/936** tests in 212 files, exit 0 (169.56 seconds).
The final complete PostgreSQL run passed **1,231 tests**, with one conditional
live-scanner skip, across all 62 files, **exit 0** (911.92 seconds). Contracts and generated
handoff now contain 1,354 operations and 12,596 resolved references.

The first complete PostgreSQL run exited **1**: 1,226 passed, five failed, one
conditional live-scanner test skipped (62 files, 923.44 seconds). Three old
expectations/fixtures were reconciled with already approved decisions: the Project
direction guard rejects before consent (P1 exception); soft-deleted Task fixtures
must persist restoreUntil; new Social closures use seven days (ADR 0069). No
production deletion rule or stored historical deadline was changed. The two new
worker tests are covered by the fresh 81-test pass and the final full PostgreSQL
run above. Focused retries were not substituted for the final complete-suite exit.

The prior P1 baseline ran 79 selected integration tests successfully. Its full
934-test repository run had one architecture timeout (933 passed); an isolated
retry passed. Those historical results are not substituted for the newly
required complete-suite exit status. Earlier prototype fixture failures were
corrected without weakening assertions or timeouts. Existing PostgreSQL adapter
deprecation warnings are retained in logs and do not determine test success.

Current acceptance: **RECOMMENDED for local Platform Admin P1 acceptance**.
No remaining blocker or additional ADR is required within the approved P1 scope.

| Exact command                | Final result                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| pnpm.cmd config:check        | PASS, exit 0; values withheld                                                                     |
| pnpm.cmd db:generate         | PASS, exit 0                                                                                      |
| pnpm.cmd auth:schema:check   | PASS, exit 0; pinned provider schema matches                                                      |
| pnpm.cmd db:validate         | PASS, exit 0                                                                                      |
| pnpm.cmd build               | PASS, exit 0                                                                                      |
| pnpm.cmd typecheck           | PASS, exit 0                                                                                      |
| pnpm.cmd format:check        | PASS, exit 0; entire repository                                                                   |
| pnpm.cmd lint                | PASS, exit 0; no warnings                                                                         |
| pnpm.cmd architecture        | PASS, exit 0; 745 modules, 5,129 dependencies, no violations                                      |
| pnpm.cmd test --maxWorkers=1 | PASS, exit 0; 936 tests, 212 files                                                                |
| pnpm.cmd openapi:check       | PASS, exit 0; strict schemas and generated handoff synchronized                                   |
| pnpm.cmd test:integration    | PASS, exit 0; 1,231 passed, one conditional skip, all 62 files                                    |
| pnpm.cmd db:migrations:check | PASS, exit 0; 159.075 seconds; preservation, rollback, repeat deployment, upgrade and FK catalogs |

The final source was frozen during the successful complete runs. The earlier
type-import cycle and old 19-route Team inventory were corrected before these
runs; the route test now checks all 22 handlers against their exact contracts.
No assertion, timeout, required test or migration review guard was weakened.
Only completion/status documentation changed afterward; its format was rechecked.

Retained limits: only eligible one-owner ordinary sources are transferable;
unsupported populated/historical graphs remain intact and ineligible. Existing
general transfer-dependent terminal disposal stays behind its reconciliation fence.
P1 adds no Admin deletion endpoint or root-wide purge of Company child data;
the supported child follows scoped closure, recovery and joint-retention disposal.
Compatible
Company restore keeps the existing scope quarantine until policy reconciliation;
an old independent backup cannot recreate transferred admissions or data.

NOT RUN: E2E (explicitly excluded), production/Docker/deployment verification;
the existing live-clamd smoke is conditionally skipped because CLAMAV_SMOKE_HOST
is not configured. Scanner protocol tests still run; no required test was disabled.
No production readiness is claimed. Historical SQL is preserved; M098's first
isolated-test checksum is retained; M099 and M100 are forward-only, exact-byte reviewed.

Important changed paths include the Team custody owner facade, Spaces transfer
protocol and Company parent-coordinate contract, Admin metadata/profile and
invitation paths, shared status/replay, Prisma/migration review guards, strict
contracts/OpenAPI and focused PostgreSQL/security tests. No dependency or
infrastructure provider was added.

Git: 85 working-tree paths (84 P1 paths plus the preserved owner compose.yaml edit).
All P1 work is unstaged and uncommitted; staged diff is empty and git diff --check passes. HEAD remains
651b0ecdf30e4a59215ad7aa8d56b5b4b4942026. No commit, push or deployment occurred.
Owner compose.yaml SHA-256 remains
C42657021CD05DA9AD7412DD67E675470B8029FFDABCCB4B55035A363623CF20.
The owner master specification receives only the authorized custody/status
reconciliation and meaning-preserving formatting. No unapproved scope deviation,
provider or dependency change occurred. Next eligible batch: Platform Admin P2,
NOT STARTED and not authorized by this P1-only work item. Stop at the P1 boundary.
