# 0026 / A03: Fixed roles, bounded defaults and resource grants

Status: APPROVED by owner for implementation planning, 2026-10-30, including the
revised capability model and initial shared-export limits. Not an execution authorization.

## Decision and policy model

Project roles are Owner, Admin, Manager, Member and Viewer. Other contexts use
their own fixed role catalogs in their designated phase. Do not build an arbitrary
permission language or rename future Lead roles as Project Manager.

ContextCapabilityPolicy stores scope, immutable version, role capability sets,
export bounds, publication actor/time/audit and predecessor revision. Publishing
requires If-Match, current Owner/Admin authority and [0031](0031-shared-transaction-fencing.md)
fencing. Retain a current-version pointer on the scope. Ordinary configuration
cannot alter the fixed administrative policy or delegation ceilings.

## Initial Project defaults

O = Owner, A = Admin, M = Manager, U = Member, V = Viewer. A cell lists allowed roles.

| Operation                                                                         | Initial default |
| --------------------------------------------------------------------------------- | --------------- |
| Read/list/search/count visible work; ordinary visible attachment download         | O A M U V       |
| Create/update Task/checklist; complete/reopen subject to workflow                 | O A M U         |
| Delete/restore Task; define Goals/milestones; manage phases/sections/risks/issues | O A M           |
| Comment on visible work                                                           | O A M U         |
| Assign/reassign; publish workflows/custom fields/templates; import/bulk writes    | O A M           |
| Bounded Project export                                                            | O A             |
| Invite Member/Viewer or narrow collaborator                                       | O A M           |
| Invite/promote Manager                                                            | O A             |
| Assign/revoke Admin                                                               | O               |
| Project settings/access policy; archive/restore                                   | O A             |
| Initiate ownership handover, custody transfer or dissolution                      | O               |

Acceptance/decline belongs to the named assignee. Workflow approval requires the
designated approval capability, not a generic edit permission. Project creation
is available to verified active users independently of roles elsewhere; no future
commercial Project cap is enforced.

## Configurable ceilings and non-delegable rules

Ordinary Task, assignment, workflow and bounded-export capabilities may be
configured within these ceilings:

| Role    | Ceiling                                                                        |
| ------- | ------------------------------------------------------------------------------ |
| Owner   | Ordinary operations; fixed ability to repair ordinary policy configuration     |
| Admin   | Ordinary operations/export; no Owner-only powers                               |
| Manager | Ordinary work management, assignment, workflow and bounded export              |
| Member  | Ordinary Task/checklist, permitted assignment/workflow actions, bounded export |
| Viewer  | Read and explicitly enabled bounded export; never mutations                    |

Other initial capabilities remain fixed unless separately approved. Owner/Admin
may publish ordinary policy; higher-role administration remains fixed as above.
Configuration must never delegate ownership transfer/dissolution, disable tenant
checks, expose Personal Finance/Journal/Mood/notes/Focus, permit self-promotion,
bypass assignment consent/workflow invariants, override closure/revocation or
increase hard security ceilings. Platform roles confer no content authority.

Shared exports have hard limits of 10,000 records and 10 MiB encoded output;
context configuration may lower them. Raising a ceiling needs engineering review.
Every export filters current visibility/fields/attachments; construction, publication
and download reauthorize. CSV formula protection remains. Personal export limits
and contracts are unchanged. Shared artifact retention is explicit in the retention
configuration, not inferred from Personal export settings.

## Typed grants

ResourceGrant: id, spaceId, scopeId, granteeAccessId/generation,
issuerAccessId/generation, capability enum set, expiresAt, revokedAt and revision.
Use concrete ProjectGrant, TaskGrant and GoalGrant targets and parent-bound file
authority. Deferred constraints require exactly one target and consistent custody,
scope and actor. Add each target only when its owning domain exists.

Grant actions are restricted to named-resource read/comment/update/complete and
permitted file access. They cannot confer policy, invitation, membership, ownership,
dissolution or bulk-workspace-export authority. Task grants do not reveal unrelated
Tasks, directory/member data or Project-wide counts. File authority is checked separately.

Effective authority intersects the explicit grant, fixed grant allowlist, current
context restrictions and current actor/resource state. Expiry uses database time;
rejoin cannot revive prior-generation grants. Lost issuer delegation invalidates
dependent grants until an authorized custodian reissues them. Accepted full
memberships survive inviter departure.

## Consistency and acceptance

Policy removal is revocation: lock custody, change current policy, bump authorization
versions and invalidate caches/cursors/jobs. An older policy snapshot never authorizes
a write or receipt replay. Lists/counts/search enforce visibility in the source query.
Invitation acceptance uses current policy. Audit all publications/grant changes without
private content. Do not add an arbitrary policy engine or new dependency.

Required AUTHZ-01–12 coverage: all defaults/ceilings, cross-context/nested IDs,
configuration escalation, Viewer mutation, grant expiry/revocation, export bounds,
policy-removal races, file/search/count privacy, receipts and erased actors.
See [migration and prerequisites](../g0-implementation-prerequisites.md).
