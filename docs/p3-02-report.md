# P3-02 local completion report

Batch: **P3-02 — Team-owned Tasks/Goals/Calendar and cross-project planning**.
Status: **COMPLETE for the authorized local implementation and verification**.

P3-01 publication: reviewed and committed the exact accepted 50-file manifest,
pushed to origin/main, then independently verified remote and local SHA
**`ec5053ea5a6e6de850e5effe23fb62d3e1d14149`**. Unrelated documentation, secrets
and runtime artifacts were excluded. This remains HEAD; P3-02 is not committed.

Scope implemented: Team Tasks/Goals through the existing source engines, same-Team
Goal–Task links and Task scheduling; Team Calendar through the existing temporal/
recurrence engine with a fenced Shared adapter; cross-project typed work planning,
backlog, seven-date weekly plans/reviews and optional bounded sprints. Source
references grant no authority, copy no work and perform no implicit rescheduling.

Files/modules changed: Teams work service/controller; Calendar Shared public facade
and transaction adapter; narrow Projects reference validator; Spaces signed opaque
cursor helper/feature register; Tasks/Goals transfer dependency inventories; Prisma,
strict contracts/OpenAPI, migration rehearsal, tests and compiled smoke. Details:
[contract and operation matrix](p3-02-contract.md),
[migration review](p3-02-migration-review.md), [OpenAPI](api/openapi.json).

Entities, migrations and constraints: TeamPlan and TeamWorkItem; Team-compatible
CalendarEvent/EventRecurrence branches; exact typed scope/actor/source FKs and
immutable identities, revisions and plan transitions. Migrations
`202611050023_team_work_planning` and `202611050024_team_calendar_cascade_order`.
The companion preserves Personal cascade ordering by deferring only the two new
direct Calendar boundary FKs. Original SQL remains immutable. Existing configured
databases were never reset; DDL ran only against guarded isolated test targets.

API contracts, domain events and jobs: **27 new operations**, **495 total**,
**4,186 resolved local references**. Accepted P3-01 signatures are frozen from its
published OpenAPI; all Personal/Project/Team signatures pass compatibility.
Opaque-ID Team source/plan/review/item and Shared Calendar audit/outbox effects,
current free-mode usage, scoped receipts and signed cursors. No new worker handler,
queue, schedule, dependency, provider or commercial enforcement.

Security and edge cases addressed: current Team and independent Project authority;
Lead/Member/Viewer ceilings; foreign/nested/Personal source IDs; hidden sources
filtered before paging; active reference checks; stale source/plan revisions and
generation/cursor/receipt replay; atomic rollback; exact source identity and Goal
precision; both mutation/revoke orders and cross-custody races with observed locks;
account closure/attribution erasure; Calendar DST/recurrence/exception behavior.
Personal Calendar exports omit the new Shared columns. Transfer inventories
recognize only the exact new FKs and reject incoming planning references; unknown
dependencies still fail closed. Shared/Company activation settings remain unchanged.

Tests and exact commands/results:

