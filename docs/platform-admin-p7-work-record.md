# Platform Admin P7 work record

Final acceptance is recorded below. Earlier implementation and continuation
checkpoints are historical; queued review scripts have already been applied.

2026-11-26. Status: **COMPLETE - LOCAL DEVELOPMENT**. Owner accepted P6 locally and explicitly
authorized P6-only publication followed by all P7 implementation and verification.
P6 published as `125cd98d36aacdea15a3ed120a220f86775d5a56`; origin/main verified.
61 approved files published; compose excluded. All 148 predecessor migration files
matched HEAD bytes, M122/M123 matched frozen checksums, and owner compose SHA256
remained `c42657021cd05da9ad7412dd67e675470b8029ffdabccb4b55035a363623cf20`.
Recorded final P6 evidence reused: 1,018 repository and 1,362 PostgreSQL cases,
migration and static gates passed; conditional live scanner and deployment deferred.

P7 execution plan: add a versioned allowlisted catalog, category/retention policy,
transactional domain-event capture and authenticated bounded navigation collection;
PostgreSQL analytics definitions, hourly aggregates and durable report schedules;
meaningful rolling activity, retention/cohorts/funnels/KPIs, privacy suppression,
date comparisons, Workspace/feature/plan/flag segmentation; reuse P5 economics
through its public facade, P6 evaluation, Admin audit/RBAC and existing worker.
Add focused unit/contract/PostgreSQL/migration coverage, run final mandatory gates,
update OpenAPI/handoff and consolidated P0–P7 coverage. No P7 commit/push.

No subagents, E2E, frontend, Guest Access, deployment or unrelated Client fixes.
Historical migrations and owner compose remain immutable.

## Implementation traceability

| Requirement                    | Implementation / focused evidence                                                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Meaningful activity and growth | Version-1 metadata catalog, transactional Personal/shared capture, rolling distinct 1/7/30-day metrics, global registration counts; real task mutation and rollback tests                                           |
| Engagement and adoption        | Active-day/event ratios, feature user/event counts, UTC trends and independently filtered comparisons; pure engine/strict contract cases                                                                            |
| Segmentation and cohorts       | Personal/Team/Company captured types, registration/first-feature cohorts, return-day metrics, current P5 plan and P6 flag/kill filters; real Team task and Company navigation authority tests                       |
| Custom funnels/KPIs            | PostgreSQL definitions over catalog events, ordered user funnels, bounded conversion windows and allowlisted formulas; idempotent creation, invalid event and substitution denial                                   |
| Financial analytics            | Reused P5 exact monetary report, separate currencies, paid-term/add-on attribution, snapshot MRR/ARR, customer-count churn and gross first-paid conversion; two-currency amounts beyond JS integer precision passed |
| Collection and privacy         | Product/navigation category policy, navigation off by default, authenticated enum-only input, minimum cohorts and null suppression, bounded queries; ordinary/Admin realm and foreign Workspace denial              |
| Retention and deletion         | Raw/aggregate policy, actor-bound impact previews, typed source cascades, cache invalidation, P2 portability/erasure and quarantine; retention/history and source-deletion cases                                    |
| Durable exports/reports        | Existing worker sweep, PostgreSQL schedules, permission rechecks, CSV/JSON, expiry/cancel, serialized consumers and audited private inbox; restart/new-consumer and revoked-role tests                              |

Focused checkpoint: `pnpm.cmd test ...analytics-engine.spec.ts ...admin-analytics.spec.ts --maxWorkers=1`
passed eight cases before the additional registration-anchor case. The PostgreSQL
command `pnpm.cmd test:integration apps/api/test/integration/platform-admin-analytics.spec.ts --maxWorkers=1`
passed all thirteen cases in `.tools/p7-target-5.log`. A fourteenth rejection case
and the final review corrections are included in the full acceptance inventory.
Earlier response-shaping/fixture scheduling failures were corrected; no assertion
or timeout was weakened. Targeted lint passed after removing an unused import.

