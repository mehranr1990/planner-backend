# Mehran Planner — Platform Admin Master Specification & Continuous Codex Execution

## Current execution authorization

Owner publication approval, 2026-11-27: Registration Diagnostics and System Email
Delivery Logs is accepted for local development after verification of its final
diff, M129/M130 checksums, work record and protected-file evidence. Publication of
only its 68 approved paths to origin/main is authorized. This revision contains
the synchronized final contracts and handoff; prior uncommitted/approval notes
are historical checkpoints. Stop after publication and final handoff. No new
development, frontend changes, deployment or server configuration changes.

Owner diagnostics update, 2026-11-27: Backend Integration Readiness was accepted
and its 32 approved files published as
`3b1e19bc59b58e4f60c5cce14749d0091b4c7f6e`, verified on origin/main.
Registration Diagnostics and System Email Delivery Logs is the authorized final
backend batch, tracked in [its work record](docs/registration-email-diagnostics-work-record.md)
and [ADR 0081](docs/adr/0081-registration-email-diagnostics.md). It is COMPLETE -
LOCAL DEVELOPMENT with final acceptance evidence in that record. Implement only
missing registration evidence, safe unified mail observations and controlled
resend/retry, reusing existing source owners, SMTP, outbox, audit and workers.
No diagnostics commit/push without separate approval. No frontend, E2E, subagents,
deployment or unrelated refactoring. Prior authorization paragraphs are historical.

Owner readiness update, 2026-11-27: P7 was accepted for local development after
reviewing final evidence, diff and protected-file checks. Its 52 approved files
were committed/pushed as `9b2d7768265fe6444be17cd4d2695fbaa798237c`, verified on
origin/main. Final Backend Integration Readiness is authorized: CB-INV-1,
read-only Admin frontend contract reconciliation, approved missing adapters and
consolidated handoff/acceptance. [Readiness work record](docs/backend-integration-readiness-work-record.md).
Readiness commit/push requires separate approval. No frontend changes, deployment,
E2E or subagents. Prior authorization/status paragraphs are historical.

Owner update, 2026-11-26: P6 is accepted for local development based on its documented final verification. Its 61 approved files were reviewed, committed and pushed as `125cd98d36aacdea15a3ed120a220f86775d5a56`; origin/main was verified. The owner compose and all predecessor migration bytes/checksums were preserved. All P7 Product Analytics implementation and local verification are authorized, including consolidated P0-P7 coverage and backend/frontend handoff documentation. P7 is COMPLETE - LOCAL DEVELOPMENT in [its work record](docs/platform-admin-p7-work-record.md). P7 commit/push, deployment, Guest Access, E2E, subagents, frontend source and additional Client fixes remain excluded. Earlier status and authorization paragraphs are historical.

Owner update, 2026-11-26: P5 is accepted for local development. Its final evidence,
diff, ADR 0077 and M119–M121/historical migration bytes were verified; P5 alone was
committed and pushed as `85c78390692e9d5bae108a068f46c4358efb8051`, with remote HEAD
verified. All remaining P6 implementation and local acceptance are authorized.
P6 is **COMPLETE — LOCAL DEVELOPMENT** in [its work record](docs/platform-admin-p6-work-record.md):
all 1,018 repository tests and 1,362 runnable PostgreSQL tests passed in the final
complete runs. Migration and quality gates passed; one conditional live-scanner
case remains skipped. P6 is uncommitted and no deployment readiness is claimed.
Do not commit/push P6, start P7, deploy, change frontend source, use subagents or
write E2E tests. Earlier authorization/status paragraphs are historical.

P5 final local acceptance, 2026-11-26: **COMPLETE — LOCAL DEVELOPMENT**.
P4 publication was verified on origin/main
as `13c45246bad4fc817bf96dd8f5023c6cb7e17585`. Plans/Entitlements, Subscriptions and
Billing are implemented locally with PostgreSQL history, APIs, workers and
free-by-default enforcement. Mandatory full gates and successful affected reruns
are recorded in the [P5 work record](docs/platform-admin-p5-work-record.md). P5 commit/push, P6 and
deployment remain excluded by the current owner instruction.

Owner update, 2026-11-26: P4 is accepted for local development subject to verification
of its documented final evidence; that evidence, diff and migration checksums were
verified. Publication of only P4 to origin/main is authorized, followed after the
successful push by all three P5 modules. P5 must remain uncommitted; P6, deployment,
frontend, E2E and subagents are excluded. Prior authorization paragraphs are historical.

Owner update, 2026-11-25: Client backend local acceptance and separate publication
were explicitly authorized. P3 `29aed23` and Client `0f9ff0a` are published on
origin/main. Local P4 (Communications, Support and Moderation) is authorized without
intermediate approvals; P4 commit/push, P5 and deployment are not authorized.
Inbound email replies remain required: implement a provider-independent verified
adapter boundary and secure processing infrastructure, keeping activation disabled
until a trusted transport is configured and verified. P4 is COMPLETE for local development, with actual final gates and successful
affected reruns recorded; owner acceptance/publication remain separate. See [P4 work record](docs/platform-admin-p4-work-record.md). Earlier
authorization/status paragraphs below describe historical checkpoints.

On 2026-11-25 the owner accepted Platform Admin P2 for local development based on its final documented verification, authorized committing and pushing only P2 to origin/main, and authorized local P3 implementation after the successful push. Preserve the owner's compose.yaml. P3 commit/push, P4, frontend work and deployment require separate approval. Earlier authorization paragraphs below are historical. [P2 work record](docs/platform-admin-p2-work-record.md)

Verified implementation update, 2026-11-25: P2 was pushed as `8bfba88`. P3 is COMPLETE for local development, with 24 Admin operations, eleven additive control tables and the trusted backup/restore operator console. Its full checkpoints and successful affected reruns verify 952 repository tests and 1,272 runnable PostgreSQL tests; code, architecture, contracts and migration gates passed. One conditional live-ClamAV skip and deployment-only gates remain explicit. P3 is uncommitted/unpushed; P4 is NOT STARTED. [P3 work record](docs/platform-admin-p3-work-record.md)

