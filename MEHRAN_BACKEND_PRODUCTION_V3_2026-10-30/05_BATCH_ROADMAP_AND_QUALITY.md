# Proposed Backend Implementation Roadmap and Quality Gates

**This is a suggested batch decomposition; requires approval after a repository preflight. No batch has been authorized to execute by this file.** Implement in dependency order. Future owner-owned ADR approval should precede database and irreversible changes.

## Pre-Phase-2 architecture gate (documentation only)
G0.1 Reconcile README and repository reality: live Git/remote, 24 migration checksum baseline, existing 23 ADRs, Phase 0/1 API/OpenAPI, exact auth and storage coupling, cascade inventory. G0.2 Propose and get approval for shared custody/schema, membership/capability/grants, invitations, revoke fencing/lock order and shared deletion/export/transfer. G0.3 Record future quotas' owners and module seams; **no billing implementation**. G0.4 Define migration rollback/data preservation strategy, tests and API compatibility. Do not proceed until owner expressly approves the critical ADRs.

## Phase 2: 7 proposed batches
P2-01 Shared custody and membership kernel; schema-safe migration, explicit membership/roles/grants, fencing, no Project UI business endpoints.
P2-02 Invitations/acceptance, verified actors, external collaborators, access matrix and lifecycle transfer/succession.
P2-03 Project core: independent ownership now, forward-compatible typed Team/Company association contracts (actual Team/Company entities and attachment become executable only after their phases), phases/sections/milestones, lifecycle, member assignment and source-owner facade integration.
P2-04 Task assignment/acceptance, personal projection, My Calendar overlay, contributor links, policies and notifications.
P2-05 Workflow versions, custom fields, task dependency graph/lag/lead and explicit reschedule preview/apply.
P2-06 Project risks/issues, templates, bulk, bounded CSV import, reporting/estimate/workload primitives.
P2-07 Authorized project documents/comments/files/activity, view query contracts (List/Kanban/Calendar/Timeline/Gantt/Dashboard), final security and migration audit.

## Phase 3: 5 proposed batches
P3-01 Independent Teams only, membership/roles and authorized project visibility; Company association is a future interface only (not active until P4).
P3-02 Team-owned tasks/goals/calendar and cross-project planning, backlog, weekly review and sprint optionality.
P3-03 Team capacity and portfolio analytics from authorized work data; team dashboards.
P3-04 Recognition, feedback, corrective action, appeal and disclosure controls; light meeting agendas/invitations.
P3-05 Independent Team handover, archive/restore, cross-context isolation and performance tests; no Company attachment/transfer yet. Actual Team/Project association to Company belongs to P4 after P4-01.

## Phase 4: 6 proposed batches
P4-01 Company custody/domain, departments/units, corporate membership roles, multiple-company isolation and policy inheritance; introduce organization authorization boundary before any dependent attachment.
P4-02 Staff work profile and sensitive employee case files; basic availability; resources and equipment allocation.
P4-03 Corporate expense, receipt and approval statuses; budgets/commitments/allocations, exact currency.
P4-04 Reimbursement/payment acknowledgement and controlled workflow approval versions.
P4-05 Knowledge base files/versioning, company reports, permitted portfolio and authorized export/audit.
P4-06 Controlled attachment/transfer of existing independent Teams and Projects to Company (separate preview, consent, migration), ownership handover, departure, archiving, records retention and full cross-company security/recovery checks.

## Phase 5: 6 proposed batches
P5-01 Conversation/participant authorization, DM/private group/work channels, ordering/receipts and idempotent text messages (REST durable).
P5-02 Reply/thread/reactions/edit/delete/forward/pin/mention, safe search and moderation/report, privacy/retention policy.
P5-03 Authorized attachment/image/voice (2min/10MB) pipeline and lifecycle; read/delivery statuses and safe notification jobs.
P5-04 WebSocket adapter for live events/presence/typing, membership fence, reconnect/history catch-up/backpressure.
P5-05 Meetings, RSVP, agenda, minutes/decisions/Task conversion, approvals/announcements.
P5-06 Leave/erasure/retention replay, DM block vs group interactions, privacy and load tests.

