# Projects integration follow-up — 2026-11-17

Work item: P2-GAP-CLOSURE integration follow-up. Status: **PARTIAL**; the
independent PB-18 correction is implemented and tested. No subsequent batch starts.

## Changes and preserved contracts

The exception filter exposes four allowlisted public reasons in the existing
`error.details: [{path: "", code}]` array while retaining HTTP 409, CONFLICT,
the generic message and requestId. Arbitrary exception data stays private.
Workflow publication distinguishes stale draft/base revisions and publication
collisions. Existing fencing, transactions, immutable versions, pinned bindings,
receipt replay and authorization remain intact. No new events, jobs, entities,
constraints, dependencies or migrations were introduced.

Changed owners/files: bootstrap exception filter and its unit tests; Tasks workflow
publisher; Project core/execution integration tests; OpenAPI generator description,
canonical/handoff snapshots and Project frontend handoff. No Frontend source,
Personal, Teams, Company or Messaging behavior was changed.

## Decisions and activation blockers

- D9: approved manual Project status values and the initial/backfill value are
  absent. Preserve read-only lifecycle metadata, editable statusNote and separate
  computed health. No invented status API or migration.
- Workflow migration is not approved: [ADR 0053](adr/0053-projects-gap-closure.md)
  preserves pinned task bindings. The handoff specifies the required editor
  wording: publishing a version does not move existing tasks.
- [ADR 0049](adr/0049-phase-5-communication-lifecycle-blocking-and-local-security.md)
  requires actual malware-engine integration/scanning before Shared activation.
  Storage currently implements structural/signature checks, not that engine.
  No truthful completed acceptance reference can be recorded. Shared keys and
  acceptance settings were therefore not provisioned; `.env` and secrets remain
  unchanged. No production security clearance is claimed.
- PB-13 remains numeric 0–100, PB-14 capacity UNKNOWN without sufficient evidence;
  guest-grant extensions remain deferred. No specification deviations.

## Actual verification

| Command                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Result                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `pnpm.cmd config:check`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | PASS                                                                              |
| `pnpm.cmd db:check`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | PASS, local PostgreSQL SELECT 1                                                   |
| `pnpm.cmd build`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | PASS                                                                              |
| `pnpm.cmd typecheck`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | PASS                                                                              |
| `pnpm.cmd openapi:generate` followed by `pnpm.cmd openapi:check`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | PASS; historical schema/signature baselines preserved; both snapshots agree       |
| `pnpm.cmd architecture`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | PASS, 669 modules / 4,590 dependencies                                            |
| `pnpm.cmd lint`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | FAILED: default 4 GB Node heap exhausted; documented larger-heap rerun below      |
| `node --max-old-space-size=8192 node_modules/eslint/bin/eslint.js . --max-warnings 0`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | PASS, zero warnings                                                               |
| `pnpm.cmd test:integration apps/api/test/integration/project-core.spec.ts apps/api/test/integration/project-execution.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | PASS, 76 tests against fresh owned schemas in guarded local mehran_test; no reset |
| `pnpm.cmd exec vitest run --project unit --project contract --project compatibility apps/api/src/bootstrap/api-exception.filter.spec.ts apps/api/src/platform/database/foundation.spec.ts apps/api/src/modules/tasks/domain/workflows.spec.ts packages/api-contracts/src/projects.spec.ts packages/api-contracts/src/project-execution.spec.ts apps/api/test/contract/http.spec.ts apps/api/test/contract/project-routes.spec.ts apps/api/test/contract/project-gap-routes.spec.ts apps/api/test/contract/project-tool-routes.spec.ts apps/api/test/contract/project-execution-routes.spec.ts tooling/compatibility/project-gap.spec.ts` | PASS, 41 tests / 11 files                                                         |
| `pnpm.cmd exec prettier --check apps/api/src/bootstrap/api-exception.filter.ts apps/api/src/bootstrap/api-exception.filter.spec.ts apps/api/src/modules/tasks/infrastructure/workflow-tools.repository.ts apps/api/test/integration/project-core.spec.ts apps/api/test/integration/project-execution.spec.ts packages/api-contracts/src/openapi.ts docs/frontend-handoff/PROJECTS_GAP_CLOSURE.md docs/frontend-handoff/openapi.json`                                                                                                                                                                                                     | PASS                                                                              |
| `git diff --check`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | PASS                                                                              |

Initial five new filter unit cases also passed independently; they are included
in the 41 above. Integration assertions cover real authenticated key/child/workflow
conflicts, denial before conflict disclosure, unchanged pinned bindings, stale
publication rollback and retained draft/version state. No tests were weakened.

Read-only development inspection found 101 successful applied migrations, matching
all repository checksums, two resolved rolled-back attempts and zero unresolved
failures. Existing `mp-rpc-v1.0-work` covers PROJECT/TEAM and all five classes;
policy approval is development/pre-production only. Shared-control paths are
independent of storage and erasure paths; existing Personal control marker exists.

Live API: documented `pnpm start`, liveness/readiness both 200, database up.
A dedicated account signed up, verified through the private local mail sink and
authenticated with Better Auth; `/me` returned 200. Project list/catalog/create
returned 403 with activation settings absent. Session was signed out and its
subsequent `/me` returned 401. Zero Shared resources were created. The dedicated
development identity remains; its identifier is recorded only in ignored local
verification output. No other development identity/data was changed by this check.

NOT RUN: remaining live Shared Project/template/task/subtask/workflow/risk/file
smoke, blocked by actual activation prerequisites. Full unrelated suites and
Docker/production checks were outside this focused local follow-up. No development
migration was necessary. API/worker and final Git publication evidence are reported
separately after the authorized normal push.