Publication authorization update, 2026-11-25: the owner explicitly authorized committing and pushing the existing P3 implementation. Preserve the owner's compose.yaml outside this publication. P4 and deployment remain unauthorized; earlier publication restrictions above describe historical checkpoints.

## Owner-approved P1 custody exception — 2026-11-24

The owner's current task authorizes only the one-way transition
`INDEPENDENT_TEAM → COMPANY_OWNED_TEAM`, through ordinary Team creation followed by
the consented preview/apply workflow in [ADR 0043](docs/adr/0043-company-transfer-deferral-and-stabilization.md).
Independent affiliation is distinct from this custody change. Both owners and
every affected participant must explicitly consent and reauthenticate; Admin
authority never substitutes for ordinary consent or membership. Unsafe existing
data/dependency graphs must be rejected with typed errors and preserved unchanged.
No fake child Space, implicit Company-owner content access, child detachment,
Company-to-Company movement, Project transfer or other custody direction is enabled.

For this work item, the explicit P1-only instruction overrides the broader
continuous-phase charter below: do not begin P2–P7, alter frontend code, deploy,
commit or push. Other owner product decisions below remain intact.
Implementation and actual gate results are recorded in
[the P1 work record](docs/platform-admin-p1-work-record.md); this exception alone
does not establish completion or acceptance.

Local verification update, 2026-11-24: Platform Admin P1 is complete for local
development and recommended for acceptance: 27 Admin operations, three ordinary
custody commands, 936 repository tests and 1,231 PostgreSQL tests passed (both
complete runs exit 0; one conditional live-clamd skip). All applicable local gates
passed. The work record documents exact commands, eligibility limits and excluded
production checks. P1 remains uncommitted; P2–P7 remain unstarted under this task.

**Document type:** owner-approved product decision register + backend execution charter

**Version:** 1.0 — 2026-11-23

**Coverage:** 22 Platform Admin modules, P0–P7

**Purpose:** provide one persistent source of instructions so Codex can finish the remaining Platform Admin backend work in sequence without requesting a new phase prompt each time.

> **Scope and evidence notice**
> This specification consolidates owner decisions from the project conversation and the provided P0/P1 handoff records. It is **not** proof that the live repository implements every requirement. The repository, its ADRs, actual contracts and tests are the technical source of truth. Resolve implementation discrepancies explicitly. Planned modules are not completed modules.

---

## A. Instructions to Codex — read this first

You are the primary backend engineer working in the existing **Mehran Planner** `planner-backend` repository. Read this file at the start of each resumed session and after any context compaction. Work directly in the existing codebase. **No subagents or delegation.** Do not write E2E tests. Do not fabricate tests, data, verification, or production readiness.

### A1. Continuous execution authorization

The owner authorizes **implementation, locally appropriate additive migrations, technical documentation, and verification** for the remaining Platform Admin modules, completing P1 and then P2 → P3 → P4 → P5 → P6 → P7 **in that order**, under the decisions below. This document replaces the need for separate phase-start prompts. Proceed to the next phase **only after** the previous phase has met local development acceptance or any narrowly scoped blockers have been explicitly recorded and isolated without weakening security. Do not silently skip required work or mark a partial phase complete.

This is a multi-phase charter for work performed while the Codex session is actively running. It is **not** authorization to claim unattended background execution, production deployment, or any future result not actually produced.

**Existing Git restriction remains:** Do **not** commit or push P1 or subsequent work without a new explicit owner authorization. P0 has already been committed and pushed. Record clean phase boundaries, changelogs and diff inventories to make later commits easy; do not undo earlier work. If the working-tree scale makes progress unsafe, stop at a safe checkpoint and request the specific required approval; never circumvent the Git restriction. Do not deploy, run production migrations or provision production credentials. Preserve the owner's unrelated `compose.yaml` edit exactly.

### A2. Essential work loop (repeat per phase)

1. Read `AGENTS.md`, this master spec, the latest progress log, relevant ADRs, Prisma schema, modules, API contracts and tests.
2. Reconcile actual existing implementations; do not duplicate or rewrite domain models.
3. Prepare a phase-scoped endpoint/permission/data/acceptance checklist. Distinguish already done, missing, and blocked.
4. Implement all approved missing backend functionality using real enforcement, not UI-only checks, mocks or placeholder success responses.
5. Add appropriate Vitest unit + PostgreSQL integration/contract/regression tests (no E2E).
6. Run applicable project quality gates; correct defects rather than weakening tests.
7. Update code, contracts, generated handoff, ADRs, this spec's implementation-status addendum and the running work record.
8. Mark a phase `COMPLETE — LOCAL DEVELOPMENT` only if mandatory acceptance checks pass; otherwise mark `PARTIAL`, list exact gaps, and continue safe independent work.
9. Continue into the next approved phase **without a new phase-start prompt** if its prerequisites are met and it remains safe under current Git restrictions.
10. Produce a factual final report at the end of the current work session, with completion matrix and next exact action. Do not promise background work.

### A3. Hard prohibitions / invariants

