# Consolidated Platform Admin backend handoff: P0–P7

2026-11-26. P0–P6 are published. P6 is
`125cd98d36aacdea15a3ed120a220f86775d5a56`, verified on origin/main. P7 implementation
and consolidated local acceptance are COMPLETE; P7 is uncommitted and must not be
published without separate approval. This review reuses phase evidence and the
final P6 full regression baseline; it does not rerun every historical phase gate.

## Requirement coverage and source ownership

| Master Spec module       | Implementation / authority                                                                                              | Contract and retained verification evidence                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 01 Authentication/RBAC   | platform/admin, separate Better Auth realm, default-deny guard, persisted MFA, operator provisioning                    | ADR 0071; ordinary auth compatibility; P6 complete regression baseline                   |
| 02 Dashboard             | admin-management, permission-scoped metadata metrics and bounded CSV                                                    | P1 work record, dashboard unit/PostgreSQL cases                                          |
| 03 Users                 | admin-management plus Account public facade, account state/bulk/session controls                                        | P1 27-route inventory and authorization/concurrency cases                                |
| 04 Workspaces            | admin-management plus Spaces/Teams/Companies facades, logical child identities                                          | P1 owner-consented custody and suspension matrices; ADRs 0029/0043/0072                  |
| 05 Memberships           | existing ContextAccess/Invitation/Handover, signed admission and user consent                                           | P1 current membership, revocation, transfer and delivery evidence                        |
| 06 Security              | platform/admin, two-person critical approval, recovery, login restrictions and alerts                                   | ADR 0073; P2 security/audit PostgreSQL suite                                             |
| 07 Audit                 | category/sensitive permissions, immutable detached evidence, filter and CSV, reviewed retention                         | P2 work record and migration evidence; later control-plane regressions                   |
| 08 Privacy/Retention     | admin-management and existing account/shared lifecycle, ZIP export, dependency review, tombstone replay                 | P2 work record; Personal lifecycle regressions; P7 event portability/erasure integration |
| 09 Health                | platform/operations, real dependencies, counters, safe repairs and incidents                                            | P3 work record and operational PostgreSQL regressions                                    |
| 10 Jobs                  | existing pg-boss plus operations job allowlist, bounded state/retry/cancel/schedules                                    | P3 work record; normal durable worker retained through P7                                |
| 11 Storage               | existing StoragePort/private volume, usage/quota/orphan review, dedicated Super Admin file exception                    | P3 source-owner streaming/scanner/custody tests; no generic content browsing             |
| 12 Backup/Restore        | P3 operator console and approved adapters, signed controls, two-person restore and deletion replay                      | P3 local rehearsal/offline evidence; physical deployment drills remain below             |
| 13 Communications        | admin-engagement, versioned templates, targets, previews, approvals, durable channel delivery/preferences               | ADR 0076; P4 27-case focused suite and corrected full checkpoints                        |
| 14 Support               | admin-engagement, user-supplied ticket material, queue/SLA/replies/internal-note separation, verified inbound boundary  | P4 work record and current contract; trusted inbound activation deferred                 |
| 15 Moderation            | admin-engagement, exact case-resource disclosure, audited decisions, different-reviewer appeals                         | P4 report/content/access/appeal and retention tests                                      |
| 16 Plans                 | admin-commerce, dynamic versioned catalog/allowances/prices/add-ons/overrides                                           | ADR 0077; P5 catalog and effective-entitlement tests; enforcement remains off            |
| 17 Subscriptions         | admin-commerce, scope-bound subscriptions, immutable terms/shifts/closures and notices                                  | P5 29-case suite and populated M119–M121 upgrades                                        |
| 18 Billing               | admin-commerce, exact monetary ledger, corrections/document versions, manual payments/refunds/credit/promotions         | P5 financial/concurrency history; P7 reuses this calculation owner                       |
| 19 Feature Flags         | platform/configuration, typed targeting, stable rollout, preview/publish/rollback/kill                                  | ADR 0078; P6 24-case PostgreSQL suite and immutable M122/M123                            |
| 20 Product Configuration | platform/configuration, allowlisted values with actual request/domain/file/job enforcement                              | P6 runtime, concurrency and ordinary contract regression evidence                        |
| 21 Platform Settings     | platform/configuration plus P3 independent control/recovery, three maintenance modes and readiness-gated schedules      | P6 offline built operator smoke and full regressions; no countdown-based release         |
| 22 Product Analytics     | admin-analytics, transactional metadata, cohorts/KPIs/funnels, owner-facade financial/flag reporting, reports/retention | ADR 0079; P7 work record and final acceptance evidence                                   |

The reused local baselines are P1 936 repository / 1,231 PostgreSQL cases; P2 944 /
1,251 with documented affected corrections; P3 952 / 1,272 with documented affected
corrections; P4 999 repository plus complete checkpoint/affected PostgreSQL results;
P5 1,008 repository and its corrected runtime/scope suites. The final P6 complete
runs passed 1,018 repository and 1,362 PostgreSQL cases, superseding the older
baseline for shared functionality. Each record states the conditional live scanner
skip and actual command outcomes; no failed checkpoint is described as passing.

## API and frontend integration

All Admin APIs use `/api/v1/admin/*`. Authoritative operation/response/permission
definitions are the exported `admin*Routes` and generated
[OpenAPI](api/openapi.json), mirrored to [frontend handoff](frontend-handoff/openapi.json).
P1/P2/P3 work records contain full route inventories; P4/P5/P6/P7 have dedicated
frontend handoffs. Build the future Admin application against these contracts,
including current session/MFA, Origin, revisions, idempotency keys and bounded
pagination. Do not infer permissions from menu visibility or a Planner session.

