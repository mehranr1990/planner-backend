# Platform Admin P6 work record

2026-11-26. Status: **COMPLETE — LOCAL DEVELOPMENT**. The owner accepted P5 locally and authorized
P5-only publication, then all remaining P6 implementation and local acceptance.
P5 is published on origin/main as `85c78390692e9d5bae108a068f46c4358efb8051`;
remote HEAD was verified. The owner compose SHA256 is
`c42657021cd05da9ad7412dd67e675470b8029ffdabccb4b55035a363623cf20`.
All 145 predecessor migration files and frozen M119–M121 were checked before
publication. P6 must remain uncommitted. P7, deployment, E2E, frontend source and
subagents are excluded.

Execution plan: implement the configuration catalog, immutable published versions,
revision-bound drafts/previews, typed target references, deterministic rollout,
P2 distinct approval consumption, emergency kill controls, real request/domain
enforcement, durable scheduled reconciliation, and maintenance with independent
signed fallback and mandatory recovery checks. Reuse P3 control/key custody and
health, existing pg-boss and P5 entitlements without weakening their authority.
Add focused Vitest/PostgreSQL/contract and populated-upgrade coverage; run the
complete mandatory gates at final acceptance under AGENTS section 16.

## Implementation and acceptance traceability

All three P6 modules are implemented. Focused PostgreSQL acceptance passed all
23 cases; the populated upgrade passed both interruption/resume/repeat rehearsals.
Mandatory final repository/database gates are next. This remains IN PROGRESS
until those gates and any affected failure corrections pass.

| Requirement              | Implementation and verification                                                                                                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FF1 targeting            | Typed global/type/Workspace/user/current Social Group rules, canonical logical scope IDs; real Personal/Team/Company and group membership integration coverage                                                   |
| FF2 rollout/precedence   | Pure SHA256 basis-point bucketing, stable Workspace/user cohorts, monotonic UTC steps, explicit priority/position; unit and PostgreSQL effective inspection                                                      |
| FF3 lifecycle            | Revision-bound drafts, fifteen-minute impact preview, immutable publication, scheduled activation/expiry, prior-value restoration and rollback as a new version; concurrency/idempotency/revocation/expiry tests |
| FF4 kill                 | Dedicated immediate restrictive capability, independent targeted evaluation, P2 second approval for removal; real HTTP denial and controlled recovery                                                            |
| PC1 typed catalog        | Seven exact allowlisted keys; strict types/ceilings/client version, conservative impact/diff, scoped overrides, no arbitrary infrastructure or secrets                                                           |
| PC2 runtime              | Actual task defaults, personal/shared upload admission and finalization, module/operation fences and pending notification dispatch; existing Client schemas preserved                                            |
| PS1 settings             | Locale inspection, notification policy, granular sensitive permission and P2 non-self approval consumed at publication; exact fingerprint and current reviewer checks                                            |
| PS2 maintenance          | Scheduled Notice, Read-only, Full; localized status/estimates/start countdown/overrun/progress/update time; real HTTP and transactional enforcement                                                              |
| PS3 durable release      | Explicit approved schedule distinct from countdown; PostgreSQL PENDING/WAITING/RELEASED/REVIEW history, restart catch-up, current authority and readiness checks; concurrent release and revoked-reviewer tests  |
| PS4 independent recovery | P3 signed private filesystem status/restriction while DB/API unavailable, serialized atomic writes, protected operator recovery; missing/corrupt evidence fails closed; real dependency failure/recovery tests   |
| X1 safety/compatibility  | Existing RBAC, MFA/session/Origin, tenant/custody/retention and P5 entitlement fences remain authoritative; erasure detaches target FKs without rewriting history; full regression gate pending                  |

Owner: `platform/configuration`; HTTP/controller concerns, workflow orchestration,
pure evaluation, PostgreSQL persistence and runtime helpers remain separate.
AppModule wires the existing Spaces authority callback; no platform-to-business
internal imports, new dependencies, frontend source or providers were introduced.
The existing pg-boss consumer reconciles schedules and normal effects. Security,
lifecycle/retention and entitlement-expiry controls retain their existing path.

## Migrations and artifacts

M122–M123 add eight tables and fifteen FKs: definitions, drafts, versions, typed
targets, events, maintenance releases, invalidation generation and release schedules.
Final isolated catalog: 432 tables including the Prisma ledger, 1,325 FKs; SHA256
`bfd87eee40804a75865e0a2c88a9edaca6e1bde241ca34bae153172c2a56c9eb`.
The only historical constraint expansions are the P2 action allowlist and matching
action/target check; non-self approval and MFA recovery restrictions are preserved.
Published versions/events/releases, target values and terminal schedule facts are
DB-protected. No schema push, existing DB reset, production migration or deployment.

| Migration                            | Frozen SHA256                                                    |
| ------------------------------------ | ---------------------------------------------------------------- |
| M122 platform_admin_p6               | eeebe3b482211b8caca27c231de93424b40e295e3d4a4bc008f860eaf184a462 |
| M123 p6_maintenance_release_schedule | 2febb13ca0e2f3acb020ddf1d820f2b741799a3c8dd61065a88bab8768babbd0 |

