# Platform Admin

Current work status (2026-11-24): P0 is committed as `651b0ec` and pushed to
origin/main. Platform Admin P1 has 27 Admin operations and the newly authorized
ordinary Independent Team → Company-owned Team workflow under ADR 0043.
Local P1 verification is complete; acceptance is recommended. Final complete runs:
936 repository tests and 1,231 PostgreSQL tests passed, both exit 0; one existing
live-clamd smoke is conditionally skipped without CLAMAV_SMOKE_HOST.
See [P1 work record](docs/platform-admin-p1-work-record.md) for implemented endpoints,
permissions, source-model reconciliation, actual gates and retained eligibility limits.
The historical P0 acceptance report below predates this authorization. No P1 commit,
push, deployment or P2 work is authorized.

Owner-authorized scope: Platform Admin P0, 2026-11-23. This is distinct from
Backend Phase 0 (P0-01 through P0-04). The owner's current implementation request
supersedes the older V3 Phase 7 scheduling and fixed Workspace pricing assumptions
for this control plane. Existing security and compatibility guarantees remain binding.

| Phase | Modules                                                 | Dependencies                                                    |
| ----- | ------------------------------------------------------- | --------------------------------------------------------------- |
| P0    | Admin Authentication & RBAC                             | Existing Better Auth, PostgreSQL, API/error/logging conventions |
| P1    | Dashboard, Users, Workspaces, Memberships               | P0 permissions; owner-module public contracts                   |
| P2    | Security, Audit, Privacy & Retention                    | P0 audit; P1 metadata; approved retention policy                |
| P3    | System Health, Jobs, Storage, Backup                    | Existing operations services; restore/release gates             |
| P4    | Email & Push, Support, Moderation                       | Existing delivery services; case-bound disclosure decisions     |
| P5    | Plans, Subscriptions, Billing                           | Approved commercial model, usage ownership, activation gate     |
| P6    | Feature Flags, Product Configuration, Platform Settings | Versioned audited configuration and rollback decisions          |
| P7    | Product Analytics                                       | Privacy-safe aggregate definitions and retention decisions      |

These are the requested 22 modules. P0 and the current P1 completion work are
authorized; P2 remains outside this task's explicit authorization.
No UI, content impersonation, Guest Access, Global Test Mode, commercial paywalls,
entitlement engine, plan, subscription, billing or seat tables are introduced.

## P0 decisions

- Same NestJS process and pinned Better Auth provider; independent AdminUser,
  AdminSession, AdminAccount, AdminVerification and AdminTwoFactor records.
  Admin identities never create Planner users, personal spaces or memberships.
- `/api/v1/admin/*` has a global default-deny guard. Future handlers must declare
  `RequireAdmin(permission)`. Unknown permission strings and roles are denied.
  The explicit auth allowlist is the sole bootstrap exception.
- Fixed roles: SUPER_ADMIN, SUPPORT, BILLING_MANAGER, SECURITY_REVIEWER. P0
  permissions are own-session read/revoke and `admin.super`. Only SUPER_ADMIN
  passes `admin.super`. No role grants workspace/private content capabilities.
  No HTTP role-edit or registration route exists. Future module capabilities
  must be explicitly added; there is no wildcard Super Admin content bypass.
- One-hour DB sessions, five-minute provider freshness, isolated HttpOnly strict
  SameSite cookies scoped to the admin API, Secure in production. Cookie caching
  is disabled; account active state and role are read from PostgreSQL on access.
  Existing origin/CSRF, CORS, trusted proxy, safe errors and redacted Pino apply.
- Password-only sessions permit enrollment, not admin operations. Verified TOTP
  enrollment records a cutoff and revokes all enrollment sessions. Sign in again,
  then complete TOTP or a provider single-use backup code. Older sessions remain
  ineligible. Each session also requires an application-owned `mfaVerifiedAt`
  proof, recorded only after a successful provider second-factor response. This
  rejects password sessions created after the cutoff by an in-flight sign-in
  that read the account before enrollment. Authorization re-reads the session
  after identity loading so a revoked provider snapshot cannot grant access.
  No trust-device or MFA-disable API.
  Secrets/backup codes use the provider's encrypted storage; protect and back up
  BETTER_AUTH_SECRET. Changing it requires a coordinated recovery plan.
- Provider rate limits: 5 sign-ins/minute/IP and 5 MFA requests/minute/IP; generic
  30/minute. Provider MFA account lockout remains enabled. IP budgets are in
  memory, matching existing auth infrastructure; restart resets those counters.
