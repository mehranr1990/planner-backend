# Mehran Planner backend

Phase 0, batch P0-01: NestJS/Express foundation, Prisma PostgreSQL connectivity,
strict Zod contracts, Pino logging, health endpoints and enforced module boundaries.
Authentication and personal ownership start only after P0-02 approval.

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

The schema intentionally has no models in P0-01. No migration is necessary;
auth-owned tables and personal ownership belong to P0-02.

## Structure and API

- apps/api: bootstrap, shared technical services, account/spaces module boundaries.
- packages/api-contracts: transport-only Zod schemas; no DB or framework client.
- prisma: one schema and explicit Prisma configuration.
- tooling: ESLint, architecture regression probes, compatibility spike and scripts.
- docs: [API conventions](./docs/api/conventions.md), [OpenAPI](./docs/api/openapi.json),
  [requirements traceability](./docs/p0-01-traceability.md), runbooks and decisions.

Business APIs use /api/v1 when introduced. The current runtime has only health
routes; test-only validation and auth health probes are never mounted by the API.
Errors use a uniform safe envelope and UUID request IDs. Pino logs omit request
content, URLs and credentials. Domain/module imports may cross ownership only
through documented public exports; CI tests a deliberate prohibited import.

## Future deployment

Docker Compose remains the approved deployment target. Prepared Docker files
have **DEFERRED** image/startup/persistence checks. They are not locally verified.
All applicable checks in the [Docker release runbook](./docs/runbooks/docker-release.md)
remain mandatory before Docker-based release.