## Phase 6: 6 proposed batches
P6-01 Connection requests/email-or-verified-phone lookup, block/privacy, private Circle labels; Social Group roles/discovery/admission.
P6-02 Independent/Group Activities, templates, multi-day scheduling, RSVP/waitlist, polls/free-busy/Calendar/Chat integrations.
P6-03 Shared expenses proposals/approval/revisions, exact split amounts, per-member balance views, settlement acknowledgement and optional personal posting.
P6-04 Personal/group lending, lost/found claims, handovers/returns/disputes and audit.
P6-05 Authorized social challenges/goals, private albums, thumbnail safe pipeline/storage quotas and privacy.
P6-06 Cross-context isolation, exit/retention, shared finance correction recovery and end-to-end smoke.

## Phase 7: 5 proposed batches
P7-01 Separate Platform Admin admission/MFA/roles/case-bound access and admin audit.
P7-02 Feature Catalog, versioned flags/rollouts and rollback, global usage meter and quota authority.
P7-03 Versioned Plans, entitlements, Workspace ownership and per-workspace fixed tier/member caps; audited manual grants, trials/exceptions; **all paid denies disabled**.
P7-04 User/Workspace metadata operations, suspensions/abuse/support cases, aggregate dashboard and safe export.
P7-05 Downgrade/over-limit preservation, plan/flag failure modes, admin intrusion tests and post-phase paid-launch handoff (no live charge).

## Test and quality policy (all batches)
Use existing repo's `pnpm quality` 13 stages, which historically include config:check, db:generate, auth:schema:check, db:validate, build, typecheck, format:check, lint, architecture, test, openapi:check, test:integration, db:migrations:check. Verify exact current scripts, do not blindly invent.
- During implementation: targeted Vitest/integration tests near changed modules, typecheck as warranted; no redundant repeated full-suite runs.
- End of batch: single full 13/13 quality run, fresh compiled restart smoke (API & worker if changed), additive migration verification and matching checksums for development/test.
- Every shared capability: actor outsider/member/viewer/guest/departed/closed cases, nested cross-tenant IDs and hidden count/search/file, concurrent revoke+mutation, stale receipt/link/cursor, session invalidation, alternate ownership, idempotency/retry/rollback, migration backwards compatibility.
- Maintain ADR and OpenAPI doc/contract, traceability, architecture constraints, no secrets, no fake API endpoints or unsupported return shapes.
- Existing migrations/pg-boss hash immutable, no destructive backfill, no blind database reset, no new infrastructure without approved need.
- After batch: report change manifest, ADRs, migrations and hashes, test counts/evidence, compiled restart results, known blockers, exact Git state. Leave uncommitted unless authorization explicitly says to commit/push; never force push.

## Production gate (independent of feature completion)
Self-hosted Docker/Compose persistent volumes, production secrets and env, DB upgrade/backup verified restore and signed expiry + erasure replay, object/private file durability, hosted CI, TLS/cookie/CORS/origin, SMTP delivery, push, worker replay, rate limits, monitoring, incident controls, performance and security review. Any commercial activation requires further provider/compliance, billing, refund, tax and support review; no unapproved charging.

## Additional explicit acceptance gates
- P2-01/P2-02: prove last-custodian and lawful personal erasure can coexist; verify no phantom Team/Company linkage prior to their domain implementation.
- All P2–P6 creations: verify pre-Phase-7 feature/quota policy seam and authoritative usage ownership under current free-mode; enable later config without rewriting every owner endpoint. Safety caps stay enabled and not subject to paid flags.
- P5-02: test approved 48-hour ordinary author edit and delete-for-self after; test approved author delete-for-everyone within 48h for DM/private groups, policy-gating for work channels, and rejection of ordinary delete-for-everyone after 48h, scoped history/search/export/rejoin semantics and moderation exceptions.
- P6-03: Group and independent Activity expense proposals have equivalent validated, reviewed flows. P6-04: Lost & Found can operate without prior lending contract.
- Every accepted batch outputs current accurate OpenAPI JSON location/operation delta and machine-readable schema parity. Avoid claims that Swagger UI runs unless checked.
