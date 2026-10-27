# Mehran Planner backend

Phase 0 through batch P0-02: NestJS/Express foundation, Better Auth database-backed
sessions, verified account/profile/settings APIs, one private personal space per
identity, strict Zod contracts, Pino logging and enforced module boundaries.

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
fall back to application credentials or reset schemas. The quality gate runs
Prisma generation/validation, build/typecheck, format, ESLint, architecture,
unit/contract/compatibility tests, OpenAPI snapshot checks and PostgreSQL integration.

P0-02 adds one additive migration for the provider-owned identity tables,
UserSettings and Space. Apply it explicitly; API startup never migrates. Integration
tests deploy migrations only to the guarded test database and remove only their
own fixture identities. There is no schema reset or development seed identity.

## Structure and API

- apps/api: bootstrap, shared technical services, account/spaces module boundaries.
- packages/api-contracts: transport-only Zod schemas; no DB or framework client.
- prisma: one schema and explicit Prisma configuration.
- tooling: ESLint, architecture regression probes, compatibility spike and scripts.
- docs: [API conventions](./docs/api/conventions.md), [OpenAPI](./docs/api/openapi.json),
  [requirements traceability](./docs/p0-01-traceability.md), runbooks and decisions.

Account routes are GET/PATCH /api/v1/me, GET/PATCH /api/v1/me/settings and
GET /api/v1/me/spaces. Better Auth routes live under /api/v1/auth. See the
[identity runbook](./docs/runbooks/authentication.md) for verification, sign-in,
sessions, recovery, email changes, required Origin headers and private mail sinks.
Test-only validation/ownership probes are never mounted by the application.
Errors use a uniform safe envelope and UUID request IDs. Pino logs omit request
content, URLs and credentials. Domain/module imports may cross ownership only
through documented public exports; CI tests a deliberate prohibited import.

## Future deployment

Docker Compose remains the approved deployment target. Prepared Docker files
have **DEFERRED** image/startup/persistence checks. They are not locally verified.
All applicable checks in the [Docker release runbook](./docs/runbooks/docker-release.md)
remain mandatory before Docker-based release.

P0-03 is not implemented. No outbox, audit table, generic idempotency store,
business-domain table, worker, file endpoint or resource CRUD is prebuilt.