- AdminAuditEvent follows the existing PostgreSQL ATTEMPTED/SUCCEEDED/DENIED/FAILED
  pattern. Separate actor FK is necessary: SecurityAuditEvent references ordinary
  User. No fake Planner user or cross-realm identity is created. Audit stores
  action, outcome, request UUID and optional admin ID, never passwords, TOTP
  secrets, backup codes, cookies or session tokens. Failed anonymous challenges
  may have no actor; request ID provides correlation. No asynchronous jobs needed.

## Provisioning and operations

Review/apply the additive `20261123000000_platform_admin_p0` migration through the
existing controlled migration process, followed by
`202611230094_admin_session_mfa_proof`. Existing admin sessions without the new
proof must complete another MFA sign-in; ordinary user sessions are unaffected.
Application databases were not migrated by
this work. Generate Prisma and build contracts before running provisioning.

Run `node --env-file=.env tooling/scripts/admin-provision.ts` with a JSON object
on stdin containing `email`, `name`, `password` (16–128 characters), and `role`.
Deliver stdin through an operator-controlled secret channel; never put credentials
in shell command history or commit them. There are no default credentials.
Operator access to this command/database is privileged and must be restricted.
Provisioning creates credential/account/audit atomically; duplicate email fails
without changing an existing identity. It never assigns a role from an HTTP body.

First login: POST `/api/v1/admin/auth/sign-in/email`, then
`/two-factor/enable` with password, display the returned TOTP URI and securely
retain backup codes, then `/two-factor/verify-totp`. Sign in again and verify the
new challenge. GET `/api/v1/admin/session` returns only ID, role, expiry.
Session listing/revocation and sign-out use the corresponding allowlisted Better
Auth paths documented in OpenAPI. All writes require a configured trusted Origin.
Use the separate admin cookie jar; ordinary auth cookies confer no admin rights.

Emergency disable is an operator-controlled transaction: set AdminUser.active
false, delete its AdminSession rows, and insert AdminAuditEvent evidence. Do not
delete audit evidence or reset MFA to bypass it. Recovery without backup codes,
admin invitation delivery and in-app role management need a separately approved
security workflow; P0 exposes none of them publicly.

## Deferred commercial decisions and compatibility

All existing features remain free until explicit commercial activation. Future
plans must support configurable Personal/Team/Company eligibility; feature, seat,
usage and hybrid models; shared Team/Company subscriptions; optional add-ons;
custom entitlements/quotas; complimentary, externally paid and manual grants;
permanent, dated and subscription-term overrides. Plan versions and explicit
admin-selected propagation must distinguish existing versus new subscriptions.
P0 encodes none of these choices in its roles, authentication or workspace policy.

Unresolved: final prices, eligibility, quota values, commercial activation,
provider/payment/tax obligations, plan-change/grace semantics, support disclosure,
admin recovery/approval process and production admin frontend origin. Future
phases depend on owner decisions and do not have execution authorization here.
Production readiness also requires TLS/proxy/cookie topology verification, off-host
backups, restore evidence and the repository's existing release gates.

## P0 verification and delivery status

Status: COMPLETE for local development acceptance, verified 2026-11-23.
This is not production deployment or production acceptance. Platform Admin P1 is
NOT STARTED and requires explicit owner approval. No commit, push, deployment,
production account provisioning or application database migration occurred.
The owner's pre-existing compose.yaml modification was preserved byte-for-byte.

### Root cause and final corrections

The Shared limiter implementation correctly consumes Express-resolved request.ip.
The old fixture set this computed property to an arbitrary "spoofed" value while
expecting the socket address. Under the configured resolver, untrusted forwarded
headers cannot set request.ip. The corrected fixture expects the resolved value;
real Express/Supertest regressions verify both socket-only defaults and explicit
trusted-hop resolution, including spoofed forwarded prefixes and internal headers.
The production Shared limiter and proxy allowlist policy were not changed.
ADR 0058 now clarifies the default versus configured proxy behavior.

The security review found an enrollment race beyond the original fixture failure:
a password sign-in could read the old account state, pause, then create a session
after enrollment's timestamp cutoff. AdminSession.mfaVerifiedAt now records proof
only after successful provider second-factor verification. A deterministic test
pauses that password sign-in through enrollment and proves its late session is
still denied. Authorization also re-reads the session after identity loading;
a separate barrier test proves a revoked provider snapshot cannot authorize.
Revocation does not retrospectively cancel requests already authorized before
it commits; subsequent access is denied and reads do not recreate sessions.

The handoff OpenAPI artifact was stale and failed the repository's required
canonical/handoff equality assertion and formatting gate. It was regenerated
from the canonical backend contract and formatted with identical parsed JSON.
This updates generated contract documentation, with no frontend functionality.
The formatting change accounts for most of the artifact's textual diff.