- Existing backend: NestJS modular monolith, PostgreSQL, Prisma, Better Auth, Zod, Vitest, existing jobs/storage/mail/audit adapters. Follow _actual repository pinned versions and conventions_, not speculative package upgrades.
- Admin APIs under **`/api/v1/admin/*`**; ordinary user/Workspace APIs retain their established routes. Admin frontend is a separate future application, **not** part of this backend charter.
- Separate Admin identity/session/authorization realm; mandatory MFA; default-deny; explicit granular capabilities; no unscoped content impersonation; no public admin registration; no wildcard privacy bypass.
- Owner transfer must preserve **ADR 0029**: successor **acceptance plus reauthentication** is mandatory even for Admin-initiated transfer.
- No `Guest`, Guest seats/roles, or Global Test Mode. Do not invent them.
- Until owner activates commercial monetization explicitly, implemented customer capabilities remain **free of commercial paywalls**; never block existing functions merely because a pricing table exists. Security/abuse/resource safety controls remain effective.
- Customer data must not be erased by downgrade, subscription expiry, suspension or maintenance mode. Controlled account/Workspace deletion is a separate P2 workflow.
- No destructive migration, automatic database reset, changes to existing ordinary auth schema without contract-safe migration, arbitrary shell execution from Admin, or user-content access inferred from `SUPER_ADMIN` alone.
- Preserve audit integrity, transactional boundaries, secret redaction, default-deny, session revocation, tenant isolation and concurrency safety.
- If a source-code requirement conflicts with this specification: identify exact conflict, preserve prior security guarantees, implement safe unaffected parts, and document the resolution needed. Do not silently invent product decisions.

### A4. Cross-cutting technical standards

- Domain-first: reuse `User`, `UserSettings`, Better Auth entities, `Space`, `SharedCustody`, `DomainScopeCustody`, `ContextAccess`, `ContextAccessInterval`, `ContextInvitation`, `OwnerHandover`, and existing owner modules **as actually implemented**.
- Do not mistake a logical Company-owned Team for an independent physical Space. Define clear addressing for Personal/Team/Company/Company-child scopes.
- Server-side enforcement at all real entry points, including refresh, signed shared mutations, file finalize, workers, and durable replay paths where relevant.
- Separate administrative action permission, target authorization, business eligibility, feature flag, entitlement, and quota enforcement; one does not replace the others.
- For sensitive writes: recent MFA/reauth as required, request id, actor, scope, reason, permitted target, idempotency or revision, safe before/after audit metadata, specific denied/failure audit evidence.
- Never expose MFA secrets, password/reset tokens, backup codes, private content (unless explicitly authorized by narrow P3/P4 rules), or internal-only audit/support notes.
- Additive Prisma migrations; safe database transactions, bounded pagination and searches; Zod input plus **strong response contracts**, OpenAPI compatibility/handoff synchronization.
- Use provider-based mail delivery, existing pg-boss and storage abstraction; use no unapproved provider or external analytics service.
- Time/expiry: explicit UTC instants with documented product-timezone presentation; expiry checks must not rely on background jobs alone.
- Retention and policy periods can be configurable; establish conservative, documented safe defaults without inventing jurisdiction gates.
- Operational controls must never serve as a route around security protections.

---

## B. Status baseline and phased roadmap

Verified current status, 2026-11-26: P0–P4 are published; P4 is
`13c45246bad4fc817bf96dd8f5023c6cb7e17585`. P5 is COMPLETE — LOCAL DEVELOPMENT,
with all three modules, frozen M119–M121 and documented final acceptance evidence.
P5 remains uncommitted/unpushed. Existing features remain commercially free;
automatic charging is unavailable. P6/P7 have not started and are outside this task.

**Historical baseline from the last user-provided Codex handoff (not a live inspection; superseded for P1 by the verified update above):**

- **P0 COMPLETE for local development.** Commit `651b0ecdf30e4a59215ad7aa8d56b5b4b4942026` pushed to `origin/main`. Production verification separately pending. P0 Admin MFA/session/RBAC/audit and two additive migrations implemented.
- **P1 PARTIAL, changes uncommitted.** Nineteen Admin management endpoints, dashboard/CSV, user discovery/account state/bulk management, workspace & membership reads. Reported passing 931 repository tests plus relevant integration suites. The repository must be rechecked rather than trusting counts for new work.
- **P2–P7 NOT STARTED** as of the handoff.
- A pre-existing `compose.yaml` owner edit must be preserved.

| Phase | Modules                                                          | Implementation order / dependencies                              |
| ----- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| P0    | 01 Admin Authentication & RBAC                                   | Already complete; retain and regression-test                     |
| P1    | 02 Dashboard; 03 Users; 04 Workspaces; 05 Memberships            | **Finish first**; ownership, audit and metadata foundations      |
| P2    | 06 Security; 07 Audit; 08 Privacy & Retention                    | Build controlled recovery/deletion and permissions               |
| P3    | 09 System Health; 10 Jobs; 11 Storage; 12 Backup & Restore       | Operational services + data lifecycle                            |
| P4    | 13 Email & Push; 14 Support; 15 Moderation                       | Mail, case-based rights and reports                              |
| P5    | 16 Plans; 17 Subscriptions; 18 Billing                           | Flexible commercial model; no paywall until activation           |
| P6    | 19 Feature Flags; 20 Product Configuration; 21 Platform Settings | Operational config, rollouts and maintenance                     |
| P7    | 22 Product Analytics                                             | Privacy-safe internal reporting, monetary metrics when supported |

**Dependency note:** P3 maintenance needs P6 policy/config architecture, and P5 entitlements need P6 flags kept separate. Build minimum internal interfaces earlier where necessary; do not prematurely implement the whole later phase. P2 removal/retention integrates with P3 backup recovery. P4 communications may build on earlier outbox and notification adapters.

---

## C. Final owner product decisions — module-by-module

### P0 / 01. Admin Authentication & RBAC — implemented baseline

- Platform Admin is a separate security realm from ordinary users and Workspace admins, with independent Admin identities/sessions.
- Mandatory MFA; strict Admin API allowlisting during auth; default-deny guard and explicit `RequireAdmin(permission)` or existing equivalent.
- Roles currently include `SUPER_ADMIN`, `SUPPORT`, `BILLING_MANAGER`, `SECURITY_REVIEWER`. Explicit capabilities only; unknown permissions denied.
- No default Super Admin, no public Admin sign-up, no Admin password/MFA bypass, no private content privilege by role alone.
- Preserve audit, rate limits, origin/CSRF, secure cookies, encrypted MFA storage, recent-MFA proof, session revocation and race protections.
- No P0 recreation; only compatibility/security regression work if later phases require it.

