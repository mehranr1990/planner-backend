# Proposed Phase 2–5 roadmap

Status: PLANNING ONLY; phase numbers, batches, APIs/entities and acceptance criteria
below are not approved implementation specifications. No binding Phase 2–5 scope
document exists in the reviewed repository. The owner must approve each phase/batch
and its unresolved ADRs before implementation. Phase 1 is complete locally;
deployment verification remains separate.

## Recommended dependency order

| Proposed phase                                  | Outcome                                                                                                                                                            | Dependencies / approval gate                                                                                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2 — Shared access and Projects                  | Shared custody/access, invitations/guests, Project organization using existing Tasks/Goals; explicitly authorized shared events/files                              | Custody/schema migration, initial capability matrix, revocation fence, transfer/deletion policy, personal-reference boundaries                                                          |
| 3 — Teams/Organizations and text communication  | Organization/Team membership and delegated Project access; persisted conversations, work channels, comments/mentions/threads/reactions and recipient notifications | Fixed role inheritance, guest elevation, directory privacy, last-custodian rules; conversation/history/moderation/privacy ADR; transport decision after durable REST invariants         |
| 4 — Social relationships, Groups and Activities | Friends/professional relationships, family/sports/trip contexts, activity participation, group/direct communication and shared expense/settlement records          | Circle versus Group semantics, blocking/contact policy, social membership visibility, Activity access and exact split/settlement accounting; reuse Phase 2 access and Phase 3 messaging |
| 5 — Integrations, entitlements and billing      | Approved integration entry points and commercial access rules, operational hardening appropriate to measured use                                                   | Provider/credential scopes, webhook replay/revocation, entitlement owner and lifecycle, billing/cancellation/refund/tax decisions, scale/security evidence                              |

The dependency chain is authority/custody → scoped resources and guests →
collaboration/communication → social/shared expense contexts → selected integration
and commercial extensions. Messaging need not wait for every organizational
feature, but cannot precede its required participation/privacy model. Phase numbers
can change at owner review; do not infer authorization from this table.

## Phase 2 prerequisites and smallest safe first batch

Prepare reviewed ADRs for shared Space custody and its migration, capability/
membership/invitation semantics, and shared-resource departure/erasure. Freeze the
P1-12 API baseline and 24 migration checksums. Inventory every personal ownership
query, composite FK, owner cascade, worker and lifecycle command before DDL design.
Use expand/backfill/compatibility verification rather than converting personal
rows into shared rows or forking Task/Goal engines.

Only after approval, the smallest first implementation batch should establish
shared authority/invitations and isolation tests, without Project business logic.
Then add an approved Project slice using owner facades; then resource sharing and
personal-view references. This order prevents a Project API from temporarily
bypassing permission or deletion rules while waiting for a later phase.

## Decision register

| Decision                                                      | Required before                | Risk if deferred                                                           |
| ------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------- |
| Exclusive personal/shared custody and FK/cascade evolution    | First shared Space             | Member deletion destroys shared data or fictitious owner becomes permanent |
| Membership roles, grants, inheritance and revocation          | Any collaborative read/write   | Stale access, nested ID leakage, unsafe guest escalation                   |
| Invitation identity matching and guest lifecycle              | External collaboration         | Forwarded token grants wrong identity or duplicate memberships             |
| Shared Task/Goal references and transfer                      | Cross-context planning/sharing | Duplicate identities or broken same-Space constraints/history              |
| Shared deletion/export/retention and last custodian           | Shared resource creation       | Unfinishable erasure or loss of others' data                               |
| Conversation history, blocking, moderation and transport      | Messaging                      | Unauthorized replay/live subscriptions and privacy conflicts               |
| Circle/Group/Activity semantics                               | Social implementation          | Ambiguous membership and excessive inherited access                        |
| Split remainder, currencies, corrections and settlements      | Shared expenses                | Lost minor units, duplicate posting or corrupted personal ledgers          |
| Integration scopes/webhooks and entitlement/billing ownership | Phase 5 slice                  | Cross-account secrets, replay effects or undefined commercial behavior     |

## Acceptance required for each future slice

Keep existing Phase 0/1 regression and API compatibility gates. Add isolation for
member/guest/outsider/departed/closed actors; nested resource/file/search/count
privacy; concurrent revocation/write and invitation acceptance; parent/context
consistency; receipt/outbox dedup; shared owner departure/transfer; and restore
replay without resurrected access. Verify data-preserving migration from the actual
previous release and compiled restart smoke for new durable effects.

Reassess real-time infrastructure or scale only with measured requirements and an
approved ADR. Native audio/video, full E2EE, unrequested AI, speculative platform
scaffolding and a general offline engine are not implementation deliverables here.

Companion detail: [overview](./FUTURE_PLATFORM_ARCHITECTURE.md),
[access](./IDENTITY_SPACES_MEMBERSHIPS.md),
[communication/social](./COMMUNICATION_AND_SOCIAL_GROUPS.md),
[shared lifecycle](./SHARED_RESOURCES_AND_LIFECYCLE.md).
