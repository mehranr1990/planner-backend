# Mehran Planner backend

Phase 0 through batch P0-04: NestJS/Express foundation, Better Auth database-backed
sessions, verified account/profile/settings APIs, one private personal space per
identity, strict Zod contracts, Pino logging and enforced module boundaries.
Database/API foundations include scoped persistence, revisions, cursor helpers,
metadata-only audits, transactional outbox storage and idempotency receipts.
Private streamed files use a StoragePort filesystem adapter, server-verified
content/size/hash, owner-only signed downloads and recoverable cleanup.

Read [AGENTS.md](./AGENTS.md), [PROJECT_INSTRUCTIONS.md](./PROJECT_INSTRUCTIONS.md)
and [PHASE_0_1_IMPLEMENTATION.md](./PHASE_0_1_IMPLEMENTATION.md) before changes.
The [approved environment amendment](./docs/adr/0007-local-development-and-test-runner.md)
permits local Windows development without Docker.

## Local setup

Use NVM Node **24.22.1**, pnpm **10.20.0**, and locally provisioned PostgreSQL.
See the complete [Windows setup and test runbook](./docs/runbooks/local-development.md).
Configure ignored .env and .env.test.local files from their example templates.
No credentials, databases or roles are created automatically.

```powershell
corepack enable
corepack prepare pnpm@10.20.0 --activate
pnpm install --frozen-lockfile
pnpm db:generate
pnpm build
pnpm config:check
pnpm db:migrate:deploy
pnpm db:check
pnpm start
```

The public health endpoints are http://127.0.0.1:3000/health/live and
http://127.0.0.1:3000/health/ready. Readiness requires a successful real DB query.
Missing config fails before listen. No migrations run at startup.

## Development and gates

```powershell
pnpm dev
pnpm test:unit
pnpm test:integration
pnpm quality
```

Vitest is the sole test runner; Supertest exercises HTTP. Integration tests require
an explicitly isolated local database with a name ending in _test. They never
fall back to application credentials or reset existing schemas. The quality gate runs
Prisma generation/validation, build/typecheck, format, ESLint, architecture,
unit/contract/compatibility tests, OpenAPI snapshot/compatibility checks, PostgreSQL
integration and empty/prior-schema migration replay in disposable test namespaces.

P0-02 adds one additive migration for the provider-owned identity tables,
UserSettings and Space. Apply it explicitly; API startup never migrates. Integration
tests deploy migrations only to the guarded test database and remove only their
own fixture identities. P0-03 adds a second additive migration for platform storage
and settings revisions. The migration harness can reset only its newly-created,
random fixture schema; it never resets a database or the existing public schema.
There is no development seed identity.
P0-04 adds StoredFile and a nullable audit resource UUID in a third additive
migration. Configure the private STORAGE_ROOT/limits from .env.example; relative
local paths resolve from repository root for both start and dev commands. Never
publish the storage directory through a static server or reverse proxy.

## Structure and API

- apps/api: bootstrap, shared technical services, account/spaces/tasks module boundaries.
- packages/api-contracts: transport-only Zod schemas; no DB or framework client.
- prisma: one schema and explicit Prisma configuration.
- tooling: ESLint, architecture regression probes, compatibility spike and scripts.
- docs: [API conventions](./docs/api/conventions.md), [OpenAPI](./docs/api/openapi.json),
  [requirements traceability](./docs/p0-01-traceability.md), runbooks and decisions.

Account routes are GET/PATCH /api/v1/me, GET/PATCH /api/v1/me/settings and
GET /api/v1/me/spaces. Better Auth routes live under /api/v1/auth. See the
[identity runbook](./docs/runbooks/authentication.md) for verification, sign-in,
sessions, recovery, email changes, required Origin headers and private mail sinks.
File routes are POST /api/v1/files/uploads, POST /api/v1/files/{id}/complete,
GET /api/v1/files/{id}/download and DELETE /api/v1/files/{id}. See
[private file operations](./docs/runbooks/private-files.md) for streamed completion,
short-lived authenticated links, expiry/renewal, limits and cleanup semantics.
Test-only validation/ownership probes are never mounted by the application.
Errors use a uniform safe envelope and UUID request IDs. Pino logs omit request
content, URLs and credentials. Domain/module imports may cross ownership only
through documented public exports; CI tests a deliberate prohibited import.