M124 adds five metadata tables/four cascade FKs. M125/M126 order privacy invalidation
and source deletion with collection/refresh fences. M124 populated upgrade passed
431 predecessor datasets, 149 historical checksums, immutable P5 money/P6 versions,
all prior constraints and 1,329 FKs. Complete M124–M126 upgrade gates are running.

## Consolidated review and final gates in progress

The P0–P7 review reuses existing phase records and P6 final complete runs. Its
module/contract/role/runtime/release matrix is in
[the consolidated handoff](platform-admin-backend-handoff.md).
The initial P7 full checkpoint has passed config, provider schema, Prisma validation,
build, typecheck, lint and architecture (871 modules / 6,021 dependencies).
Repository tests, full PostgreSQL and complete migration gates are running.

Review corrections queued before final acceptance: explicit per-price comparison
from the existing P5 report pass; preserve global meaningful activity for existing
standalone Project contexts without incorrectly classifying them as Personal/Team/
Company; fully observed return windows and custom event-count-per-active-user KPI;
explicit policy before/after audit and privacy read fences. These are P7 accuracy
and privacy requirements; P0–P6 contracts and source ownership remain unchanged.

P7 remains IN PROGRESS and uncommitted. No local acceptance or deployment result
is claimed before final gate outcomes and affected corrections are recorded.

Continuation checkpoint: the full repository checkpoint passed **1,028 tests / 240
files** and all static gates except formatting of this concurrently edited record
(now formatted; recheck at completion). Full database execution is owned by
`.tools/p7-run-final-database.mjs`: integration then migrations; inspect
`.tools/p7-final-database.tsv` and corresponding logs. Preserve that frozen code
until it finishes. Queued, dry-run-validated corrections are in
`.tools/p7-apply-review.mjs`, `.tools/p7-apply-service-review.mjs` and
`.tools/p7-linear-review.mjs` (apply in that order with `--apply` after the checkpoint).
They add per-price source-owner projection, unclassified Project activity,
policy/read privacy fences, accurate KPI contributors and mature return windows;
the cohort engine must use grouped timestamps to avoid quadratic scans.
Finish navigation versus meaningful trend aggregation and registration observation
coverage consistently, then add targeted regression cases. A new reviewed M127
must extend only the P7 raw Workspace-type check for OTHER; preserve frozen
M124/M125/M126 as well as all P0–P6 bytes. Update the P7 upgrade rehearsal and
guard/inventory, regenerate OpenAPI only after final contract edits, run affected
P5/P7/Project/lifecycle checks and final applicable static/migration checks. Record
the full checkpoint plus affected reruns accurately, then complete handoffs/status.
No P7 commit or push is authorized.

## Review closure and current verification

The frozen full checkpoint passed 1,028 repository / 240 files and 1,376 runnable
PostgreSQL / 67 files (one conditional live-scanner skip). Complete migration
rehearsals passed, including populated P7 upgrades. Its only format failure was
this concurrently edited work record, subsequently formatted; no code/test gate
was weakened. Full logs are .tools/p7-final-*.log and result TSVs.

The queued review corrections are applied. P5 now projects per-price comparisons
in its existing reporting pass; no ordinary contract or financial calculation is
replaced. Standalone Project events use OTHER and remain in global meaningful
activity. M127 extends only the new P7 Workspace-type check. Return windows must
be fully observed; grouped timestamp processing removes quadratic cohort scans,
and KPI privacy counts the actual numerator contributors. Collection toggles retain
valid historic aggregates, policy changes record exact before/after, and read
fences order queries/downloads against erasure. Navigation daily counts never
become meaningful active users. Cohorts honor retained observation coverage.

Final affected PostgreSQL command:
`pnpm.cmd test:integration apps/api/test/integration/platform-admin-analytics.spec.ts apps/api/test/integration/platform-admin-commerce.spec.ts apps/api/test/integration/project-collaboration.spec.ts apps/api/test/integration/personal-lifecycle.spec.ts --maxWorkers=1`

