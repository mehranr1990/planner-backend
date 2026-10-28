# P1-02 implementation report

Batch: P1-02 — Recurring Tasks, Templates, Bulk Operations & Saved Filters.
Status: COMPLETE for the approved local development scope.
P1-03 is NOT STARTED. Nothing is committed or pushed.

## Delivered scope

The existing tasks module now owns recurring definitions, actionable ordinary
Tasks per occurrence, non-actionable masters, explicit DST policies, all seven
pattern variants, exclusions and bounded persisted catch-up. All three edit
scopes preserve occurrence identity and terminal history; future splits retain
typed predecessor linkage. Explicit occurrence completion, skipping and
cancellation remain atomic with Task state/history/outbox. The existing Task
completion/reopen/delete/restore routes keep their occurrence state consistent.

Templates copy validated safe values and unchecked checklists into independent
Tasks. Bulk commands use existing Task behavior, independent item transactions,
safe partial reports and durable replay results. Saved filters retain a
normalized version-1 conjunction of existing Task predicates and reauthorize
nested references on every execution. Existing attachment permissions remain
unchanged. There are no workers, new dependencies/providers, planning modules or
later-batch features.

See [requirements traceability](./p1-02-traceability.md),
[operations/API details](./runbooks/task-recurrence-tools.md) and
[the approved recurrence decision](./adr/0008-task-recurrence-semantics.md).
ADR 0008 was revised to the owner's final policy and explicitly approved in this
session before recurrence coding. No unresolved ADR or architectural conflict
remains.

## Persistence, contracts and privacy

The fifth migration, `202610280002_p1_02_task_recurrence_tools`, adds exactly
TaskRecurrence, TaskOccurrence, TaskTemplate and SavedTaskFilter, plus nullable
JSON bulk-result storage on the existing IdempotencyRecord. Scoped foreign keys,
master/lineage/occurrence uniqueness, revision/policy/state/reason checks and
pagination indexes enforce the contract. All four prior migration files remain
unchanged. No configured database is reset, recreated or schema-pushed. The
release rollback strategy is an additive forward fix with coordinated backups.

The migration is applied to both verified local PostgreSQL 18.6 development and
isolated test databases. Both have five finished applied migrations, matching
SHA-256 checksums and no unfinished migration. The historical rolled-back test
ledger entry remains preserved. The new migration checksum is
`cefe69017ff57383b188960ba734982b140a1eadfffaee4b43e11f758e20afd2`.

Strict Zod schemas drive all new runtime contracts and generated OpenAPI. The
approved P1-01 request/response/parameter signatures are now checked alongside
all Phase 0 baselines. New metadata-only audit actions identify series/occurrence
mutations; existing version-1 Task outbox events retain empty payloads. No event
type, dispatcher or job is added. Actual Task scalar/link changes preserve Task
revision and safe TaskChange history; a series-only relation change uses the
series revision/audit rather than fabricating a Task field change.

DST gaps create SKIPPED/DST_GAP without an actionable Task; folds select earlier
UTC deterministically. A later schedule edit into a gap cancels and retains any
already-created Task/history. Account timezone changes do not rewrite series.
Monthly absent dates and non-leap February 29 are skipped. Catch-up is bounded
to 366 scanned dates and 100 candidates per call with persisted progress and
scope/revision-bound cursors. Duplicate identities are prevented both by scoped
transaction locking and PostgreSQL uniqueness.

Bulk receipts use the existing 24-hour actor/space/request binding, with validated
private JSON results for exact per-item replay. Savepoints roll back expected
failed items before safe results commit. No receipt read endpoint is added.
Descriptions, filenames, file links, arbitrary SQL and private request contents
are excluded from audit/outbox/log payloads. Missing/foreign references remain
indistinguishable safe 404s. Denial tests cover resource/nested/filter/bulk IDs.

## Verification

Targeted development checks passed: 26 date/validation tests, two P1-02 OpenAPI
tests, 24 PostgreSQL integration/security tests, typecheck, ESLint and architecture
(105 modules, 426 dependencies; no violation). The compiled API smoke exercised
actual HTTP/auth, DST gap tracking, bounded catch-up, mixed bulk errors/replay,
template/filter isolation and persisted state after restarting the API process.

The initial full `pnpm quality` completed all stages. All 81 integration tests,
format/lint/build/type/architecture/auth-schema/OpenAPI and migration replay
checks passed. One unit assertion still expected four migrations. It was replaced
with an exact list of all five approved migrations; destructive/procedural SQL
rejection assertions remain intact. Its targeted seven-test suite passed, then
the final full `pnpm quality` rerun passed all 13 stages with exit code 0:
**165 tests in 25 files** (84 unit/contract/architecture/compatibility and
81 integration), including all 113 prior regression tests and 52 P1-02 additions.
There are no failed or skipped tests. Build, strict typecheck, format, lint,
architecture, official auth schema, Prisma validation/generation, OpenAPI
snapshot/compatibility and isolated migration gates all passed.

