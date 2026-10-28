# P1-05 local development report

Batch: P1-05 — Habits, Routines & Water Tracker.

Status: COMPLETE for the approved local development scope.

## Scope and implementation

Habit types CHECKBOX/QUANTITY/DURATION with exact targets and units; four date
schedule patterns; configuration/status snapshots; create/edit/pause/resume/
archive; explicit skips and multiple quantity logs; typed correction history;
deterministic range-scoped streak/completion statistics; ordered same-space
routines; canonical ML water summary; immutable historical local dates and
timezone/timestamp context. Approved [ADR 0011](adr/0011-habit-history-and-streak-semantics.md)
resolves temporal/history rules. [Traceability](p1-05-traceability.md) maps every
requirement to verification; [runbook](runbooks/habits.md) documents the contract.

Changed areas: new habits module (domain, application, repository, controllers,
public module); Zod/OpenAPI contracts and snapshot; app composition; audit/outbox
allowlists; privacy, domain, contract and integration tests; P1-04 compatibility
baseline; Prisma schema and two additive migrations; prior-schema upgrade gate;
compiled smoke/CI; technical documentation. No Task, planning or calendar owner
implementation changes, new dependency, infrastructure or worker.

## Persistence and security

Approved entities: Habit, HabitSchedule, HabitEntry, Routine, RoutineHabit.
Migrations:

- `202610280006_p1_05_habits`: five tables, same-space/same-habit/schedule/root/
  previous-revision FKs, exact NUMERIC(12,3) measures, revision/value/status checks,
  unique current logical/checkbox/skip identities and ordered routine membership.
- `202610280007_p1_05_habit_config_integrity`: forward-only JSON numeric version
  containment check to reject null/string versions instead of CHECK UNKNOWN.
  The already applied first migration was retained without editing its checksum.

All eight earlier migrations and provider-owned schemas remain unchanged.
Development/test PostgreSQL 18.6 have ten matching applied checksums and no
unfinished migration. Controlled deployment before/after hashes preserve every
pre-existing row. The upgrade gate seeds and compares full P1-04 calendar and
earlier Task/history/labels/files/recurrence/planning/receipt/audit/outbox rows.

Every route/nested reference uses verified owner scope, strict validation and safe
errors. Mutations use revisions; creation/logging use actor/Space/request-bound
24-hour receipts. Corrections append immutable typed evidence and cannot move
dates. Personal data stays out of logs/audit/outbox. Entry events are version-1
habit.entry_recorded / habit.entry_corrected, atomic with writes, empty payloads.
No consumers or jobs added. Exact fixture-only cleanup respects FK ordering.

## Verification

Targeted tests: 35 domain/contract tests in three files and 22 PostgreSQL
integration tests pass. Enhanced existing Pino privacy test passes; targeted
TypeScript/ESLint checks pass. Tests cover schedules, exact thresholds/water,
skip/rest/pause/miss, historical confirmation/correction, recorded context,
timezone/DST/midnight, ordering, retries/concurrency, nested isolation, SQL FKs /
uniqueness, JSON integrity and revision ordering under tied timestamps. Incorrect daily test data was corrected to assert
all eight daily dates; teardown ordering was corrected without weakening FKs.

`pnpm smoke:p1-05`: PASS on Node 24.22.1/PostgreSQL 18.6. A compiled process restart
preserved habit/routine order, correction history, exact water totals, skip/pause/
resume outcomes, archive history, saved zones and idempotency receipts; cross-user
denial and safe outbox passed.

`pnpm quality`: PASS, exit 0, all 13 stages. 334 tests across 38 files:
176 unit/domain/contract/architecture/compatibility tests in 27 files and 158
PostgreSQL integration tests in 11 files. This includes all 277 earlier tests and
57 P1-05 tests; none failed or skipped. Architecture: 139 modules and 632
dependencies, no violations. Provider schema, strict types, build, formatting,
lint, OpenAPI snapshot/compatibility and migration checks all pass.

The first full run caught two older scope guards that still excluded `/habits`.
They now guard later-batch routes; all previous API compatibility assertions and
test cases remain, and P1-04 signatures plus positive habit contracts are added.
The complete gate was then rerun successfully, without a bypass.

`pnpm db:migrations:check`: PASS as part of the gate: additive review, empty replay,
P1-04 upgrade with full previous-row snapshots, repeat deployment and existing
ledger/status checks. Ten current checksums match in development and test.

Final Git/content safety review: PASS, 41 approved P1-05 files; no configured
secrets, environment/private/database files, compiled clients/build artifacts,
unrelated changes or dependency changes. Index remains empty.

Docker/production deployment/hosted GitHub Actions execution: DEFERRED as approved;
the workflow includes the compiled P1-05 smoke for future CI runs.

Deviations: None beyond the explicitly approved ADR 0011 decisions.
Outstanding decisions/blockers: None.
Git: uncommitted changes on main, baseline
`2e2973b18d6078beff5383bd3848eb54316265e4`; nothing committed or pushed.
Next eligible batch: P1-06, NOT STARTED.