- PASS, **87 tests / four files**, including **17 P7** cases;
  .tools/p7-review-integration.log. The populated M124-M127 rehearsal passed all
  431 predecessor datasets, 149 historic ledger checksums, P5 exact money, immutable
  P6 versions and every prior constraint; all four interruption/resume/repeat
  checks and the 1,329-FK catalog passed (.tools/p7-review-upgrade.log).

Focused engine/contracts/migration cases passed 13 tests before the final extra
byte-freeze cases. The 50,000-event regression passed in the normal unit timeout.
One review typecheck caught a missing explicit JSON-object property guard in the
audit projection; the guard is corrected. Current build/type/lint/architecture/
repository/format/OpenAPI checks are next. Unchanged config, provider schema,
Prisma validation/generation and historical migration evidence are reused under
AGENTS section 16. No acceptance is claimed until current affected gates pass.

## Final reporting closure

The existing durable report workflow now supports PRODUCT (default) and FINANCIAL,
with type-specific read permission plus export checked at creation, execution and
download. Both have actual CSV/JSON persistence and scheduled refresh; financial
CSV preserves currency and exact signed minor units. M128 backfills old report
metadata to PRODUCT without changing their artifacts/schedules. Range-only
financial selection rejects unsupported attribution filters. P5 remains the sole
money calculation owner. Session-backed capture excludes system/background
outbox effects from DAU while preserving those events for existing consumers.

`pnpm.cmd test:integration apps/api/test/integration/platform-admin-analytics.spec.ts --maxWorkers=1`
passed **19/19 current P7 cases**, exit 0 (.tools/p7-complete-analytics.log).
The M124-M128 populated upgrade passed all preservation, interruption/resume/repeat,
legacy PRODUCT backfill and 1,329-FK checks (.tools/p7-complete-upgrade.log).
Current typecheck passed (.tools/p7-complete-typecheck.log). The prior final full
repository pass was **1,034 cases / 240 files**, exit 0; its only formatting failure
was the then-edited P7 integration file, now formatted. Current affected static,
provider/Prisma, OpenAPI and formatting checks remain to be recorded below.

M124-M128 add five tables, four FKs and one report discriminator column; 437 tables
including the Prisma ledger, 1,329 FKs, catalog SHA256
`2a50bd949621a3ed30c7fac0e96333a78160a2b1fade7b7938dce6cfa37f3915`.
All predecessor migrations and earlier P7 migration bytes remain frozen.

## Final acceptance evidence

All approved P7 local requirements are implemented. The consolidated P0-P7
requirement review and backend/frontend handoffs are complete. No required test,
security assertion, timeout, migration guard or architecture rule was weakened.
Section 16 evidence reuse preserves completed historical checks and reruns the
changed behavior rather than repeating every prior phase.

