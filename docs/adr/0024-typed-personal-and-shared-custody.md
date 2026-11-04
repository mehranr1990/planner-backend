# 0024 / A01: Typed Personal and shared custody

Status: APPROVED by owner for implementation planning, 2026-10-30.
Execution still requires explicit batch authorization. No schema is implemented by this record.

## Context and decision

Retain the existing Space namespace and unified Task/Goal engines. The inspected
P1 baseline is `6a9ccdb81e8c3b4842f1d7ea63c3531a6abbd2bb`: 24 application
migrations, 67 models and 139 foreign keys, including 37 owner-composite references.
See [schema](../../prisma/schema.prisma) and the
[migration plan](../g0-implementation-prerequisites.md#migration-design).

Select typed custody under Space instead of a separate SharedBoundary/resource
namespace. The latter requires broader source and child-key migration.

## Target schema and invariants

| Record        | Required contract                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------- |
| Space         | Existing UUID; kind PERSONAL or SHARED; existing owner keys retained                               |
| SharedCustody | spaceId PK/FK; lifecycle state; primaryOwnerAccessId; authorizationVersion; retentionPolicyVersion |
| AccessScope   | UUID; spaceId; lifecycle/revision; unique (spaceId,id); root scope ID equals Space ID              |
| SharedActor   | UUID; spaceId; nullable live userId; state/erasedAt; one live actor per (spaceId,userId)           |

- PERSONAL requires non-null ownerUserId and no SharedCustody row. SHARED requires
  null ownerUserId and exactly one SharedCustody row. Deferred constraint triggers
  enforce the exclusive shape, including subtype deletion/update paths.
- Preserve Space unique keys `(kind,ownerUserId)` and `(id,ownerUserId)` and its
  existing User-owner cascade. Shared rows have no User owner to cascade from.
- Personal kind/owner are immutable. Never convert an entire Personal Space.
- Active/archived independent custody requires one eligible primary custodian:
  an ACTIVE full-member ContextAccess in the root scope with a live SharedActor.
  Controlled frozen/closing states may lack an eligible custodian; closing states
  require a durable lifecycle job under [0029](0029-shared-departure-erasure-and-closure.md).
- Scope, actor and resource relationships carry spaceId and use composite FKs.
  Concrete owning-domain records bind scopes through real FKs, not loose target strings.
- In P2 an independent Project uses its root scope. Later Company-associated
  Projects use separate scopes inside Company custody. Parent association alone
  never transfers custody.
- No Team, Company, Group or Activity domain tables are introduced before their phase.

## Source compatibility and attribution

Keep all 37 existing owner-composite FKs. When a source becomes shared-capable,
add a direct boundary FK, scope FK and boundary-local author/actor reference.
Relax its legacy User attribution nullability only with enforced branch shapes:
Personal rows retain existing non-null attribution; shared rows use actor references
and null legacy User attribution. Shared actor references never authorize access.

Task/TaskChange, Goal, recurrence/templates and StoredFile evolve only in their
scheduled slices. Null components in a composite FK must not bypass the new direct
FKs and branch triggers. Personal-only tables remain Personal-only.

Identity erasure detaches live User links through the lifecycle coordinator;
use restrictive User-link deletion behavior so raw identity deletion cannot silently
bypass pseudonymization. Retained actors contain no copied email/profile after erasure.

## Consequences and acceptance

This is data-preserving expansion, not CREATE-only DDL: selected NOT NULL relaxations
and trigger SQL require exact migration review. Historical migration bytes remain fixed.
After shared writes exist, the Personal-only release is not a safe automatic rollback.

Required tests CUST-01–08: exclusive subtype, mandatory Personal owner, invalid
shared insertion, foreign scope/actor, User deletion, primary-custodian eligibility,
closing-state job requirement and populated Personal-data preservation.

Owner approval: explicit approval of revised A01–A08 for implementation planning;
the [prerequisite register](../g0-implementation-prerequisites.md) separates design
approval from executable evidence and release authorization.