### Final gate results

| Command                                                                    | Result                                                                              |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| pnpm.cmd test --maxWorkers=2                                               | PASS: 926 tests, 208 files; unit, contract, architecture and compatibility projects |
| pnpm.cmd test:integration apps/api/test/integration/platform-admin.spec.ts | PASS: 6 tests, isolated local PostgreSQL                                            |
| pnpm.cmd typecheck                                                         | PASS                                                                                |
| pnpm.cmd lint                                                              | PASS; final changed-test ESLint rerun also passed                                   |
| pnpm.cmd build                                                             | PASS: contracts and API                                                             |
| pnpm.cmd architecture                                                      | PASS: no dependency violations                                                      |
| pnpm.cmd db:validate                                                       | PASS                                                                                |
| pnpm.cmd auth:schema:check                                                 | PASS: ordinary provider-owned auth schema remains compatible                        |
| pnpm.cmd openapi:check                                                     | PASS: reviewed snapshot and existing API compatibility baselines                    |
| pnpm.cmd format:check                                                      | PASS; overview checked again after this report update                               |
| git diff --check                                                           | PASS                                                                                |

Targeted development runs also passed all 45 relevant admin/proxy/limiter unit
checks. The first full run exposed the stale handoff artifact; the final full run
above passes without weakening any assertion. An initial typecheck rejected
Promise.withResolvers in test helpers because the repository targets an older
TypeScript library; the helpers now use ordinary Promise constructors without
changing compiler settings.

The PostgreSQL tests exercise real operator provisioning; denied registration and
MFA disabling; admin-to-user realm isolation; mandatory MFA; encrypted factor
storage; the delayed password/enrollment race; second-factor login; inactive
account denial; session revocation; audit evidence; Origin enforcement;
privilege-field rejection; brute-force throttling; spoofed client-IP header
rejection; production cookie configuration; concurrent backup-code consumption
across independent challenges with exactly one winner; replay rejection; and
concurrent reads/revocations with denial after commit and no resurrection.
Cookie configuration verifies HttpOnly, strict SameSite, admin-only path,
production Secure prefix/attribute, host-only scope and disabled cookie caching.
These configuration checks do not simulate deployed HTTPS or browser behavior.

Both migrations were exercised through the guarded isolated-test harness, with
no reset or destructive schema operation. The second migration only adds a
nullable session proof column; existing admin sessions must reauthenticate.
No new public APIs, domain events, jobs or monetization features were added by
final verification. Ordinary user API/session behavior remains compatible.

### Files and Git state

All P0 changes remain uncommitted (modified tracked files and untracked additions):

- apps/api/src/platform/admin/: provider configuration, policy, service,
  controllers, guard, module, and policy/guard/session-race unit tests.
- apps/api/src/app.module.ts and
  apps/api/test/integration/platform-admin.spec.ts.
- apps/api/src/modules/spaces/application/collaboration-limit.spec.ts:
  corrected fixture and proxy-to-limiter regressions only.
- prisma/schema.prisma and additive migrations
  20261123000000_platform_admin_p0 and 202611230094_admin_session_mfa_proof.
- apps/api/src/platform/database/foundation.spec.ts and
  tooling/compatibility/openapi.spec.ts: explicit migration/operation inventories.
- packages/api-contracts/src/admin.ts, admin-openapi.ts, index.ts and openapi.ts;
  docs/api/openapi.json and docs/frontend-handoff/openapi.json.
- tooling/scripts/admin-provision.ts; docs/adr/0071-platform-admin-p0.md;
  docs/adr/0058-shared-api-rate-limits.md; this overview.
- compose.yaml: existing owner modification, preserved without edits.

### Remaining deployment-only checks

NOT RUN: E2E tests (explicitly excluded), unrelated full integration suites,
Docker startup/persistence and production migration/provisioning/deployment.
These are outside this local verification scope.

Before production release, verify the real proxy peer allowlist, ingress header
append/stripping behavior and network exposure; TLS termination and Secure cookie
issuance; browser cookie/Origin/CORS behavior for the separate admin frontend;
actual process topology and in-memory auth-rate-limit limitations; and existing
backup/key recovery, restore and operational release gates. Multi-host production
race/load/restart claims require that environment's evidence. No production
verification is claimed by the local tests above.

No outstanding P0 development blocker or ADR decision remains. The next action
is owner review of this uncommitted P0 implementation; P1 execution, commit,
push and deployment each remain subject to their existing approval rules.
