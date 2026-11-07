# 0034: Company foundation roles and bounded policy inheritance

Status: APPROVED by owner, 2026-11-06, for the P4-01 local implementation matrix below.
Scope: P4-01 only. The owner authorized implementation of the approved roadmap;
this proposal supplies its otherwise unspecified operation-level permission rules.
It does not authorize P4-02, attachment/transfer or production activation.

## Approved product rules

One Company owns one Shared Space/root AccessScope. Department and Unit are typed
child contexts within that custody; a Unit belongs to one Department in the same
Company. Existing independent Teams/Projects keep their own custody and admissions.
No automatic attachment, source copying or cross-company relationship.

Fixed roles: OWNER derived from the primary Company custodian; ORG_ADMIN,
DEPT_MANAGER, TEAM_LEAD, MEMBER, VIEWER as explicit context memberships. Root
membership is required for every child-context operation; child participation is
separately explicit. A root managerial role alone confers no child membership.
The same account can hold different roles in different Companies/contexts.

| Operation                                                                                               | Approved authority                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create Company                                                                                          | Verified active account; same existing retention/Shared prerequisite gates                                                                                |
| Company metadata and root directory                                                                     | Current full root members, subject to bounded read policy                                                                                                 |
| Company settings; create/manage Department and Unit structure; appoint/revoke Dept Manager or Team Lead | Owner / Org Admin                                                                                                                                         |
| Assign/revoke Org Admin                                                                                 | Owner only; no self-promotion or editing Owner seat                                                                                                       |
| Invite/remove/suspend Member or Viewer at root                                                          | Owner / Org Admin                                                                                                                                         |
| Invite/remove/suspend Member or Viewer in a child context                                               | Owner / Org Admin; Dept Manager only in that explicitly admitted context                                                                                  |
| Ordinary child directory/metadata reads                                                                 | Current root membership plus explicit current child membership and effective policy                                                                       |
| Structure/policy administration metadata                                                                | Owner / Org Admin may inspect structure and policy configuration throughout their Company; this grants no future employee, Team or Project content access |
| Team Lead                                                                                               | Ordinary admitted-context reads in P4-01; no Company-wide administration or implicit Team access                                                          |
| Leave context                                                                                           | Current member; existing primary-custodian/last-member safeguards at Company root                                                                         |
| Publish Company/child policy; override inherited default                                                | Owner / Org Admin only; explicit override action, audited with expected policy revision                                                                   |
| Root membership suspended/revoked/left/closed                                                           | Immediate denial of all child authority; explicit re-admission must not revive prior child admission generations                                          |

P4-01's policy catalog is limited to its implemented ordinary metadata permissions:
`structure.read` and `directory.read`. No arbitrary expression language or dormant
personnel/finance/work policy keys. Fixed administration/delegation rules and
mandatory verified identity, current root/child membership, tenant matching,
account closure, lifecycle, signed restore and source-privacy floors cannot be
configured or overridden.

Policies are immutable, versioned, typed to Company/context and evaluated along
Company → Department → Unit. Mandatory restrictions intersect at every ancestor;
no descendant can broaden them. Defaults inherit until an explicit authorized
default override; optional local settings remain inside all fixed ceilings and
mandatory restrictions. Ordinary read defaults permit current admitted roles.
Child managers cannot publish policy or manufacture override capability. Every
restrictive change advances authorization versions and invalidates stale cursors,
offers, receipts and authority before any later effect.

Root and child membership changes/invitation acceptance follow existing verified
identity, generation, current issuer authority, expiry and transaction fences.
Child offers bind the current root admission generation; accepted child seats are
never automatically restored by root rejoin. Parent policy is authorization input,
not a source-custody transfer or permission to read private Personal/Team/Project data.

Company handover/archive/closure UI commands and controlled attachment/transfer
remain P4-06. P4-01 still preserves the existing account-exit, frozen-custodian,
last-member, retention and independent Personal-erasure safeguards at its new root.
No automatic Company purge is enabled before its owning lifecycle consumer exists.
No new role or policy activates Company integrations, HR files, finance or exports.

## Required implementation evidence

Exact role and policy ceilings; cross-company and wrong-child IDs; explicit child
admission; ancestor hard-deny/default override/optional precedence; root rejoin and
inviter demotion; observed membership/policy versus mutation races; retained
attribution and Personal erasure; root-last-custodian safety; preservation of every
existing Project/Team/Personal API and independent custody. Additive typed FKs,
immutable policy versions, populated predecessor rehearsal and compiled API restart.

Owner decision: explicit approval of the proposed P4-01 policy in this session.
Production, Shared activation and later batches require separate authorization.
