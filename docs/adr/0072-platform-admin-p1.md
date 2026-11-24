# 0072: Platform Admin P1 administrative metadata and account controls

Owner-approved custody resolution, 2026-11-24: ADR 0043 now permits only the eligible
ordinary Independent Team → Company-owned Team direction. The consented domain workflow,
historical aliases, scoped Admin metadata/profile/membership controls and signed retirement
receipts resolve the former constructor blocker. General transfers remain deferred.
See the P1 work record for current eligibility and actual final verification status.

Historical completion follow-up, before the custody exception on 2026-11-24:
explicit owner-module Admin boundaries create
Team/Company roots, edit profiles, initiate consented handover and manage supported
memberships/invitations. SharedActor ADMIN is attribution only; a database trigger
forbids membership. Signed effects/replay, durable SMTP/recovery dispatch and strict
P1 response contracts are implemented. At that checkpoint the remaining Company-child runtime
acceptance conflict is ADR 0043's preserved independent-root/transfer deferral,
not a missing Admin impersonation shortcut. See the updated P1 work record for
the operation inventory and current evidence. The exception above supersedes that
constructor blocker; final local gates are recorded in the P1 work record.

Status: Owner-authorized implementation direction, 2026-11-23, with the narrow
owner-approved custody exception on 2026-11-24. Implementation is locally complete;
final full suites and applicable local gates passed. Local P1 acceptance is
recommended; no production readiness, commit or further-phase approval is implied.

The explicit Platform Admin P1 request authorizes Dashboard, Users, Workspaces
and Memberships backend work after P0 is committed and pushed. P1 must remain
uncommitted pending owner approval. No P2–P7 work or deployment is authorized.

The owner explicitly reaffirmed ADR 0029 during this implementation: Admin
ownership transfer initiation never bypasses successor acceptance and fresh
reauthentication. Existing owner-initiated handover remains unchanged. A direct
Admin ownership reassignment endpoint is prohibited.

Keep the P0 realm and four roles. Grant explicit catalog entries; no wildcard
or private-content capability exists. Mutations require the session's persisted
MFA verification timestamp to be within five minutes. A new MFA sign-in renews
this evidence; enrollment alone never qualifies.

Account administrative state belongs to application-owned UserSettings. Better
Auth User.emailVerified remains the sole verification flag. Admin profile editing
currently allowlists name only. Exceptional verification requires the current
exact email address and revokes sessions. Recovery uses the ordinary provider
delivery flow and returns no recovery secret.

Suspension is separate from account deletion and custody lifecycle. Effective
state is evaluated at access time: suspendedAt is set and expiry is absent or
strictly after now. At expiry access resumes without reviving revoked sessions.
Suspending an owner does not close or freeze that owner's shared custodies.
Workspace administrative suspension preserves ownership and memberships.

Existing domain reconciliation is mandatory before remaining shared mutations:

- Space is physical custody; Company-owned Team/Project scopes also use
  DomainScopeCustody. A logical Team is not always an independent Space.
- ContextAccess owns generation-based membership; OWNER is derived from custody,
  not an assignable memberRole. Company child admission binds a root generation.
- ContextInvitation binds the ordinary issuer's access/generation and recipient
  acceptance. Cancellation/resend must preserve those bindings and mail proofs.
- SharedAuditEvent, signed control replay and ordinary mutation receipts currently
  attribute writes to a SharedActor. Platform Admin has no such membership.
  Reusing an owner's session or silently attributing an Admin write to that owner
  would violate the approved realm/attribution rules.
- Provisioning and owner handover use verified ordinary sessions. Their creation,
  policy, retention, notification and replay steps must receive an explicit Admin
  initiation boundary before those Admin endpoints can be exposed.

These are identified integration requirements, not approval requests for routine
implementation or authorization to omit the remaining requested functionality.
See the P1 work record for the current inventory and unfinished work.
