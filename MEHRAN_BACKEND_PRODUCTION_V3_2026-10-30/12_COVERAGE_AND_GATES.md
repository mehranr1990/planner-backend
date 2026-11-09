# Traceability, phase dependencies, stop conditions and agent instructions

## Phase activation dependency matrix
| Domain or capability | P2 | P3 | P4 | P5 | P6 | P7 |
|---|---|---|---|---|---|---|
| Shared custody, grants, owner succession, verified invites | BUILD | REUSE | REUSE | REUSE | REUSE | ADMIN METADATA |
| Standalone Projects, task engine and authorized projections | BUILD | REUSE | REUSE | REUSE | REUSE | QUOTA OWNER |
| Project attached to Team | INTERFACE ONLY | ACTIVATE after Team exists | REUSE | REUSE | REUSE | ADMIN METADATA |
| Project attached to Company | INTERFACE ONLY | INTERFACE ONLY | ACTIVATE after company custody established | REUSE | REUSE | ADMIN METADATA |
| Standalone Team | NO TEAM ENTITY | BUILD | REUSE | REUSE | REUSE | ADMIN METADATA |
| Team attached to Company | INTERFACE ONLY | INTERFACE ONLY | ACTIVATE after P4-01 | REUSE | REUSE | ADMIN METADATA |
| Employee sensitive records and Company expense/approval | DO NOT BUILD | DO NOT BUILD | BUILD | REUSE by permission | REUSE only owner-safe crossrefs | ADMIN METADATA ONLY |
| Direct/Work Messaging and meeting minutes | DO NOT BUILD | basic meeting scheduling only | basic company scheduling only | BUILD | REUSE for groups | SUPPORT ONLY |
| Social groups/activity/splits/lending/albums | DO NOT BUILD | DO NOT BUILD | DO NOT BUILD | FUTURE CONVERSATION PORTS ONLY | BUILD | QUOTA OWNER |
| Feature/quota ownership seams | DEFINE AND TEST | EXTEND | EXTEND | EXTEND | EXTEND | ACTIVE CENTRAL CATALOG (commercial still disabled) |
| Real paid checkout/charges | DO NOT BUILD | DO NOT BUILD | DO NOT BUILD | DO NOT BUILD | DO NOT BUILD | DEFER TO SEPARATE COMMERCIAL LAUNCH |

## Stage gates: proof, not declarations
**G0 (before first P2 DDL):** inventory and ADR approval A01–A08, full FK/cascade map, working permission matrix, last-owner erasure plan, migration dry-run/rollback on populated P1 representative data, current git SHA/quality baseline. Missing = STOP.
**G2 (each P2 batch):** exact feature-to-command/API-to-authorization-to-test matrix, migration compatibility, error/revision/idempotency contract, adversarial tenant tests and compiled OpenAPI validation. Missing = do not call batch complete.
**G3 (P3):** no actual Company membership/attachment; Team independent/Project-team relationship only; capacity privacy, recognition confidentiality/appeal and expiry/access tests.
**G4 (P4):** company custody first; typed safe legacy team/project attachment after; HR privacy/access evidence, expense immutable adjustments, budget reservations and partial reimbursements.
**G5 (P5):** owner policy already decided: author delete-for-everyone <=48h in DM/private groups, organization-policy-gated in work channels, self-only afterward; explicit retention and immutable history rules; scale/replay/revoke messaging tests; controlled media processing and DM privacy. Owner-approved [ADR 0044](../docs/adr/0044-phase-5-rest-polling-and-realtime-deferral.md) requires durable REST and frontend-driven incremental polling. P5-01 proves bounded ordered history/catch-up, idempotent sends, current source and conversation authorization, revocation/rejoin denial for stale cursors/receipts, tenant isolation, audit privacy, additive migrations, Zod/OpenAPI parity, the 13-stage quality gate and compiled smoke. P5-04 socket/presence/typing/connection-management acceptance remains DEFERRED, never PASSED; Push Notifications remain P5-03. Later-batch feature gates are not P5-01 deliverables.
**G6 (P6):** group and independent activity consistency; financial rounding/idempotent settlements; lost/found independent of existing loan; album quota and private derivative access.