## Future deployment

Docker Compose remains the approved deployment target. Prepared Docker files
have **DEFERRED** image/startup/persistence checks. They are not locally verified.
All applicable checks in the [Docker release runbook](./docs/runbooks/docker-release.md)
remain mandatory before Docker-based release.

See the [P0-03 reliability contract](./docs/runbooks/database-api-events.md),
[P0-04 traceability](./docs/p0-04-traceability.md) and coordinated
[backup/restore requirements](./docs/runbooks/backup-restore.md). Outbox dispatch,
consumers and jobs remain inactive until their assigned batch. P1-01 adds the
unified Task aggregate, checklists, labels, recovery, safe history and private
attachment links. See [task operations](./docs/runbooks/tasks.md) and
[P1-01 traceability](./docs/p1-01-traceability.md). Its fourth additive migration
preserves all Phase 0 tables and records. P1-02 adds recurring Tasks and occurrences,
templates, independent bulk operations and normalized saved filters. See
[recurrence/tool operations](./docs/runbooks/task-recurrence-tools.md),
[approved recurrence policy](./docs/adr/0008-task-recurrence-semantics.md) and
[P1-02 traceability](./docs/p1-02-traceability.md). Its fifth additive migration
preserves existing Tasks and private links. Catch-up is explicit; no worker is
activated. Use `pnpm smoke:p1-02` after building for the isolated compiled API smoke.
P1-03 adds My Day and weekly composition, private planning reviews, explicit
rollover and configured capacity. Planning references existing Tasks through
their public contract and never changes Task dates/state. See
[planning operations](./docs/runbooks/planning.md),
[approved planning policy](./docs/adr/0009-personal-planning-semantics.md) and
[P1-03 traceability](./docs/p1-03-traceability.md). Run `pnpm smoke:p1-03`
after building for the isolated compiled restart smoke. P1-04 is not started.

# P1-04 calendar

Calendar events, recurring schedules, Time Blocks, range views and advisory
conflicts are documented in [the calendar runbook](docs/runbooks/calendar.md).
See [requirements traceability](docs/p1-04-traceability.md) and approved
[ADR 0010](docs/adr/0010-calendar-temporal-semantics.md). After `pnpm quality`,
run `pnpm smoke:p1-04` for compiled API restart/persistence checks.

## P1-05 habits, routines and water

Habits support exact checkbox/quantity/duration logs, versioned date schedules,
typed correction history, range-scoped streaks, ordered routines and canonical ML
water totals. See [ADR 0011](docs/adr/0011-habit-history-and-streak-semantics.md),
[traceability](docs/p1-05-traceability.md) and the [runbook](docs/runbooks/habits.md).
Run `pnpm smoke:p1-05` after compilation for restart/persistence evidence.

## P1-06 goals, milestones and life areas

Personal short/long-term Goals support scoped hierarchy, explicit lifecycle,
manual/metric/exact weighted progress, existing Task/Habit links and immutable
private reviews. See [ADR 0012](docs/adr/0012-goal-progress-and-history-semantics.md),
[traceability](docs/p1-06-traceability.md), [runbook](docs/runbooks/goals.md)
and [batch report](docs/p1-06-report.md). Run `pnpm smoke:p1-06` after building
to verify compiled API restart persistence and idempotent review replay.

## P1-07 focus, Pomodoro and time tracking

Server-authoritative Focus Sessions retain typed transition history and recover
across API restarts. Finite Pomodoro phases exclude breaks from actual work;
manual corrections preserve history and summaries explain overlaps. Task-owned
estimates and explicit quadrants preserve prior Task contracts. See
[ADR0013](docs/adr/0013-focus-timers-and-time-accounting.md),
[traceability](docs/p1-07-traceability.md), [runbook](docs/runbooks/focus.md)
and [report](docs/p1-07-report.md). Run `pnpm smoke:p1-07` after building.