ADR 0078 and [the backend frontend handoff](frontend-handoff/PLATFORM_ADMIN_P6.md)
record engineering decisions, all seventeen Admin operations/capabilities, one
ordinary effective-inspection route and one public independent-capable status route.
Generated OpenAPI has 1,555 operations and 14,185 resolved references. An initial
recursive JSON-schema reference failure was corrected with the existing schema
embedding helper; the compatibility gate remains unchanged apart from exact counts.

## Focused verification and corrected failures

- `pnpm.cmd test:integration apps/api/test/integration/platform-admin-configuration.spec.ts --maxWorkers=1`: PASS, 23 tests; `.tools/p6-target-integration-6.log`.
- `node --env-file-if-exists=.env.test.local .tools/p6-run-upgrade.ts`: PASS;
  `.tools/p6-upgrade-final-target.log`. Preserves 423 predecessor datasets, 147
  historical ledger checksums, immutable money and retained P6 versions; both
  rollback/resume/repeat upgrades and exact FK catalog pass.
- `pnpm.cmd db:generate`: PASS after final model changes; `.tools/p6-generate-schedule.log`.
- `pnpm.cmd openapi:generate`: PASS after the schema-embedding correction;
  `.tools/p6-openapi-generate-2.log`; both generated artifacts mirrored exactly.
- Earlier focused failures identified and corrected the missing AuditModule import,
  fixture retention-version type, catalog camel-case validation, a mistaken precedence
  assertion, task-default normalization, and an upgrade fixture missing its Task ID.
  No tests were weakened, skipped or removed to obtain passing behavior.

## Final-gate corrections and frozen acceptance pass

The first full static checkpoint passed config/provider schema/Prisma,
build/type/lint/architecture/format/OpenAPI checks. It passed 1,016 repository
cases with one shared-admission contract failure. That failure was corrected by
running database policy after existing authentication/shared admission guards;
the exact contract passed its rerun. A new case/operation classification unit
test brings the current repository suite to 1,018 cases.

The full PostgreSQL checkpoint ran all 67 files: 1,354 passed, eight failed and one
conditional live-scanner skip. The failures were in three files, including one
derived unhandled error after a maintenance test left its fence active. All 24 P6
cases subsequently passed together; the corrected full Social file passed all 18.
The bounded 48-request polling regression passed unchanged (32 successes, 16
rate-limited, zero unexpected errors, about 1.74 s measured polling time). No test
timeout, security assertion, architecture rule or required test was weakened.

Corrections cover canonical UUID/HTTP casing, current Company context inheritance,
user-targeted Shared upload limits, released-maintenance inspection, safe unknown
independent status and byte budgets, ordered configuration/mutation commits, and
readiness-only scheduled releases. Requests read the authoritative generation;
initial unconfigured requests avoid a global reconciliation transaction. Durable
sweeps remain in pg-boss and runtime UTC checks do not depend on their timing.

A confirmed existing Social expense deadlock required one narrow regression fix:
decision commands predeclare their notification recipient accounts through the
existing sorted account fence and recheck that set after locking the expense.
This preserves current authority, exact money, idempotency, single application and
the existing stale-revision HTTP 409. No ledger, product or permission rule changed.
An incorrect revision-order field in the first fix attempt was corrected; the
complete 18-case file then passed. No unrelated refactoring was performed.

`pnpm.cmd db:migrations:check` passed the complete final migration gate, including
all historical rehearsals and both P6 upgrades; `.tools/p6-final-database-migrations.log`.
SQL/schema inputs have not changed since that successful gate. Config/provider
schema and Prisma validation inputs remain unchanged as well.

Because the fixes affect global request enforcement, run one final complete
repository/integration acceptance pass against frozen source, plus current
build/type/lint/architecture/format/OpenAPI checks. Record actual results below.
P6 remains uncommitted; P7 not started. Release-only exclusions remain pending.

## Final acceptance evidence

The final complete runs used frozen implementation source. No required assertion,
timeout, architecture rule, migration guard or compatibility baseline was weakened.
The earlier checkpoint failures above are superseded by these successful results.