### P1 / 02. Dashboard

- Aggregate users (registered, verified/unverified, suspended), Personal/Team/Company workspaces, member counts, invitations and meaningful growth trends.
- Filters: today, last 7/30/90 days, valid custom range; clear UTC/timezone boundaries and metric definitions.
- Show supported security and operational warnings, usage aggregates when available; never fake missing metrics.
- Filter KPI payloads by explicit Admin permissions, not merely frontend visibility.
- CSV export of permitted report data with distinct permission, output-size bound, formula injection protection and audit.
- P1 Dashboard aggregates are not P7 event analytics; maintain shared metric definitions.

### P1 / 03. Users

Owner-approved final diagnostics extension (2026-11-27, ADR 0081):

- Filter registration by independent verification, suspension and recorded-login
  status, registration date and complete/partial/unknown login history. Show real
  registration, current-email verification and first/last recorded successful
  login timestamps. Lifetime first login is nullable unless capture is complete.
  Missing historical evidence is UNKNOWN; active sessions prove neither never
  signed in nor lifetime completeness.
- Audited verification resend requires its explicit permission, recent MFA,
  current revision, reason, idempotency and rate limits. Generate a fresh proof
  through the existing durable worker; recheck current recipient and authority.
  Existing exceptional manual verification and recovery controls remain binding.

- Paginated/searchable authorized identity/profile, account status, metadata, membership associations, aggregated usage without private user content.
- Admin can suspend for fixed term or indefinitely, with **public reason** and separate confidential note; invalidate all active ordinary sessions and deny new login/refresh/protected mutation. Workspace owned by user **does not** automatically suspend.
- Auto-expiry and manual reactivation; old sessions do not return after reactivation.
- Allowlist profile updates only; no direct Admin editing of password, MFA, secret credentials. Manual email verification permitted **only** as exceptional action with distinct permission, reason, recent MFA and full audit, on exact current email; must not create a second verification source of truth.
- Admin may initiate standard recovery messages and revoke sessions; never view reset tokens or set password.
- Bulk account suspend/reactivate with preview, capped batch size, exact target confirmation, stale revision checks, per-target outcomes, idempotency and audit.
- Actual account deletion belongs to P2 with recovery workflow, not P1.

### P1 / 04. Workspaces

- Read/search Personal, independent Team, Company and **logical Company-owned Team** scopes correctly, with owner, status, member count, timestamps and permitted aggregates.
- Admin may create Team/Company with an existing eligible owner via existing domain service; Personal provisioning remains automatic.
- Admin may edit allowlisted public Workspace metadata with reason, audit and owner notification.
- Temporarily or indefinitely suspend Workspace with public reason and internal note; normal members retain authorized **read-only** visibility, but resource mutations are rejected at backend/domain gateways. No data/ownership deletion. Suspension expires automatically or is lifted by Admin; restoring access does not restore revoked sessions.
- Owner-account suspension does not automatically freeze owned Workspace.
- Admin-initiated ownership transfer uses the existing `OwnerHandover`/ADR 0029 workflow: successor must **explicitly accept and reauthenticate**. Never permit direct privileged bypass, orphan ownership, or atomicity breach.
- Workspace type immutable. Workspace deletion belongs to P2. Platform creation caps are later policy; existing abuse limits stay active.

### P1 / 05. Memberships

- Paginated member/invitation discovery and filters by user, Workspace, role and status; accurate Owner presentation and pending/canceled/expired invitation aggregates.
- Admin may initiate add, remove non-owner members, valid role change, invitation cancel/resend under existing acceptance and signed-control rules.
- No bypass of invitation acceptance; no removal of last owner; owner removal requires approved transfer; no fabricated ordinary-user or Admin membership.
- Company root/child contexts, quotas already in domain, dependencies, audit/outbox, concurrency, replay and actor attribution preserved.
- Show active members and pending invitations; **commercial Seat enforcement belongs to P5**; Owner consumes a Seat when commercial Seat rules are active.
- No Guest role or Guest invitation.

### P2 / 06. Security

- Authorized operations: revoke all/selected sessions, block login, require safe account recovery, audit incidents; preserve P1 suspension logic.
- Highly sensitive operations require Admin reauthentication; **selected most-sensitive actions require a different appropriately authorized second Admin approval**. Define explicit approval catalog, expiration and non-self-approval.
- Admin MFA-loss recovery through controlled identity/security review and audit, **never through an unaudited ordinary route or quiet MFA disable**.
- Login/rate-limit thresholds configurable only above enforced minimum security floor; manual blocking supported.
- **No Admin IP allowlist** (owner explicitly rejected it). Keep safe trusted-proxy IP parsing and rate limiting.
- Rule-based security alerts via existing configured channels, without sending secrets.

### P2 / 07. Audit

- Capture sensitive admin, security and control-plane events with expandable event catalog, actor/target, reasons, request correlation, safe before/after, result, timestamp.
- Read permission separated by event category/sensitivity; no blanket audit access to every Admin.
- Search/filter and **CSV export** with bounded scope, separate permission, safe escaping; JSON audit export not required.
- Configurable event-type/category retention, tamper-resistance/integrity controls, controlled expiry. Never silently rewrite or delete evidence to satisfy account deletion; minimize personal data in audit payloads.

### P2 / 08. Privacy & Retention

- Export user **personal data, their tasks and projects they own/have authorized export rights to**, respecting Team/Company tenant ownership and access boundaries. No sweeping export of every Workspace just because they are a member.
- Export as ZIP containing JSON and related authorized files; additional compatible formats optional later.
- User or permitted Platform Admin may initiate confirmed, audited deletion requests; policy-driven recovery period; delete request state, retries, status history and outcome.
- Before user deletion, resolve ownership of Team/Company by transfer or formal disposition. Team/Company deletion can be initiated by owner or permitted Admin with sensitive confirmation and dependency review.
- After recovery window, controlled deletion from active/operational data, without silent immediate irreversible purge; separately manage retained audit evidence.
- Backup retention independent and configurable, with documented restore-time **deletion replay/tombstone** or equivalent protection so erased operational data is not reintroduced.
- Retention policy updates require sensitive permission, impact preview, audit, and guard against accidental mass purge. No compulsory jurisdiction selection/legal certification gate in product architecture.

