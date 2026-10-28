# P1-01 implementation report

Status: COMPLETE for the approved local development scope. P1-02 is
NOT STARTED. No commit or push is authorized or performed.

## Delivered and decisions

The unified Task aggregate now supports validated CRUD, explicit completion and
reopen, five-edge bounded subtasks, ordered checklists, case-insensitive scoped
labels, preexisting private file links, safe immutable history and thirty-day
subtree recovery. Existing mutations require strong revision preconditions.
Task state, child links, history and approved version-1 outbox events commit
atomically. Scoped optional creation receipts prevent replayed side effects.

The architecture remains NestJS/strict ESM TypeScript, Prisma/PostgreSQL, Zod,
Better Auth, Vitest/Supertest and the existing StoragePort. No dependency or
infrastructure was added. Provider-owned columns/tables were not altered. Goals,
recurrence, bulk, saved filters, scheduling/jobs, sync and account-closure features
remain outside this batch. There are no architectural deviations or unresolved
ADRs. See [requirements traceability](./p1-01-traceability.md) and
[operation details](./runbooks/tasks.md) for defaults and transaction contracts.

## Database and migration

The single additive migration `202610280001_p1_01_tasks` adds Task,
TaskChecklistItem, Label, TaskLabel, TaskChange and typed TaskAttachment, two
enums, scoped FKs, unique/index/check constraints. Typed file links were assessed
to preserve referential integrity without duplicating StoredFile metadata.
The previous three migrations remain unchanged. Existing data was preserved;
configured databases were never reset or recreated. Test cleanup targets only
owned fixture IDs; disposable migration namespaces remain separately guarded.

Local read-only verification found healthy PostgreSQL 18.6 development and test
databases, successful SELECT 1, no recovery mode and four finished applied
migrations with matching SHA-256 checksums in each. The previously documented
rolled-back P0-02 test ledger entry remains preserved and is not an applied
migration. No unfinished migration was found.

| Migration | SHA-256                                                            |
| --------- | ------------------------------------------------------------------ |
| P0-02     | `378358fa7e8ce9ea3e88ac0c59e5df5bdefab923d3126ba943b0bb09165f2b55` |
| P0-03     | `c351a30a0b1f55979b6fc2d13d2fb4683ddc5e880541a7774c51d6e0c78ca833` |
| P0-04     | `1a8b6c10e7681166fce6a84e98355150efe2b58918cdbabc57b9bacb8ef07b07` |
| P1-01     | `b756f32a2b578d41172ba3c0cf30d3735535b54d184c513609c83acc66adde68` |

## Verification evidence

Targeted development checks passed: typecheck, ESLint, architecture, five domain
tests, two Task OpenAPI contract tests and 23 Task integration/security tests.
Routine fixture/type errors were corrected with targeted reruns, without
weakening production validation or test assertions. Two fixtures retained after
a failed cleanup were reviewed by exact UUID and removed; no unrelated data was
touched. The first full gate found one test formatting issue; every other gate passed.
After correcting formatting, the final `pnpm quality` completed all 13 stages
successfully: config validation, Prisma generation, official auth schema check,
Prisma validation, build, typecheck, format, lint, architecture, unit/contract/
architecture/compatibility tests, OpenAPI compatibility/snapshot, isolated DB
integration and migration replay. Total: **113 passing tests in 21 files**
(56 unit/contract/architecture/compatibility and 57 integration), including all
83 Phase 0 regression tests and 30 P1-01 additions. No failed or skipped test
remains. Architecture reports 97 modules and 359 dependencies with no violation.

The targeted commands were `pnpm typecheck`, `pnpm architecture`,
`pnpm exec eslint . --max-warnings 0`,
`pnpm exec vitest run --project unit apps/api/src/modules/tasks/domain/tasks.spec.ts`,
`pnpm exec vitest run --project contract apps/api/test/contract/tasks-openapi.spec.ts` and
`node --env-file=.env.test.local node_modules/vitest/vitest.mjs run --project integration apps/api/test/integration/tasks.spec.ts`.
Development deployment ran
`node --env-file=.env node_modules/prisma/build/index.js migrate deploy --config prisma.config.ts`
(the command behind `pnpm db:migrate:deploy`); test deployment is enforced by the
isolated integration harness.

The compiled smoke command
`node --env-file=.env.test.local .tools/p1-01/smoke.mjs` passed on Node 24.22.1
and PostgreSQL 18.6. It starts the compiled API, signs up/verifies two identities,
creates Task/subtask/checklist/Label, streams and binds a private file, checks
foreign denial/stale revision, completes the Task, restarts the actual API process,
verifies persisted state and attachment, reopens, soft-deletes/restores the subtree
and verifies eight safe history/outbox records. Owned fixtures are cleaned up.
Ignored local evidence lives under `.tools/p1-01/` (targeted and full-gate logs,
compiled smoke, DB checksums and candidate-file credential review).

Dependencies remain unchanged: Node 24.22.1, pnpm 10.20.0, NestJS 12.3.2,
TypeScript 6.0.3, Better Auth 1.7.14, Prisma 7.10.1, Vitest 4.1.12 and
Zod 4.6.7. Native ESM compiled startup and existing compatibility gates pass.

## Files and boundaries

Created: the tasks feature module (pure domain/tests, application port/service,
scoped infrastructure repository, controllers, composition and public module
entry), storage public metadata facade/exports, shared Task schemas/OpenAPI,
Task integration and contract suites, the additive migration, P0-04 compatibility
signatures, this report, traceability and task runbook.

Modified: root module composition, trusted CORS methods, outbox event allowlist
and batch insertion, storage facade export, Prisma application relations,
provider-schema checker application-backrelation exclusions, migration fixture
and inventory, OpenAPI generator/snapshot, old future-route exclusion assertions,
test fixture audit cleanup, README/API conventions and CI/gate labels.
Removed: none. Binding specifications and dependency manifests/lockfile unchanged.

## Deferred and Git

Docker image/startup/persistence, production HTTPS/proxy/ACLs, operational SMTP,
disk monitoring, encrypted off-host database/file backup and isolated restore
drill remain DEFERRED and mandatory before deployment. No Docker/WSL command was
run. Hosted GitHub Actions is NOT RUN locally.

Git remains on main at `8520b1ec2ccc4bde364fd3fadcddf811d1a068f8`; all batch changes
are uncommitted and unstaged (18 modified tracked files, 19 new files; none
removed). Candidate review covered all 170 tracked/new files and found no local
credential content or private/generated candidate paths. Secrets, private storage, environment files,
database files and local/generated artifacts remain ignored. Nothing is removed,
committed or pushed. P1-02 requires explicit owner approval.
