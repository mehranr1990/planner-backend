# 0025 / A02: Context admission, membership and inheritance

Status: APPROVED by owner for implementation planning, 2026-10-30.
Execution still requires explicit batch authorization.

## Decision

Use one effective ContextAccess record per actor/context, distinguishing full
membership from grant-only admission. A broad Space membership must not expose
every Project in a future Company boundary.

ContextAccess fields: id, spaceId, scopeId, actorId, state, memberRole, generation,
revision, joinedAt and endedAt. Enforce unique `(spaceId,scopeId,actorId)` and
composite FKs to the exact scope and SharedActor.

- States: ACTIVE, SUSPENDED, LEFT, REVOKED, ERASED.
- P2 memberRole: ADMIN, MANAGER, MEMBER, VIEWER, or null for grant-only admission.
- OWNER is derived from the primary-custodian seat, not a separately editable role.
  The custodian retains a base membership role for after handover.
- A null memberRole grants no resource rights by itself. Pending invitees have no
  effective admission until acceptance. No anonymous collaboration.
- ContextAccessInterval records immutable admission-generation start/end timestamps;
  a partial unique key permits at most one open interval per access record.
- Rejoining requires explicit admission and increments generation. Old grants,
  cursors, subscriptions and invitations cannot automatically revive.
- Full memberships count for last-member closure; grant-only collaborators and
  pending invitations do not. SUSPENDED remains membership until departure/removal;
  confirmed account closure ends effective participation. See
  [0029](0029-shared-departure-erasure-and-closure.md).

## Effective authority

Evaluate verified active identity, custody/scope lifecycle, current admission,
mandatory restrictions, role/grant capability, then resource state and visibility.
SUSPENDED, LEFT, REVOKED or ERASED admission cannot be bypassed by another grant
in that context. Actor/account closure always denies ordinary access.

P2 has no implicit cross-context inheritance. Later explicit Team/Project and
Company policy relationships must have concrete typed links and versioned rules.
Joining a Team/Company never implies every Project's visibility. Mandatory security
floors cannot be overridden; default-policy exceptions require specific authority;
optional policies operate within those floors.

Role capabilities follow [0026](0026-capabilities-and-resource-grants.md).
Conversation participation and join-history windows remain separate P5 contracts;
a context interval is not automatic permission to read conversation history.

## Migration, alternatives and acceptance

Add shared access/interval tables without changing Personal authorization or auth
tables. Reject implicit hierarchy-wide membership as overbroad. Shared deletion
uses actor references and closure state instead of cascading resource deletion from
departing users. See [migration and rollback plan](../g0-implementation-prerequisites.md).

Required tests MEM-01–08: duplicate admission, guest versus member, hard-deny
precedence, rejoin generation, role change, wrong context, historic intervals and
independent roles in unrelated contexts.

Owner approval: explicit approval of revised A01–A08 for implementation planning.