### P3 / 09. System Health

- Display real health/readiness and dependencies of existing API, PostgreSQL, queues, storage, delivery services, latency, errors, throughput and available service indicators.
- Allow permissioned health checks and **allowlisted safe repair actions only**, with audit; no generic shell/SQL command execution from Admin.
- Configurable alerts by severity, threshold, channel, dedup/repeat and silencing; incident history with start/recovery, cause/actions and manual incident notes.

### P3 / 10. Jobs Management

- Bounded inspection of all supported job states, type, schedule, attempts, timestamps and sanitized errors.
- Retry/Cancel/manual run for **explicitly allowlisted and safe** job kinds only, permissioned, audited, idempotent and attempt-limited; no blind re-execution of payment/deletion/restore actions.
- Configurable schedules for approved recurring jobs, validated before publish; retention by job kind, result and sensitivity.

### P3 / 11. Storage Management

- Aggregated usage overall/by Workspace/file type/time trend without browsing content by default; configurable infrastructure and future quota-adapter compatibility.
- Storage exhaustion: warning, optional grace, or block new uploads, **never auto-delete customer files just because a quota is exceeded**.
- Safe detection/preview/cleanup of orphan and temporary blobs with retention, audit and no live-reference deletion.
- **Final owner exception to P0 privacy default:** `SUPER_ADMIN` may view/download user private files **without an additional case-specific approval**, and every access/download is audited. Implement a **separate explicit private-file capability**, tightly scoped API, strong target validation, secure streaming and non-bypass of tenant metadata checks; never convert `SUPER_ADMIN` into unrestricted access to tasks/chats/other private content. Do not secretly grant other roles this ability. This rule supersedes the earlier default restriction **only for private file view/download**. Audit actor, file target, reason if available, timestamp and outcome. Never log raw file bytes. File actions must obey relevant virus/scanning/retention/storage safety rules. If existing source policy directly contradicts the approved exception, record/update the ADR explicitly rather than weakening all content guards.

### P3 / 12. Backup & Restore

- Configurable schedule and authorized manual backup; capture PostgreSQL, file objects, necessary recoverable settings, with key/secret custody separately controlled.
- Encryption, versioned retention, off-host copy, checksums and periodic restore drills with recorded evidence.
- Restore is a privileged controlled workflow with **second authorization/approval** and runbooks; do not implement arbitrary live production restores through a normal Admin endpoint.
- Reconcile with P2 deletion/tombstones to prevent revival of removed data after restore.
- Maintenance/restore interop must keep safe status and emergency control available if app/database unavailable.

### P4 / 13. Email & Push

Owner-approved final diagnostics extension (2026-11-27, ADR 0081):

- Unified authorized operational metadata across registration/recovery/email
  changes, all six invitation kinds, support, security, communications and
  existing system mail. Include recipient, category, typed owner reference,
  known creation/attempt/completion times, attempt counts/retry schedule, safe
  failure code and sanitized provider reference. No bodies, secrets or links.
- Bounded search/filter/cursor pages distinguish queued, processing, SMTP
  accepted, failed, bounced and unknown from actual evidence. Legacy SENT does
  not establish SMTP acceptance; sinks are separate. Inbox delivery remains
  unknown without authoritative receipts. No bounce feed is invented.
- Explicitly authorized retries use existing owner workflows and fresh proofs,
  never replay expired/consumed credentials. Preserve preferences, verification,
  anti-enumeration, throttling, audit, privacy, source deletion and retention.

- System, direct, segmented group and platform-wide communications.
- Channels: existing SMTP email, in-app notifications, device Push where valid subscription/device capability exists; never falsely claim Push works absent implemented provider/device registration.
- Admin-managed approved templates with preview, versioning, allowlisted variables, user-locale selection and fallback language.
- Segments: specific users, eligible filter results, Workspace members and global audience with validation.
- Broadcast needs target preview, test send, capped dispatch, audit; selected sensitive broadcasts require distinct second approval.
- Immediate/scheduled dispatch and cancellation before send; user preference by type/channel except essential security notices.
- Configurable retries, dedup/idempotency, per-recipient delivery evidence, safe errors and aggregated reporting.

### P4 / 14. Support

- Ticket system for **any registered user**, optionally context-linked to their relevant Workspace; in-app creation/replies and email replies using verified inbound-processing infrastructure when available.
- States: New, Open, Waiting for User, Waiting for Support, Resolved, Closed, Reopened.
- Configurable queues, assignee, category, priority, SLA deadlines/late notifications; **manual** transfer to another operator, no mandatory multi-operator workflow.
- Support may access **ticket contents, permitted account metadata, and material supplied to that specific ticket**. For other private material, **user must attach/provide it themselves**; no automatic privileged browsing.
- Internal notes separated securely from public replies; controlled reopen window, satisfaction feedback, archiving and retention.

### P4 / 15. Moderation

- Reportable accounts, Workspaces, abusive behavior, and actual product resources with report integration; report submitters include users, permissioned Workspace owner/admin and Platform Admin.
- Report: category, description, submitted evidence, priority, handling history.
- States: New, Triaged, Investigating, Action Taken, Dismissed, Appealed, Closed.
- Authorized actions: warnings, limited restrictions, P1 suspension through its own permissions, escalation to P2 Security through its own permission.
- **Final owner decision:** Moderator with the specific moderation permission may inspect **the exact reported private item and evidence relevant to that case** with Audit. No general content search, unrelated item access or widening to all customer data.
- Publicly explainable case outcome separate from confidential internal details. Appeal within policy-configurable deadline, reviewed by a different reviewer from original decision-maker. Anti-spam, deduplication and manual review before penalties. Retention by case type/outcome.

