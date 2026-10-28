# P1-03 implementation report

Batch: P1-03 — My Day, Personal Planning, Reviews & Capacity.
Status: COMPLETE for the approved local development scope.
P1-04 is NOT STARTED. No commit or push is authorized or performed.

## Scope and decisions

Daily planning now stores unique ordered references to existing same-space Tasks.
It supports selection/refresh, full reorder, removal and explicit moves, with
independent Day/item/Task revision checks and bounded 100-reference days. Weekly
plans compose seven daily plans; daily mutations advance covering Week revisions.
There is no duplicated Task or weekly backlog store. Existing recorded timezone,
local date and first-day-of-week context remains stable after account changes.

Private MORNING/EVENING/WEEKLY reviews have unique date/kind identities,
revision-checked CRUD and scoped cursor queries. Reflection lives only in planning
and is excluded from audit/outbox/logs. Rollover preview is read-only; explicit
COPY/MOVE commit revalidates plan/settings/item/Task snapshots, reports safe
per-item outcomes, and uses the existing atomic 24-hour result receipt facility.
No Task due/scheduled date, state, revision, history, recurrence or file link is
modified by planning.

Capacity uses explicit per-selection allocation minutes and account-owned optional
weekday availability. Unknown/zero values and advisory excess are distinct. No
TimeBlock, Task estimate, calendar, worker, inference or later-batch infrastructure
was added. Existing `/me/settings` shapes are preserved. Settings/availability
writers arbitrate on their shared revision with safe row-lock ordering.

Owner-approved [ADR 0009](./adr/0009-personal-planning-semantics.md) resolves these
details before dependent implementation. Approved ADR 0008 also remains binding:
masters are blocked from new selection, and a Task converted after selection is
excluded from My Day Task items, weekly counts and capacity. Its blocked reference
metadata remains removable and visible to rollover inspection. There is no silent
history deletion or Task rewrite.

See [operations/contracts](./runbooks/planning.md) and
[requirements traceability](./p1-03-traceability.md).

## Persistence, ownership and API compatibility

The sixth additive migration `202610280003_p1_03_personal_planning` adds exactly
DailyPlan, DailyPlanItem, WeeklyPlan and PlanningReview, plus nullable versioned
planningAvailability JSON on existing UserSettings. Scoped/date-consistent foreign
keys, date/Task/order uniqueness and revision/minute/context checks protect the
contract. All five previous migrations remain unchanged; no database reset,
schema push or destructive recreation is used. Release failure recovery is an
additive forward fix with coordinated backup, never dropping historical data.

The new planning feature uses Task/account public contracts for transactionally
consistent scoped reads and account-owned availability writes. Its repository
owns only planning entities. There are no cross-owner raw ORM calls, dependency
cycles, new libraries/providers, auth-owned schema changes or unrelated refactors.
Strict shared Zod schemas generate OpenAPI; P1-02 signatures join the earlier
frozen baselines in the compatibility gate. Safe metadata audit is atomic with
planning writes; no new event type/consumer/worker is introduced. Existing Task
outbox and idempotency behavior remains intact.

The migration upgrade gate now preserves representative prior Tasks, checklist,
private attachment, recurrence, occurrence, template, saved filter, receipt JSON,
settings, stored file, audit and outbox data through prior-schema upgrade and
repeat deploy. Empty-schema replay and scoped DB constraints remain required.

The migration is applied to both verified local PostgreSQL 18.6 development and
isolated test databases. Both have six finished applied migrations, matching
SHA-256 checksums, four new planning tables and no unfinished migration. The
historical rolled-back test ledger entry remains preserved. The sixth migration
checksum is `fba0b1e53da2cb239add7278473230fc695409fa1efab79af9ee7abd51d2c6a4`.

## Verification evidence

Targeted checks passed: 25 planning domain/strict-schema tests, two OpenAPI tests,
31 PostgreSQL integration/security tests, strict typecheck and architecture.
The compiled API smoke passed actual HTTP/auth planning, weekly composition,
recurring occurrence references/master denial, rollover exact replay, configured
and unknown capacity, private review persistence and API process restart, including
historical timezone/week context after account preference changes.