Ordinary APIs remain under their established namespaces: account ZIP/export/deletion,
user-owned support/moderation, Workspace commercial catalog/history/renew/cancel,
authorized effective configuration and public maintenance status. P7 adds only the
authenticated allowlisted navigation-collection route. Existing Planner contracts
remain protected by compatibility snapshots; no frontend integration is implemented.

Render distinct approvals and impact previews as actual server workflows. P1
ownership succession still requires successor acceptance and reauthentication;
Admin authority cannot replace ordinary consent. Read-only/suspension, custody,
retention, restore and entitlement fences remain separate. Maintenance estimates
are advisory. No Guest or global test mode exists.

Analytics frontend requirements are detailed in [P7 handoff](frontend-handoff/PLATFORM_ADMIN_P7.md):
null/suppressed values, explicit denominators, UTC boundaries/coverage, current
flag/plan cohort labels, currency panels with integer strings, report polling,
artifact expiry and schedule cancellation. Do not present correlation as an A/B
experiment or historical MRR as available. No private-content analytics UI exists.

## Roles and permissions

`SUPER_ADMIN` receives the explicit closed Admin capability catalog; it is not a
wildcard for ordinary work content. `SUPPORT` has approved account metadata/control
and ticket rights; `SECURITY_REVIEWER` has security and exact moderation-case rights;
`BILLING_MANAGER` has billing/subscription and P7 financial-analytics read rights.
Product analytics/configuration/export/sensitive reads default to Super Admin only.
The exact current mapping is `platform/admin/admin-policy.ts` and route permission
metadata. Ordinary Space/Workspace roles and commercial entitlements are independent.

The only expanded default private-content rights remain the audited, dedicated P3
Super Admin file capability and P4 exact reported-item capability. Support sees only
user-supplied case content. Analytics and financial reports expose bounded aggregates.

## Runtime and release dependencies

Keep the pinned NestJS/TypeScript/Prisma/Better Auth/Zod/Vitest stack, local Windows
PostgreSQL development and future self-hosted Docker Compose. No new dependency,
hosted database, Redis, paid analytics service or financial provider is introduced.
API and existing worker use PostgreSQL/pg-boss, private StoragePort volumes, SMTP
and implemented Push adapters. Admin/operator setup, MFA, trusted origins/proxy
settings, signed independent controls, encryption/evidence keys and retention
policy provisioning follow the existing operational runbook. Do not publish keys.

Migrations are controlled one-off deployment work, never startup schema mutation.
P7 adds M124–M126; P0–P6 bytes/checksums and owner compose are preserved. The new
metadata FK catalog is 1,329 references; source erasure invalidates cached analytics
and P2 export/deletion includes the user's analytics metadata. Restore replay must
complete before privacy quarantine is released. Finances and audit history retain
their separate approved policies.

Deployment-only verification remains: Docker image/start/persistence/non-root and
private network, real HTTPS/proxy/firewall and production origins, live SMTP/Push/
trusted inbound/scanner, key custody and signed operator provisioning, off-host
encrypted PostgreSQL+file backups and physical restore/deletion replay drills,
production migration checksum preflight, capacity/alerts and actual traffic switch.
The existing P3 record's historical M084 local test-ledger discrepancy is not repaired
by rewriting migration bytes; preflight must reconcile target environment history.
No deployment, live charging, external delivery or production readiness is claimed.

## Contract limits

The owner-approved custody direction and unsafe-graph rejection limits in ADR 0043
remain intentional. Unsupported transfer directions are not silently enabled.
Financial history supports current snapshot MRR/ARR, not reconstructed historical
MRR or FX. Analytics supports only captured allowlisted events and retained evidence;
older distinct cohorts cannot be fabricated from summed daily counts. Live inbound
transport activation and physical backup operation depend on deployment provisioning.
These are explicit contract/release limits, not invented completed capabilities.

## Final verification and publication state

P7 is COMPLETE - LOCAL DEVELOPMENT. Full checkpoints passed 1,034 repository
and 1,376 runnable PostgreSQL cases, with one conditional live-scanner skip.
Final affected checks passed 104 current repository/compatibility cases and 87
PostgreSQL cases, followed by all 20 current P7 PostgreSQL cases. Current build,
type, lint, architecture, formatting, provider/Prisma and OpenAPI gates passed;
complete migration history and final populated M124-M128 upgrades passed.
[The P7 record](platform-admin-p7-work-record.md) contains exact commands, frozen
checksums, corrections, evidence reuse and exclusions.

PRODUCT (default) and FINANCIAL reports share the durable private inbox. Creation,
execution and download require export plus the corresponding product/financial
read capability; sensitive product filters require their additional capability.
Financial CSV separates currency and exact signed values. P5 remains the money
calculation owner. P6's public facade owns flag resolution. A shared privacy fence
keeps ordinary mutations available while consistent report snapshots execute;
concurrent consumers use bounded transaction retries without duplicate artifacts.

No unresolved local P0-P7 implementation gap was identified; documented source,
retention and deployment limits remain explicit above. P6 is published as
125cd98d36aacdea15a3ed120a220f86775d5a56. P7 remains uncommitted and unpushed,
with an empty index. Owner compose and all 150 predecessor migration files are
byte-for-byte preserved. Owner review and separate publication approval are next;
no additional phase, Client fixes, frontend integration or deployment is started.