### P5 / 16. Plans

**Commercial policy:** business/revenue model is not yet fixed; never hardcode Free/Pro/Enterprise as mandatory plan structure. All currently available features remain free of commercial restrictions until separately activated by owner.

- Admin creates/edits/archives/plans and flexible **feature catalog, quotas, versioning**, separate Personal/Team/Company eligibility or offers, public/private/targeted listings, pricing-page visibility, Admin-only activation.
- Plan versions: at publish choose new subscribers only or current + new **for features/quotas**. Price increases default to **new purchases only**; existing renewals change only via separately configured and notified renewal-price policy.
- Custom per-customer feature/limit overrides without editing base plan; lifetime until revoked, until specified date, or until subscription term end.
- Entitlement resolution: base allowance + additive purchased/granted extensions, **final Admin override cap wins**. Do not equate flags to entitlements or RBAC.
- Add-ons may contain features, capacity or both, individual duration/price/eligibility, manual/complimentary grants. Retain add-on and purchase history on plan changes; current paid term is not retroactively refunded. If new plan already includes an identical feature, suppress duplicate **future renewal** charges while that overlap exists; do not silently delete records.
- Multiple price options per plan: flexible term, one-time or negotiated, different currencies, per-customer price, complimentary, active/inactive. No full formal enterprise contract-management module (but per-customer negotiated prices are allowed).
- On downgrade/expiry, preserve all data; configurable grace/read-only/mutation restriction rules; do not delete members/projects/files to enforce new limits. Security rules always remain effective.

### P5 / 17. Subscriptions

- Subscription belongs to **one** Personal or Team/Company Workspace/account; one active **base plan** per scope, add-ons independent. No transferring subscriptions between Workspaces, no implicit Personal-to-Company benefit sharing.
- Team/Company Owner buys/is granted plan, invited authorized members use that Workspace's entitled features without each buying a personal plan. Owner counts as Seat when paid-seat quotas are enabled. No Guest.
- Manual Admin activation for gift/complimentary or **externally paid** purchase, with payment source/status independent from entitlement activation.
- Activation now or scheduled in future. Term may be fixed or non-expiring when manually granted. Manual customer renewal, future auto-renew only with valid payment method, manual Admin renewal, or fixed end/no renewal. **No automatic paid charging until owner explicitly enables online payment.**
- Midterm change: immediate with calculated unused credit, immediate without credit, or scheduled at term end; for manual change Admin selects. Maintain plan/add-on and payment history.
- Cancel by customer = stop future renewal, retain access to paid term end. Admin can choose immediate or end-of-term. Refund separate.
- Expired subscription can be renewed/restored without data loss; previous terms preserved. Expiry leaves eligible content viewable and payable operations read-only while free independent capabilities remain available.
- **Pause only by Admin**; at Pause choose whether expiry clock freezes and extends remaining term at Resume, or clock continues. Persist precise reason, chosen clock policy, resume and audit history. No implied refund or automatic add-on cancellation.
- Configurable pre/post expiry notifications; failed-payment retry counts/intervals, grace, user access during grace, and read-only after it. Automated monetary retries only when online charging is actually activated.
- Complimentary subscriptions have same features as paid, different grant/financial origin. Customer sees own plan/renewal/payment history but never internal admin notes.

### P5 / 18. Billing

- Configurable payment method categories: manual, transfer, crypto, future online provider; gradual integrations and no synthetic payment-success claims.
- External payment confirmation with privileged approval, reference ID, optional evidence, audit; avoid recording gift as successful monetary payment.
- Invoice lifecycle: Draft, Issued, Paid, Voided; unique identifiers/history. **No installment or intentional partial-payment offering.** Customer account credit may arise from midterm changes and overpayments; credit is _not_ a withdrawable wallet.
- **Final owner decision superseding earlier prohibition:** issued invoices **including paid invoices** are correctable. Correction must create a **new document version AND associated financial adjustment document**, preserving the earlier invoice version, original payment records and audit. Never silently rewrite settled monetary history. Recalculate outstanding balance/credit using ledger entries and protect against double booking.
- Manual Refund recording for now; no auto refund. Complete promotions/coupons: public/private, percent/fixed, dates, use counts, eligibility and combination policies.
- Multi-currency prices/invoices; **each financial document has one fixed currency**; do not silently net cross-currency amounts without an explicitly defined FX process.
- Detect duplicate/overpayments using credible provider/reference identities and idempotency; route to Admin-reviewed credit or refund.
- Owner and explicitly financial-authorized Workspace operators can see amounts/invoices; ordinary members can see entitlement status, not financial amounts.
- Advanced contracts/enterprise workflow **not** implemented; negotiated individual prices allowed.
- Billing policy supports tax/fee rule definitions without requiring a fully automated jurisdictional tax engine. Debts may be written off by highly privileged Admin with bounded policy and adjustment/audit. Non-payment access behavior follows approved failed-payment/grace rules.
- Outside payment may be recorded with receipt and linked subscription **without a formal invoice**, but not without a financial record.
- Reports: payment, receivable, recognized/relevant revenue measures, refund, plan/add-on, MRR/ARR/conversion; define metric eligibility, refunds and currency partitions precisely; free grants/test entries are **not revenue**.
- **Before monetization activation:** plans, pricing, complimentary access, manual grant and external-payment recording may be available, but automatic payment collection/paywalls stay disabled until explicitly enabled.

### P6 / 19. Feature Flags

- Targets: platform, Workspace type, specific users/Workspaces, segments; deterministic percentage/step rollout with stable bucketing.
- Explicit, inspectable precedence and **effective flag evaluation** for a target. Time-based activation/expiration with return to prior version/value.
- Emergency kill switch with distinct capability, strong audit and fast backend enforcement.
- Draft → Preview → Publish → rollback, versioned and audited. Rollback generates a new version; no evidence/history rewriting.
- A feature flag alone **does not override** RBAC, billing entitlements, security controls or infrastructure safety.