| Exact command                                                                          | Final result / local evidence                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd test --maxWorkers=1`                                                         | PASS: **1,018 tests, 237 files**, exit 0; `.tools/p6-acceptance-static-test.log`                                                                                                                                                  |
| `pnpm.cmd test:integration`                                                            | PASS: **1,362 tests, 66 files**; one conditional live-ClamAV test/file skipped; exit 0, `.tools/p6-acceptance-database-integration.log`                                                                                           |
| `pnpm.cmd db:migrations:check`                                                         | PASS, exit 0: all historical rehearsals plus populated M122/M123 interruption, rollback/resume/repeat, retained P5 financial history and P6 versions; `.tools/p6-final-database-migrations.log`                                   |
| `pnpm.cmd build`; `pnpm.cmd typecheck`                                                 | PASS, exit 0 against final source; `.tools/p6-acceptance-static.tsv`                                                                                                                                                              |
| `node --max-old-space-size=12288 node_modules/eslint/bin/eslint.js . --max-warnings 0` | PASS, exit 0 with unchanged rules; same memory accommodation already used for P5                                                                                                                                                  |
| `pnpm.cmd architecture`                                                                | PASS: 860 modules, 5,952 dependencies, zero violations; `.tools/p6-acceptance-static-architecture.log`                                                                                                                            |
| `pnpm.cmd config:check`; `pnpm.cmd auth:schema:check`; `pnpm.cmd db:validate`          | PASS, exit 0; `.tools/p6-final-static.tsv`. Their inputs remained unchanged afterward                                                                                                                                             |
| `pnpm.cmd db:generate`                                                                 | PASS after final model changes; `.tools/p6-generate-schedule.log`; models remained unchanged                                                                                                                                      |
| `pnpm.cmd openapi:generate`; `pnpm.cmd openapi:check`                                  | PASS; 1,555 operations, 14,185 resolved references; `.tools/p6-final-openapi-generate.log`, `.tools/p6-final-artifacts.tsv`                                                                                                       |
| `pnpm.cmd format:check`                                                                | PASS, exit 0 after correcting generated handoff JSON formatting; `.tools/p6-final-artifacts-format.log`. API snapshot retains generator formatting; handoff retains repository Prettier formatting, with identical parsed content |
| `node .tools/p6-offline-smoke.mjs`                                                     | PASS: actual built operator pause/status work across fresh processes with PostgreSQL pointed at an unreachable port, from an explicitly synthetic provisioned control; `.tools/p6-offline-cli-final.log`                          |
| `node .tools/p6-preservation.cjs`; `git diff --check`                                  | PASS: all 148 predecessor migration files match HEAD bytes; M122/M123 hashes frozen; owner compose unchanged; no staged files, local secrets/configuration or dependency changes                                                  |

The final database pass completed in 1,035.83 seconds. It also reran the corrected
polling, Social concurrency and all 24 P6 cases within the complete suite. The
single conditional scanner check needs `CLAMAV_SMOKE_HOST`; it is not claimed passed.
The pinned pg driver emitted its existing concurrent-query deprecation warning;
actual checks passed without a dependency or unrelated infrastructure change.

NOT RUN / excluded by scope: E2E, frontend source, deployment, production migrations,
Docker/TLS/proxy release checks, production/off-host restore and live-provider drills.
Local simulated recovery and actual offline operator checks passed; no production
readiness, traffic switch, live delivery or deployment outcome is invented.

## End-of-batch report

- Batch: **Platform Admin P6**. Status: **COMPLETE — LOCAL DEVELOPMENT**.
- Scope implemented: Feature Flags, Product Configuration and Platform Settings,
  all targeting/rollout/precedence/version/approval/history requirements, durable
  schedules, emergency restriction, three real maintenance modes and controlled recovery.
- Files/modules: `platform/configuration`, typed API contracts, AppModule/worker,
  current owner fences for personal/shared resources, files/notifications and the
  narrow confirmed Social concurrency correction. ADR 0078, OpenAPI, frontend
  handoff, master spec and progress documentation are current. No frontend source
  or new dependency changed.
- Entities/migrations/constraints: eight tables, fifteen FKs in frozen M122/M123;
  432-table / 1,325-FK catalog; immutable publication/evidence, typed detachable
  targets, non-self approval preserved, protected terminal release requests.
- API/contracts/events/jobs: seventeen new Admin operations, one authorized
  effective-inspection operation and one independent-capable public status operation;
  transactional configuration events/generation, pg-boss schedule reconciliation
  and readiness-gated release retries. Existing Client contracts remain compatible.
- Security/edge cases: current RBAC/MFA/session/Origin and Workspace authority,
  tenant/custody/retention and commercial fences remain authoritative; flags cannot
  grant rights or bypass them. Real backend write/read/file/job enforcement,
  concurrent idempotency, stable rollouts and UUID casing, erasure detachment,
  offline failure handling and verified recovery are covered. Countdown expiration
  never authorizes reopening. Secrets remain outside the catalog.
- Tests/exact commands/results and tests not run: recorded above. All applicable
  local gates pass; release-only checks remain deferred, never marked passed.
- Deviations from binding specs: none. No product rule, recovery period, provider,
  dependency, ordinary API or historical migration changed. Lint uses the same
  12 GiB execution accommodation as P5.
- Outstanding issues/ADRs: no local acceptance blocker or pending product decision.
  Deployment provisioning and real release verification remain outside this task.
- Git: P5 accepted and published as `85c78390692e9d5bae108a068f46c4358efb8051`;
  origin/main matched after publication. **P6 is uncommitted/unpushed on main**,
  index empty. The owner's unrelated compose edit remains byte-for-byte preserved.
  No secret or local configuration is included in the P6 diff.
- Next eligible phase: **P7 — NOT STARTED; NOT AUTHORIZED by this instruction**.