| Command / evidence                                                                                                                                                                                                                                                                                                                     | Observed result                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd quality`, `.tools/p3-02-quality.log`                                                                                                                                                                                                                                                                                         | All **13 mandatory stages executed once**. Config, generation, auth schema, DB validation, build, typecheck, format, lint, architecture, **542 non-integration tests**, OpenAPI and full migration gates passed. Original overall exit **1**: integration had **595 passed / 2 failed of 597** because transfer inventories correctly rejected the new unknown TeamWorkItem FKs. Original failure log preserved. |
| `pnpm.cmd test:integration apps/api/test/integration/project-collaboration.spec.ts -t 'preserves Task and checklist\|keeps Goal metrics\|rejects private references'`, `.tools/p3-02-transfer-rerun.log`                                                                                                                               | **3 passed** after adding the two exact dependency names with REJECT dispositions/counts. Both failed Task/Goal transfer cases and the related private-reference/stale-graph case pass. Remaining 23 cases had already passed in the full run. No complete suite was repeated.                                                                                                                                   |
| `pnpm.cmd test:integration apps/api/test/integration/team-work.spec.ts apps/api/test/integration/calendar.spec.ts`                                                                                                                                                                                                                     | Targeted development run: **42 passed** (18 Team work, 24 Calendar), including successful Personal fixture cleanup after the forward FK timing correction. The final full run covers **19 Team work cases**, adding the other cross-custody race order and Goal revoke assertions.                                                                                                                               |
| `pnpm.cmd exec vitest run --project unit --project contract --project architecture --project compatibility packages/api-contracts/src/team-work.spec.ts apps/api/test/contract/team-work-routes.spec.ts tooling/architecture-tests/team-work-migration.spec.ts tooling/compatibility/openapi.spec.ts`; targeted Calendar domain checks | **8 passed**, plus **18 Calendar domain/expansion tests**. Final full non-integration gate covers all 542 tests, exact migration exceptions and all 27 handlers.                                                                                                                                                                                                                                                 |
| `pnpm.cmd smoke:p3-02`, `.tools/p3-02-smoke.log`                                                                                                                                                                                                                                                                                       | **PASS**: compiled HTTP API in a fresh process; unified source identity/creation replay; Calendar and weekly review durability; Team planning hides an independently unauthorized Project. No redundant earlier-batch smoke was run.                                                                                                                                                                             |
| Migration stage of `quality`                                                                                                                                                                                                                                                                                                           | **PASS**: empty replay; all **137 prior table data sets**, populated Personal Calendar/recurrence, **46 historical checksums** and old constraints preserved except the reviewed two branch-guarded nullability relaxations/additive usage CHECK. Both new artifacts interrupted/rolled back, resumed and repeated; final cleanup FK digest matches. All predecessor upgrade/security-closeout rehearsals pass.  |
| `pnpm.cmd --filter @mehran/api build`; `pnpm.cmd exec tsc --noEmit`; ESLint on the two affected transfer repositories                                                                                                                                                                                                                  | **PASS** after the final transfer-only fix. No API/Calendar/planning implementation changed after the full gate/smoke.                                                                                                                                                                                                                                                                                           |
| `git diff --check`; protected-file/migration comparison; relevant final Prettier checks                                                                                                                                                                                                                                                | **PASS**. All **17** protected unrelated/environment files and all **46** predecessor migration files remain byte-identical. Index remains empty for P3-02.                                                                                                                                                                                                                                                      |

Final acceptance across the single full run plus affected reruns:
**1,139 distinct passing tests: 542 non-integration and 597 integration**.
Required tests, assertions, timeouts and unknown-dependency guards were retained.
The first targeted Calendar cleanup failure was corrected through forward SQL;
its exact three synthetic fixture identities were then cleaned with guarded IDs,
preserving the original ignored failure manifest and logs. No database was reset.

Tests not run and why: Docker/WSL, production deployment/databases, hosted CI and
release-only off-host/load/activation checks **NOT RUN / DEFERRED**, as instructed.
No new worker behavior required another worker restart smoke; existing queue,
recovery and security integration regressions ran in the mandatory gate.

Deviations from binding specs: **none**. The FK timing and transfer-inventory fixes
are necessary Personal compatibility fixes inside this batch. No Company link,
Team capacity/analytics/recognition, new assignment policy, Team dissolution,
private-data aggregation or P3-03 feature was implemented.

Outstanding issues / ADRs required: no P3-02 local blocker or new owner decision.
Shared activation and production retain all existing retention/security/operational
gates. Team handover/archive/restore/cleanup remains P3-05. Local completion does
not authorize release or activation.

Git status and commits: only approved P3-01 was committed/pushed. HEAD/origin/main
was verified at `ec5053ea5a6e6de850e5effe23fb62d3e1d14149`. P3-02 files remain
uncommitted and unstaged; no P3-02 push, deployment, production migration or
activation. Pre-existing untracked architecture/frontend-handoff directories and
environment/runtime artifacts are preserved.

Next eligible batch: **P3-03 — NOT STARTED; requires explicit authorization**.
Stop at this boundary.