### P6 / 20. Product Configuration

- An **allowlisted** typed configuration catalog: supported upload limits, default values, module rules, product settings; configurable platform-wide, by Workspace type and targeted override with explicit precedence.
- Validate impact, data compatibility, safe migration behavior and forbid auto-deleting existing data merely due to changed limits.
- Security-critical and infrastructure secrets remain outside general configuration; sensitive allowlisted settings use distinct permissions/approval.

### P6 / 21. Platform Settings / Maintenance

- Global settings include locale, notification policy, approved module/system policies and maintenance.
- **Maintenance Modes (all approved):** (1) advance scheduled notice; (2) read-only; (3) full maintenance. Platform-wide or scoped to modules/operations. Manual/scheduled start/end with multilingual message, countdown to estimated end, progress/status and last update.
- Server-side enforce read-only/503 as appropriate; never just hide UI. Critical admin/operator control and status must remain available **independently of failed database/restore path**, where the platform topology allows it.
- Health/readiness gates before reopening after restore. Countdown reaching zero **must never automatically reopen** an unhealthy system; instead show overrunning/in-progress state.
- Settings changes: Draft/Preview/Publish immediately or scheduled, version+diff+actor+reason+outcome, rollback if safe, safe defaults, controlled emergency recovery and reliable cache invalidation/client-version compatibility.
- Sensitive setting updates require granular permission, recent reauth and second approval where classified highly sensitive. Explicit allowlist, no arbitrary infrastructure mutation.

### P7 / 22. Product Analytics

- Internal product analytics initially; no external vendor integration until later explicit approval.
- Growth, meaningful activity, engagement, retention, feature adoption, conversion, cohort, funnels, navigation aggregates and subscription economics when real data exists.
- DAU/WAU/MAU based on **defined meaningful product events**, not mere page loads/login. Versioned allowlisted event catalog and category enable/disable.
- Segmented aggregates by Personal/Team/Company, eligible cohorts and allowed segments; user navigation events permitted but **no session replay, screenshots, typed/form content, private task/journal/message data**.
- Configurable funnels and KPI formulas from approved events only; cohort by registration, Workspace type, first feature use and return periods.
- Periodic analytical refresh (e.g., hourly) — not mandatory real-time event dashboards.
- Plan/Add-on performance, MRR/ARR, churn, free-to-paid, pricing comparison by **currency** with clear revenue definitions; omit unavailable metrics instead of fabricating zero or cross-currency comparisons.
- Compare P6 Feature Flag cohorts and results; **no separate A/B experimentation creation engine**.
- Date/Workspace/cohort/feature/plan filters, CSV/JSON and scheduled reports with permissions, audit and bounded delivery.
- Granular product/financial/export/sensitive analytic capabilities; privacy minimums, small-cohort suppression, retention for raw events vs aggregates coordinated with P2.

---

## D. Explicit cross-module priority and interaction rules

1. **Authentication / safety / RBAC > scoped content permissions > operational maintenance > entitlement / product rules > presentation.** Implement precise precedence by action; this is a safety principle, not permission to blanket-block approved read-only access.
2. P3 Super Admin **private-file-only exception** is the sole owner-approved expanded default content right. It must not give access to every note/task/chat. P4 Moderator's exact case-content right is a different case-scoped capability. Support only sees user-supplied case content.
3. Owner-initiated and Admin-initiated transfers both retain successor acceptance + recent reauthentication (ADR 0029).
4. User suspension does not suspend owned Workspace. Workspace suspension requires backend read-only enforcement. Maintenance read-only may independently freeze mutations. Revoking any session cannot resurrect it.
5. One active base plan/scope + independent add-ons; additive grants + Admin final caps; no commercial paywall now. Flags are not subscriptions.
6. Financial source-of-truth is the append-only accountable ledger/version history; corrective edits create linked adjustment and document versions.
7. Repeated operations (retry/restore/notifications/payment records) need replay/idempotency protections and safe failure behavior.
8. Deletion/restore must reconcile P2 tombstones with P3 backups. No physical purge on plan expiry or suspension.
9. Analytics may report only events that have actually been captured under approved policies; privacy min-group and retention enforced before export as well as UI.
10. Maintenance timing is advisory: reopen only after health check and authorized release; emergency fallback must not depend exclusively on the database undergoing restore.

---

## E. Current P1 gap closure — **immediate priority**

Start here. Read `docs/platform-admin-p1-work-record.md` from the repo and verify against source, not just this copied status.

Reported incomplete work:

1. Admin Team/Company creation, safe owner attribution, public metadata editing, notifications.
2. Owner transfer initiation integrated with `OwnerHandover`; successor acceptance + reauth mandatory under ADR 0029.
3. Membership add/remove/role updates, invitation cancel/resend with `ContextAccess`/`ContextInvitation`, signed shared control, Company root/child binding, concurrency, outbox and audits.
4. Correct logical Company-owned Team discovery, counts and independently scoped suspension; **do not model as physical Space**.
5. Membership status/role filters, owner rendering, derived expired invitations, per-metric permission tests.
6. Comprehensive suspension enforcement: signed shared mutation, file finalization, in-flight writes, jobs/replay; owner suspension independent from Workspace state.
7. Strong Zod response schema/OpenAPI and frontend handoff; durable recovery dispatch; user/owner notifications; configurable bulk upper bound; full audit before/after and idempotency evidence.
8. PostgreSQL tests of the above plus compatibility of ordinary Planner APIs; full quality gates.

Do not present 19 earlier endpoints and passing tests as completion of these missing items. Do not commit/push this phase without explicit owner authorization.

---

## F. Acceptance matrix and required handoffs

**For each module** create a traceability record with: requirement ID, approved owner rule, existing implementation location, endpoint/permission, schema/migration, focused tests, negative/abuse tests, completion status, link to evidence. Inadequate implementation is `PARTIAL`, not `COMPLETE`.

**For each phase** report:

