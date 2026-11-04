# 0032: Designated workflow approval and separation of duties

Status: **APPROVED by owner, 2026-11-04**.

Owner decision during explicitly authorized P2-05: accept designated approvers
per transition, bound to admission generation, without requester self-approval.
This resolves the approval-authority gap in ADR 0026; no other product permission
or Personal contract is changed by this decision.

Workflow publishers designate eligible full members for each approval-requiring
transition. A designation is a narrow transition-approval capability, with concrete
scope, workflow version, transition and ContextAccess/generation references. It
does not grant general Task editing, workflow publication or membership authority.
Current account, admission, policy, source visibility and applicable source-write
permissions remain mandatory. Viewer or grant-only admission cannot bypass the
existing ceilings. A designation from an old admission generation never revives.

The requester cannot approve their own request, including when they are Owner or
also named as approver. Current Owner status is not an implicit approval bypass.
At approval, recheck the named approver and the requester's current eligibility,
source revision, pinned workflow version/transition and expiry under ADR 0031
locks. Predeclare both accounts before custody/owner work. Commit source status,
history, request outcome, receipt/audit/outbox atomically. Revocation or a stale
source/version invalidates an old request rather than approving from cached rights.

Alternatives considered: fixed Owner/Admin/Manager approval only; leaving
approval-requiring transitions disabled. The owner selected explicit approvers
with requester self-approval prohibited. This creates no Company policy, generic
permission language, public proof token or new broad resource-grant action.

Required tests: wrong approver, self-approval, old generation, source revision,
current role/policy, requester closure/revocation, replay, immutable published
versions and revoke-versus-approve ordering. Real Shared activation remains gated.