| Exact command / check                                                                                                                                                                                                                                                         | Actual final result                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd test --maxWorkers=1`                                                                                                                                                                                                                                                | PASS, 1,034 cases / 240 files in the complete checkpoint; .tools/p7-acceptance-test.log                                                                                                                                                                                 |
| `pnpm.cmd test:integration`                                                                                                                                                                                                                                                   | PASS, 1,376 cases / 67 files; one conditional live-ClamAV test/file skipped; .tools/p7-final-integration.log                                                                                                                                                            |
| Four-file PostgreSQL command in review closure                                                                                                                                                                                                                                | PASS, 87 cases, including P5, P7, Project and Personal lifecycle; .tools/p7-review-integration.log                                                                                                                                                                      |
| `pnpm.cmd test:integration apps/api/test/integration/platform-admin-analytics.spec.ts --maxWorkers=1`                                                                                                                                                                         | PASS, **20/20 current P7 cases**, 32.12 seconds; .tools/p7-runtime-analytics-final.log                                                                                                                                                                                  |
| `pnpm.cmd test apps/api/src/modules/admin-analytics/analytics-engine.spec.ts packages/api-contracts/src/admin-analytics.spec.ts apps/api/src/platform/database/foundation.spec.ts tooling/architecture-tests/admin-p7-migration.spec.ts tooling/compatibility --maxWorkers=1` | PASS, **104 cases / 25 files**, covering final report types, CSV precision, migration inventory and all Client compatibility; .tools/p7-complete-affected-tests.log                                                                                                     |
| `pnpm.cmd db:migrations:check`                                                                                                                                                                                                                                                | PASS, complete historical checkpoint and M124-M126 populated upgrades; .tools/p7-final-migrations.log                                                                                                                                                                   |
| `node --env-file-if-exists=.env.test.local .tools/p7-run-upgrade.ts`                                                                                                                                                                                                          | PASS after final M127/M128 changes: 431 predecessor datasets, 149 historical ledger checksums, immutable P5 money/P6 versions, every prior constraint; all five interruption/resume/repeat checks, PRODUCT backfill and exact 1,329 FKs; .tools/p7-complete-upgrade.log |
| `pnpm.cmd db:generate`; `pnpm.cmd auth:schema:check`; `pnpm.cmd db:validate`                                                                                                                                                                                                  | PASS with final model, native child exit 0; .tools/p7-complete-static.tsv. A prior PowerShell stderr-wrapper exit was superseded by this native-exit-verified generation                                                                                                |
| `pnpm.cmd config:check`                                                                                                                                                                                                                                                       | PASS; configuration inputs unchanged afterward; .tools/p7-final-config.log                                                                                                                                                                                              |
| `pnpm.cmd build`; `pnpm.cmd typecheck`                                                                                                                                                                                                                                        | PASS on final runtime source, exit 0; .tools/p7-runtime-static.tsv                                                                                                                                                                                                      |
| `node --max-old-space-size=12288 node_modules/eslint/bin/eslint.js . --max-warnings 0`                                                                                                                                                                                        | PASS; .tools/p7-complete-static.tsv. Final changed worker/service/public facade/integration files also passed the affected lint command recorded in .tools/p7-run-runtime-static.mjs                                                                                    |
| `pnpm.cmd architecture`                                                                                                                                                                                                                                                       | PASS, **872 modules / 6,024 dependencies**, zero violations; .tools/p7-runtime-architecture.log                                                                                                                                                                         |
| `pnpm.cmd format:check`; `pnpm.cmd openapi:check`                                                                                                                                                                                                                             | PASS, exit 0 on final source/artifacts; .tools/p7-runtime-static.tsv. Completion-only prose is formatted and checked separately afterward                                                                                                                               |
| `pnpm.cmd openapi:generate`                                                                                                                                                                                                                                                   | PASS after final contract input changes; **1,569 operations / 14,299 resolved references**. Both mirrors have identical parsed content                                                                                                                                  |
| `node .tools/p7-preservation.ts`; `git diff --check`                                                                                                                                                                                                                          | PASS: all 150 pre-P7 migration files equal HEAD bytes, five new SQL hashes frozen, compose preserved, index empty, no dependency or secret/local-artifact changes                                                                                                       |

Current worker corrections are independently verified: periodic aggregation commits
before report generation; a shared privacy fence allows ordinary writes during
consistent report snapshots. Repeatable-read serialization conflicts retry at most
three attempts. The initial concurrent-consumer failure was corrected and the
original exact-once-per-occurrence assertion passed. No exception was hidden or
test weakened. P6 flag access uses its narrow public analytics facade; P7 does not
read the configuration owner's repository directly.

### Frozen migrations

| Migration                         | SHA256                                                           |
| --------------------------------- | ---------------------------------------------------------------- |
| M124 platform_admin_p7            | 06a540c5f6498f45045553dcf503740120f042e89ca45f69a087aebe070bb6f1 |
| M125 p7_privacy_refresh_order     | 54d8f55387567f6aa5dfff7c298fa0aaeaeee040ae5da88c628d0640076a7dfd |
| M126 p7_erasure_fence             | 97205a686aa97e3fdf05020533e4028f171498a5f779c21285bf4216a1866bf1 |
| M127 p7_existing_context_activity | 07c1131a19db5397010130513c629f07e3bf8642173f57478b732f6c45234bb5 |
| M128 p7_financial_reports         | 856495ddfe0b071004ef9e1c85edaacef34db272c478dc376f7924e9e6e88652 |

### Scope limits and release checks

Observed DAU/WAU/MAU and feature usage follow the explicit version-1 captured-event
catalog, not inferred logins or uncaptured actions. Historical expired raw cohorts
are unavailable, while eligible anonymous daily trends may remain. Current flag
and active-plan segments are labelled; no historical exposure or causal A/B claim.
Financial dates select P5 cash/history; MRR/ARR remain explicit current snapshots,
with no FX aggregation or invented historical MRR. Financial report attribution
filters unsupported by P5 are rejected rather than ignored. These are documented
source/privacy contract limits, not fabricated analytics.

NOT RUN / excluded: E2E, frontend source, deployment/production migrations, Docker/
TLS/proxy/firewall release checks, real off-host restore and live-provider drills.
The existing conditional scanner needs CLAMAV_SMOKE_HOST and is not claimed passed.
Local API/worker/PostgreSQL verification is complete; production readiness is not
claimed. The consolidated handoff lists provisioning and release dependencies.

## End-of-batch report

- Batch: **Platform Admin P7**. Status: **COMPLETE - LOCAL DEVELOPMENT**.
- Scope implemented: internal growth/activity/engagement/retention, meaningful
  DAU/WAU/MAU, versioned allowlisted events/categories, Workspace/feature/cohort/
  plan/current-flag segments, custom funnels/KPIs, periodic aggregates, UTC trends
  and comparisons, authoritative P5 plan/add-on/price and currency-separated
  financial metrics, durable PRODUCT/FINANCIAL CSV/JSON reports, permissions,
  audit, retention, portability/erasure and privacy thresholds.
- Files/modules: admin-analytics, P5 public reporting facade, P6 public flag facade,
  transactional outbox/shared effects, existing lifecycle, AppModule/worker,
  typed contracts/OpenAPI, five migrations and verification tooling. ADR 0079,
  P7 frontend handoff, master/progress/status and consolidated handoff are current.
- Entities/migrations/constraints: five tables/four FKs plus report type, M124-M128;
  437-table / 1,329-FK catalog; typed source cascades and privacy/refresh fences.
  All predecessor SQL, including M122/M123, remains byte-for-byte unchanged.
- APIs/events/jobs: thirteen Admin operations and one ordinary enum-only navigation
  operation; session-backed version-1 event capture; existing durable worker,
  restart-recoverable schedules, current authority checks, bounded artifacts and
  export audits. Existing ordinary API contracts remain compatible.
- Security/edge cases: separate realms, current MFA/RBAC/Origin, source Workspace
  authority, tenant/custody/retention/erasure and commercial boundaries retained;
  no private content, recording/replay, Guest, A/B engine, fabricated revenue or FX.
  Concurrent consumers, actual user writes during reports, invalid/sparse cohorts,
  catalog overposting, expiry, policy previews, precision and revocation are covered.
- Tests/exact commands/results: above. All applicable local gates and affected final
  checks passed, with historical evidence reused under section 16.
- Tests not run: release-only/provider and explicitly excluded checks above.
- Deviations: none; no technology/dependency/provider, ordinary API or commercial
  activation change. Analytics reporting remains internal and metadata-only.
- Outstanding issues/ADRs: no local acceptance blocker or unresolved implementation
  contract decision identified. Documented source/retention limits and deployment
  verification remain explicit in the consolidated handoff.
- Git: P6 accepted and published as **125cd98d36aacdea15a3ed120a220f86775d5a56**;
  origin/main verified at publication. **P7 is uncommitted/unpushed; index empty**.
  Owner compose SHA256 remains c42657021cd05da9ad7412dd67e675470b8029ffdabccb4b55035a363623cf20.
  No secret, local configuration, temporary artifact or unrelated work is included.
- Next step: owner review of P7 and separate publication approval. All Platform
  Admin P0-P7 modules have local backend coverage; no additional phase, Client fix,
  frontend integration or deployment is started.
