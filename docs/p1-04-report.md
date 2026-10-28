# P1-04 local development report

Batch: P1-04 — Calendar, Events & Time Blocks.

Status: COMPLETE for the approved local development scope.

## Scope and implementation

Calendar event lifecycle and revision CRUD; all-day exclusive dates; timed wall
context/UTC instants; recurring schedules and stable virtual occurrences;
revision-checked exceptions, history-preserving versions and linked future
splits; optional existing Task references in Time Blocks; bounded views and
advisory conflicts. Account preference changes preserve saved schedules.
Approved [ADR 0010](adr/0010-calendar-temporal-semantics.md) resolves temporal
semantics. [Traceability](p1-04-traceability.md) maps every requirement to tests.

The new calendar module owns all three entities. Tasks are read through the
existing narrow public linking contract; Calendar never mutates Tasks or My Day.
Planning capacity retains ADR 0009's allocation-based calculation. No dependency,
worker, new infrastructure, future module or Better Auth change is introduced.

Changed areas: calendar domain/application/repository/controller/module; Zod and
OpenAPI contracts/snapshot; app composition; platform audit/outbox allowlists;
calendar tests; P1-03 compatibility baseline; additive schema/migrations;
upgrade gate; compiled smoke and CI command; technical documentation.

## Persistence and security

Two additive migrations:

- `202610280004_p1_04_calendar`: CalendarEvent, EventRecurrence, TimeBlock;
  owner/scoped FKs, unique exceptions/successor/current version, interval and
  date/instant separation checks, revisions and access/range indexes.
- `202610280005_p1_04_calendar_integrity`: forward-only nonnull linked Task
  revision and recurrence configuration version checks. This fixes SQL CHECK's
  UNKNOWN acceptance after isolated testing; the applied migration was retained.

All earlier migrations remain unchanged. Development and isolated PostgreSQL 18
have eight applied migrations with matching SHA256 and no unfinished entries.
Before/after deployment hashes confirm every pre-existing row remained identical.
The disposable upgrade gate seeds P1-03 planning/availability/reviews plus earlier
Task/history/labels/files/recurrence/tools/receipts/audit/outbox and verifies full
row preservation, empty replay and repeat deployment without resetting databases.

All endpoints and nested IDs use verified owner scope, strict input, safe errors
and strong mutation revisions. Creation/split receipts bind actor, scope and
fingerprint for 24 hours. Calendar audit and version-1 calendar_event.changed /
time_block.changed outbox messages commit atomically with writes and contain
only safe metadata. No titles/descriptions or other private content are broadcast.

## Verification

Targeted development results: 30 calendar domain/contract tests and 24 calendar
PostgreSQL integration tests pass. Targeted ESLint and TypeScript checks pass.
Tests cover DST gaps/folds, midnight, skipped dates, leap/month boundaries,
travel/preferences, virtual identity/history/exclusions, all three series edit
scopes, concurrent/retried writes, Task lifecycle links, My Day preservation,
isolation, invalid SQL links, bounded range/dense conflicts and snapshot cursors.

Final mandatory commands and observed submission results:

- `pnpm quality` — PASS, exit 0, all 13 stages. 277 tests across 34 files:
  141 unit/domain/contract/architecture/compatibility tests in 24 files and 136
  PostgreSQL integration tests in 10 files. This includes all 223 earlier tests
  and 54 P1-04 tests; none failed or skipped. Architecture: 130 modules and 577
  dependencies, no violations. OpenAPI matches its reviewed compatible snapshot.
- `pnpm db:migrations:check` — PASS, empty schema and P1-03 upgrade with complete
  prior-row snapshots and repeated deployment. The first full run caught an
  invalid new history fixture; its missing required before-state fields were
  corrected without changing the existing constraint, then the full gate passed.
- `pnpm smoke:p1-04` — PASS on Node 24.22.1/PostgreSQL 18.6. Compiled process
  restart preserved events, blocks, explicit all-day dates, recurrence gaps,
  exceptions, split lineage/receipts, Task/My Day references and saved timezones;
  conflicts, cross-user denial and deletion tombstones passed.
- Git/content safety review — PASS: 41 approved P1-04 source, contracts, schema,
  tests, ADR and documentation files. No secrets, environment/private/database
  files, compiled clients/builds or unrelated changes. Index remains empty.

Earlier scope-exclusion tests no longer exclude the now-approved calendar routes;
their earlier API compatibility assertions remain, and P1-04 contracts add a
full P1-03 signature baseline. No required regression test was weakened.

Docker/production deployment/hosted CI execution: DEFERRED as authorized. Local
GitHub Actions workflow includes the compiled P1-04 smoke for future runs.

Deviations: None beyond the explicitly approved ADR 0010 temporal decisions.
Outstanding product/architecture decisions: None.

Git: uncommitted P1-04 changes on main, based on
`c9b671990c4a95e843aef27d02d658ba9a0eaba7`. No commit or push is authorized.
Next eligible batch: P1-05, NOT STARTED.