After the final build, `pnpm smoke:p1-02` passed again on Node 24.22.1 and
PostgreSQL 18.6. It verified three persisted occurrences including one DST gap
without a Task, mixed bulk success/denial/stale outcomes, exact bulk replay after
restarting the actual compiled API, one completion event, terminal state,
template copying and filter/resource isolation. Owned fixtures were cleaned up.

Exact Windows invocation uses the existing pinned local pnpm cache because the
global PowerShell shim is blocked by execution policy and its default Corepack
cache is outside the workspace:

```powershell
$env:COREPACK_HOME = Join-Path (Get-Location) '.tools/corepack'
node .tools/corepack/v1/pnpm/10.20.0/bin/pnpm.cjs quality
node .tools/corepack/v1/pnpm/10.20.0/bin/pnpm.cjs smoke:p1-02
```

The guarded local deployment and checksum commands also passed:

```text
node --env-file=.env .tools/p1-02/deploy-development.mjs
node --env-file=.env .tools/p1-02/verify-database.mjs
```

The deployment helper first checked loopback PostgreSQL 18, no recovery mode,
no unfinished migration and the exact four prior applied migrations. It then
executed `node node_modules/prisma/build/index.js migrate deploy --config
prisma.config.ts` with the development environment, applying only the reviewed
fifth migration. Verification queried both environments read-only and compared
every applied checksum with its local SQL file.

Targeted commands:

```text
node .tools/corepack/v1/pnpm/10.20.0/bin/pnpm.cjs typecheck
node .tools/corepack/v1/pnpm/10.20.0/bin/pnpm.cjs architecture
node node_modules/vitest/vitest.mjs run --project unit apps/api/src/modules/tasks/domain/recurrence.spec.ts packages/api-contracts/src/task-tools.spec.ts --project contract apps/api/test/contract/task-tools-openapi.spec.ts
node --env-file=.env.test.local node_modules/vitest/vitest.mjs run --project integration apps/api/test/integration/task-recurrence-tools.spec.ts
node node_modules/eslint/bin/eslint.js apps/api/src/modules/tasks apps/api/test/integration/task-recurrence-tools.spec.ts apps/api/test/contract/task-tools-openapi.spec.ts packages/api-contracts/src/recurrence.ts packages/api-contracts/src/task-tools.ts packages/api-contracts/src/task-tools-openapi.ts packages/api-contracts/src/task-tools.spec.ts tooling/scripts/p1-02-smoke.ts tooling/scripts/migrations-check.ts --max-warnings 0
```

Development iterations corrected fixture ambiguity, fixture setup saturation at
the deliberately small test pool/timeouts, and strict optional TypeScript types.
No test assertion was weakened; concurrent generation/replay tests and the full
100-item mixed-permission/revision bulk scenario remain required and passing.
Ignored local evidence is under `.tools/p1-02/`: `quality.log` (initial run),
`quality-final.log` (passing final run), `compiled-smoke.json`,
`database-verification.json` and `candidate-review.json`.

## Files, release gates and Git

Changes are limited to tasks application/domain/infrastructure/controllers/module
composition; shared Zod/OpenAPI; nullable receipt JSON and safe audit action
allowlists; Prisma schema/migration; targeted tests and migration fixtures;
compiled smoke/CI wiring; API/task/README documentation and traceability.
The existing Phase 0 migration inventory and obsolete future-route exclusion
assertions were updated for the newly approved batch. Binding specifications,
auth provider fields, runtime pins and dependency versions/lockfile are unchanged.

Docker image/startup/persistence, production HTTPS/proxy/ACLs, operational SMTP,
disk monitoring, encrypted off-host database/file backup and restore drill remain
DEFERRED to deployment. No Docker/WSL command was run. Hosted GitHub Actions is
NOT RUN locally; its quality and new compiled-smoke steps are configured.

Baseline HEAD remains `90b99af42c699202fac8c3f4819e9e1c33d9bb6d`.
All 41 batch files are uncommitted and unstaged: 22 modified tracked files and
19 new files. No unrelated starting changes existed and no file was removed.
Candidate review found no local credential matches or private/generated paths;
environment files, storage and generated artifacts remain ignored. No
commit/push/rebase or application deployment occurred. There are no deviations
from the approved batch policy, unresolved blockers or outstanding ADR decisions.
Next eligible batch is P1-03, NOT STARTED and requiring explicit owner approval.