Initial iterations fixed a scoped failure-check ordering issue, isolated FK fixture
setup, optional/generic TypeScript types and unused type imports. The 100-item
order bound, cross-user checks, rollback after writes, concurrency and all existing
tests remain intact; none was weakened. The converted-master case was added as a
focused regression, and the existing log privacy assertion additionally checks
reflection text. The final `pnpm quality` passed all 13 stages on its first full
run with exit code 0: **223 tests across 29 files** (111 unit/contract/architecture/
compatibility and 112 integration). This includes all 165 earlier regression
tests and 58 P1-03 additions, with no failed or skipped tests. Build, strict
types, formatting, lint, Prisma generation/validation, official auth schema,
OpenAPI snapshot/compatibility, migration replay/upgrade and architecture all
passed. Architecture reports 118 modules and 509 dependencies with no violation.

After the final build, `pnpm smoke:p1-03` passed again on Node 24.22.1 and
PostgreSQL 18.6. It verified actual compiled API/auth, daily/weekly plan persistence,
private review and availability persistence, recurring Task references/master
denial, exact rollover receipt replay after process restart, unknown capacity,
unchanged Task identity/dates/history and preserved historical context after
preference changes. Owned fixtures were cleaned up.

Use the existing pinned pnpm cache in this Windows environment:

```powershell
$env:COREPACK_HOME = Join-Path (Get-Location) '.tools/corepack'
node .tools/corepack/v1/pnpm/10.20.0/bin/pnpm.cjs quality
node .tools/corepack/v1/pnpm/10.20.0/bin/pnpm.cjs smoke:p1-03
```

The guarded local migration/checksum commands also passed:

```text
node --env-file=.env .tools/p1-03/deploy-development.mjs
node --env-file=.env .tools/p1-03/verify-databases.mjs
```

The deployment helper first verified loopback PostgreSQL 18, no recovery mode,
the exact five prior applied migrations and no unfinished entry, then executed
`node node_modules/prisma/build/index.js migrate deploy --config prisma.config.ts`
using the development environment. Verification queried both databases read-only
and checked each applied checksum against its local SQL file. No production or
startup migration was performed.

Targeted commands:

```text
node .tools/corepack/v1/pnpm/10.20.0/bin/pnpm.cjs typecheck
node .tools/corepack/v1/pnpm/10.20.0/bin/pnpm.cjs architecture
node node_modules/vitest/vitest.mjs run --project unit apps/api/src/modules/planning/domain/planning.spec.ts packages/api-contracts/src/planning.spec.ts --project contract apps/api/test/contract/planning-openapi.spec.ts
node --env-file=.env.test.local node_modules/vitest/vitest.mjs run --project integration apps/api/test/integration/planning.spec.ts
node --env-file=.env.test.local tooling/scripts/p1-03-smoke.ts
```

Ignored local evidence is under `.tools/p1-03/`: `quality-final.log`,
`compiled-smoke.json`, `database-verification.json` and `candidate-review.json`.
No required local test is
intentionally skipped. Docker image/startup/persistence, production HTTPS/proxy,
operational SMTP, off-host coordinated backups/restore and deployment monitoring
remain DEFERRED as authorized. Hosted GitHub Actions is NOT RUN locally; CI retains
the quality and P1-02 smoke stages and adds the P1-03 compiled smoke stage.

## Files and Git

Changes cover the planning module; narrow account/Task public contracts and owner
implementations; module composition; shared Zod/OpenAPI; the additive schema and
migration; metadata audit actions; targeted tests/log privacy/migration fixtures;
compatibility signatures; smoke/CI wiring; README, runbook, ADR and traceability.
Binding specifications, dependency versions/lockfile, runtime pins, private file
operations and all earlier migration files are unchanged. No P1-04 feature exists.

Baseline HEAD: `0d24043d8bbd56f52dabe8448e7940658f9044a3`. The starting working tree
was clean. All batch changes remain uncommitted and unstaged. No unrelated file
was discarded, rewritten, removed, committed or pushed. Next eligible batch:
P1-04, NOT STARTED and requiring explicit owner approval.

Final Git review: 43 files, comprising 19 modified tracked files and 24 new files;
none removed or staged. No local credential match, private upload, environment/
database file, compiled/generated client or unrelated candidate is included.
Required OpenAPI and compatibility snapshots remain tracked contract artifacts.
There are no deviations from the approved batch policy, unresolved blockers or
outstanding ADR decisions.