- What already existed / what was added / what was deferred.
- Complete route/method inventory under `/api/v1/admin/*` and **role–capability** matrix.
- Data model/migration and owner-domain invariants; check existing ordinary API compatibility.
- Audited administrative mutations; security/tenant privacy negative tests.
- Concurrency, idempotency, expired sessions, revocation, versioning and failure-case coverage.
- Actual commands and results: unit tests, relevant PostgreSQL integration, typecheck, lint, build, architecture, Prisma validation, Better Auth schema compatibility, OpenAPI generate/check, formatting, `git diff --check`.
- No E2E tests. Distinguish skipped production TLS/proxy/browser, off-host restore drills, production data migration and live provider tests from local verification.
- Accurate Git status, changed/untracked files and confirmation unrelated `compose.yaml` was preserved.
- `COMPLETE — LOCAL DEVELOPMENT`, `PARTIAL`, or `BLOCKED` with exact reasons. No claiming deployment readiness merely from passing tests.

**Phase-specific acceptance highlights**

| Phase | Must be true before declaring local completion                                                                                                          |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1    | Four modules have approved real operations, logical Company-owned Team coverage, ADR 0029 acceptance, read-only enforcement, strong contracts and tests |
| P2    | Sensitive approval/recovery and audit privacy controls; working export/delete state machines, backup tombstone integration contract                     |
| P3    | Safe operational controls; authorized file exception audited; non-destructive quota, backup/restore runbooks and controlled adapters                    |
| P4    | Durable targeted communication + user preferences; scoped support; case-bound moderation and appeal tests                                               |
| P5    | Flexible plan catalog and engine, grant/add-on/seat rules, financial document versions/adjustments, **no active paywalls/online charging**              |
| P6    | Effective targeted flags/config, rollback, kill switch, 3 maintenance states with true backend enforcement and safe recovery path                       |
| P7    | Internal event catalog, meaningful activity/retention/funnels, privacy constraints, financial metric correctness and report exports                     |

If a phase has production-only features impossible to simulate locally (for example production TLS ingress or actual provider connectivity), clearly separate _implemented local contract_ from _deferred production release verification_.

---

## G. Implementation progress record — keep current

Create and maintain `docs/platform-admin-implementation-progress.md` in the repo. At each significant checkpoint append:

- date/time, phase/module, done vs pending,
- exact files/migrations/contracts touched,
- test commands + quantitative results,
- unresolved decisions / risky assumptions,
- next specific safe action,
- Git state and outstanding commit approvals.

Also update `PLATFORM_ADMIN_OVERVIEW.md` and this document's `Status baseline` when actual code status changes. Keep decision history and superseded choices transparent.

### G1. Decisions already settled: do not re-ask

- Fixed vs dynamic plans: **dynamic**, commercial model undecided.
- Shared Team/Company subscription and owner-counted Seat; no individual subscription required for each member of that Workspace.
- No Guest, no Global Test Mode.
- Existing features free until explicit commercial activation.
- Per-customer overrides with lifetime/date/term scopes; additive grants + Admin final cap.
- Add-on persists after plan change; overlap suppresses duplicate future renewals.
- Plan-change versions/new-vs-existing propagation; current-customer price increases separately communicated.
- Manual complimentary and externally paid grants, multi-price options, no online paid auto-renew now.
- Read-only after expiry; no loss of data; customer cancellation at term-end, Admin may cancel immediately.
- Admin-only Pause with per-action expiry clock choice.
- Invoice including paid correction = new version + associated financial adjustment, preserving prior artifacts.
- Owner transfer successor acceptance + reauth.
- Super Admin private-file viewing/downloading allowed without **additional approval**, with Audit and dedicated scope.
- Moderator case-specific reported material only; Support user-supplied case material only.
- Maintenance: three modes, countdown, backend enforcement, controlled reopen.
- Product Analytics: internal, periodic, no session replay, no independent A/B engine.

### G2. Engineering-policy details to resolve during implementation, not new commercial strategy

- Safe configurable defaults for recovery windows, audit retention, alert thresholds, quotas, retry limits, batch sizes, max report size, small-cohort privacy thresholds, maintenance health gates.
- Classification list for two-Admin approval under P2/P3/P4/P6, ensuring non-self-approval and emergency operator recovery.
- Structured security exceptions for P3 private-file access; preserve exact scope and audit.
- Pause billing interplay, add-on term boundaries and renewal suppression implementation without charging twice.
- Currency-specific credit/adjustment handling, contract-safe invoice versioning and revenue definitions.
- Push/device registration, inbound mail, backup off-host integration and emergency maintenance topology dependent on available adapters; do not invent live deployment outcomes.

Where two approved rules apparently conflict, select the narrower interpretation that preserves **both** whenever possible; otherwise document exact alternatives and stop only the affected high-risk operation rather than guessing or dropping a module.

---

## H. Copy/paste invocation prompt for Codex

> Read `PLATFORM_ADMIN_MASTER_SPEC.md`, `AGENTS.md`, `PLATFORM_ADMIN_OVERVIEW.md`, `docs/platform-admin-p1-work-record.md`, relevant ADRs and the actual source. Treat the master spec as the approved product decision register and the repository as the technical source of truth. Start from the current **uncommitted partial P1** implementation, finish P1, then continue through P2, P3, P4, P5, P6 and P7 sequentially without requiring a fresh phase prompt. Enforce all security and domain invariants. Work backend-only, no subagents, no E2E, no invented data, no destructive migrations, no production deployment. **Do not commit or push P1+ without my explicit permission**, and preserve my `compose.yaml` changes. Run appropriate quality gates, maintain `docs/platform-admin-implementation-progress.md`, and provide truthful phase acceptance evidence. If blocked, complete independent safe work and describe the narrow blocker; do not silently mark incomplete work complete or ask me to repeat already settled decisions.

---

**Final reminder:** This master spec authorizes a structured backend implementation sequence; it does not override actual codebase safety restrictions, commit/push limits, or operational release requirements.
