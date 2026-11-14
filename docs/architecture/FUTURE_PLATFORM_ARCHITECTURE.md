# Future platform architecture

Status: REVIEW PROPOSAL, not an approved ADR or implementation authorization.
Baseline: Phase 1 commit `6a9ccdb81e8c3b4842f1d7ea63c3531a6abbd2bb`.

## Authority and observed implementation

[PROJECT_INSTRUCTIONS.md](../../PROJECT_INSTRUCTIONS.md) and
[PHASE_0_1_IMPLEMENTATION.md](../../PHASE_0_1_IMPLEMENTATION.md) govern Phase 0/1.
No separate binding Phase 2–5 specification was found in this repository. The
phase allocation in this review is a recommendation for owner approval, based
on the requested future capabilities. It does not redefine the completed backend.

The application is a NestJS modular monolith, with strict Zod REST boundaries,
Prisma/PostgreSQL, Better Auth identity, scoped owner facades, revisions,
transactional receipts/outbox and the existing pg-boss worker. There are 293
documented operations; current authorization is exclusively personal ownership.

| Foundation                    | Reuse                                              | Extension required before collaboration                                                            |
| ----------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Better Auth User and sessions | One stable identity across products                | Separate identity admission from future membership/relationship decisions                          |
| Space and AuthorizedSpace     | Explicit ownership and transaction boundary        | Shared custody, membership and action-specific policy; current capability is PERSONAL-only         |
| Tasks and Goals               | Stable IDs, history, progress and owner commands   | Project/organizational associations and permission-aware facades; no parallel Task/Goal engines    |
| Calendar and StoragePort      | Event/TimeBlock distinction; private bytes         | Shared calendars, event participation and resource-level file access                               |
| Audit/outbox/jobs             | Atomic effects, retries and dispatch-time rechecks | Recipient/source authorization and membership revocation semantics                                 |
| Personal search/Insights      | Bounded read-only owner queries                    | Authorized scope selection and visibility-safe aggregation                                         |
| Sync/export/erasure           | Replay, bounded processing and recovery principles | Shared retention, transfer and cursor policies; existing personal purge cannot be reused wholesale |

## Recommended domain boundaries

Keep identity, account preferences and global account lifecycle distinct from
Spaces/access, professional/social relationships, Projects, Teams/Organizations,
Social Groups/Activities, communication, shared expenses and billing/entitlements.
Introduce each module only when its separately approved batch needs it.

Projects organize work in an authorized shared boundary; Teams group people;
Organizations own organizational policy/custody. A Social Group or Circle is a
social context, not an Organization with renamed fields. Activities can reference
authorized events, Tasks and shared expenses. Membership in one context never
implies access to another. A product's screen/workspace is not a security Space.

Tasks and Goals remain their existing owner domains. A future Project association
must call those domains' public commands and preserve the Task/Goal UUID and
history. Assignment, authorship, membership and custodial ownership are separate.
Personal habits, Journal, Mood, financial accounts and personal Focus evidence
remain private unless a later explicit contract approves a particular sharing use.

Retain the modular monolith, PostgreSQL and existing storage/outbox mechanisms.
No evidence currently requires microservices, a separate search cluster, a new
broker or a new database. A future text messaging transport is a separate ADR;
the REST API and durable message model must remain authoritative across reconnects.
Native audio/video and full end-to-end encrypted messaging are excluded here.

## Compatibility strategy

Preserve existing `/api/v1/me`, Personal routes, response shapes, IDs and recorded
time/currency/history semantics. Do not make a user's current personal Space a
shared Space or silently move its records. Create new shared boundaries only after
their schema and custody rules are approved. A shared-context API must identify
its context explicitly and never trust a body-supplied owner or role.

Use expand → checked backfill → dual compatibility verification → switch →
separately reviewed contraction when necessary. Additive evolution is preferred,
but existing non-null owner/cascade and composite-FK assumptions require a real
migration design; adding a membership table alone is insufficient. Keep all
24 existing migrations and P0/P1 API baselines immutable.

Approval gates are shared ownership/custody, fixed initial roles and resource
grants, invitation/guest identity rules, account departure/transfer/retention,
message privacy/retention and transport, and shared expense accounting. Billing
requires a later entitlement/provider/commercial decision; no prices or provider
are proposed as approved.

## Implementation evidence and companion reviews

- [Composition root](../../apps/api/src/app.module.ts),
  [schema](../../prisma/schema.prisma),
  [dependency rules](../../tooling/architecture-tests/dependency-cruiser.mjs).
- [Personal policy](../../apps/api/src/platform/authorization/space-policy.service.ts),
  [transaction scope](../../apps/api/src/modules/spaces/public/personal-scope.ts).
- [Identity, Spaces and memberships](./IDENTITY_SPACES_MEMBERSHIPS.md).
- [Communication and social contexts](./COMMUNICATION_AND_SOCIAL_GROUPS.md).
- [Resources and lifecycle](./SHARED_RESOURCES_AND_LIFECYCLE.md).
- [Proposed Phase 2–5 order and approval gates](./PHASE_2_TO_5_ROADMAP.md).