G5 local completion is evaluated under approved ADRs 0044–0049. Every original
P5-04 requirement is classified in [the P5-06 audit](../docs/p5-06-p5-04-requirements-audit.md).
Transport-independent recovery, synchronization, authorization and polling load
remain mandatory. WebSocket/Presence/Typing and socket-specific tests remain
DEFERRED/NOT RUN. ADR 0049 permits bounded structural/metadata media checks for
local acceptance; a real malware engine is NOT RUN and blocks deployment/Shared
activation. Synthetic load and restore tests do not constitute production capacity,
SLO, full operational restore, deployment or later-phase approval.
**G7 (P7):** real admin strong MFA + zero default private-content access; dynamic feature flags/plan/counter testing in free simulation; safe manual assignment; explicitly no live payment/charges.
**GL (production launch):** SLO/RPO/RTO approved, customer-region legal analysis, production-like load/soak, automated restore/recovery tests, monitoring/runbooks, privacy requests and secure deploy evidence. Failing GL does not imply unbuilt features but BLOCKS launch.

## Traceability row template — mandatory per feature
```
requirement_id | source_decision | phase/batch | status: APPROVED_POLICY|DESIGN|IMPLEMENTED|PROVEN
actor+role | scope+custodian | command+state transitions | validation+error semantics
proposed_endpoint | actual_openapi_operation_id (blank until implemented)
database tables/constraints | transaction/revision rules | outbox/job effect
security test IDs | integration test IDs | migration evidence | observability signals
acceptance status | blocking open items | owner approval reference
```
If only a feature name is filled, it has NOT reached executable-spec quality.

## Regression scenarios mandatory across all shared domains
1. Personal data remains readable by its owner but inaccessible from new shared membership; Personal sync/export/erasure must not regress.
2. Outsider/other Company/same Company but wrong Team/verified external guest/wrong Project ID cannot read via list/detail/search/count/file/notifications/exports.
3. Revocation simultaneous with mutation/invite/queued worker/WebSocket catch-up fails safely; owner and role transfer cannot leave zero custodian or produce two conflicting transfers.
4. Retry-safe operations on invite acceptance, payments-as-records, shared expense approvals, uploaded media attachments and worker notifications.
5. Backup restore after account erasure, revoked grant and media delete does not re-grant access or publicly display erased author identity.
6. P2 independent Project exists without phantom Team/Company; P3 Team exists without Company; P4 attaches with safe migration and no unexpected sharing.
7. Import CSV malicious contents, formula injection on export, giant payloads, partial import rollback, file content spoofing and time-zone/Jalali boundaries.
8. Different roles and participants see only allowed records in staff/expense/meeting minutes and social polls; company admin cannot browse unrelated DM.
9. All current quota-eligible features work for free users while hard safety caps are enforced; simulated paid limit rejects races without deleting data.
10. Contract validator checks actual OpenAPI against current deployed version and client-generated expectations.

## Repository-only agent prompt — execute before design/code
> You are Mehran backend reviewer. Read **every file 00–12** in this package and in-repository AGENTS.md, PROJECT_INSTRUCTIONS, Phase 0/1 implementation notes, all existing ADRs, Prisma schema/migration history, current auth/session/sync/file/erasure implementation and test/quality scripts. Produce a **read-only** report: exact branch/SHA and clean status; compare package assertions to actual code; FK/cascade and owner model inventory; alternative schema ADR; operation-level permission matrix; last-custodian deletion plan; permission revoke/write lock-order proof proposal; P2-P4 dependency check; contract strategy; scoped batch test matrix; observed vs unknown evidence. Recommend no more than one bounded engineering decision per genuine unresolved issue. Do not edit code, migrations, git or deployment, do not install dependencies, do not initiate Phase 2. Distinguish owner-approved policy from inferred defaults; specifically enforce the approved scoped first-48h delete-for-everyone policy and NEVER assume commercial activation. STOP and report incompatibilities for owner approval.

## Scope assurance
This package provides a rigorous feature baseline and planned engineering proof obligations **across all future phases**. It is not proof that a production-ready implementation already exists. Full per-batch source-specific Prisma DDL, OpenAPI routes and deployment tests can only be validated after seeing the live repository. No guarantee of zero unforeseen bugs is possible.
