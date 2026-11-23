# 0071: Platform Admin P0 boundary

Status: Owner-authorized implementation direction, 2026-11-23, by the explicit
Platform Admin P0 implementation request.

Implement only the independent administrative authentication/RBAC foundation;
use the existing pinned Better Auth provider with separate provider-owned models
and cookies. Platform Admin P0 is not Backend Phase 0. The requested P0–P7 admin
roadmap replaces the earlier V3 Phase 7 scheduling for this work, without
authorizing later admin phases or changing Planner authorization.

Authentication/session additions are confined to the new realm. Existing user
session semantics, private content policy and APIs remain unchanged. The global
admin guard denies undeclared permissions; the only exemption is a closed auth
dispatcher. Operator-only provisioning replaces public registration. TOTP is
mandatory before privileged access; all pre-enrollment sessions are invalidated.
Separate admin audit identity prevents conflating administrators with Planner users.

The owner's undecided commercial strategy supersedes earlier prospective fixed
Workspace pricing language. Record future compatibility requirements without
implementing monetization or changing current free functionality. See
[Platform Admin overview](../../PLATFORM_ADMIN_OVERVIEW.md) for scope and operation.

Owner-requested final verification follow-up: a session creation timestamp alone
cannot prove MFA when a password sign-in overlaps enrollment. Add nullable,
application-owned `AdminSession.mfaVerifiedAt` through additive migration
`202611230094_admin_session_mfa_proof`. Only successful provider TOTP/backup-code
verification records this proof; password sign-in never does. Existing sessions
without proof must complete a new MFA sign-in. Enrollment retains its cutoff and
revocation of previous sessions. Authorization also re-reads the session after
identity loading to reject snapshots revoked during that read. No user auth or
public response schema changes are needed. These are fixes to the authorized P0
MFA and session-revocation guarantees, not later-phase capabilities.
