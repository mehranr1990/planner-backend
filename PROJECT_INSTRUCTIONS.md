# Mehran Planner — Backend Engineering Instructions

**Document ID:** MP-ENG-001  
**Status:** Normative / binding for Phase 0 and Phase 1  
**Version:** 1.0 · 2026-10-14  
**Companion:** [`PHASE_0_1_IMPLEMENTATION.md`](./PHASE_0_1_IMPLEMENTATION.md)

> **Mission:** Deliver a complete, secure Personal Planner backend in two phases without building Project, Team, Company, advanced automation or AI prematurely. Preserve stable identity, ownership, domain and API boundaries so later features can be added primarily through new modules/tables and additive migrations. These two documents together are the implementation contract. If requirements conflict, stop the affected change, record the discrepancy and obtain an ADR; do not improvise.

## 1. Authority, scope and delivery contract

1. This document governs structure, patterns, technology, dependencies, security, quality gates and change control. The companion file governs deliverables, business rules, entities and implementation order.
2. Implement **only** the explicitly assigned batch. Do not pre-build future batches, placeholder modules, premature abstractions, UI or unrelated enhancements. Necessary correctness/security fixes inside the batch are allowed; explain them in the batch report.
3. Follow this precedence: approved ADR/change request > this instruction file (engineering policy) > companion implementation spec (functional detail) > current batch ticket. If there is a conflict, do not silently choose one; propose an ADR.
4. A batch is **not done** until its acceptance tests, migration tests, security tests, documentation and CI checks pass. Do not claim success based solely on type-checking.
5. Every externally visible capability needs an explicit owner, API contract, input validation, permission check, failure semantics, audit implications and tests.
6. No implementation decisions that change module boundaries, ownership, auth/session semantics, resource IDs, monetary precision or temporal semantics without a new ADR.
7. This is a **backend contract**. UI/UX and navigation are deliberately out of scope and not frozen. Frontend may consume generated contracts; backend must not depend on a Next.js runtime.

## 2. Frozen technology register

| Concern                | Approved choice                                                                                                                                        | Rule                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Runtime                | Node.js **24 LTS**, pinned exact version in `.nvmrc`/`.node-version` and CI                                                                            | No runtime changes without ADR                                                          |
| Language               | TypeScript, strict mode, ESM/CJS mode fixed by bootstrap compatibility spike                                                                           | No JavaScript application source                                                        |
| Monorepo               | pnpm workspaces, lockfile committed                                                                                                                    | No Turborepo/Nx unless performance evidence + ADR                                       |
| API framework          | NestJS on **Express adapter** initially                                                                                                                | Fastify only after dedicated compatibility ADR                                          |
| Transport              | REST JSON with OpenAPI 3.1 (or generator-supported 3.0)                                                                                                | No GraphQL/gRPC in 0/1                                                                  |
| Validation/contracts   | Zod (`strict` object parsing), OpenAPI schema output; single authoritative schema per boundary                                                         | Avoid duplicate drifting DTO definitions                                                |
| Database               | Local PostgreSQL on Windows for development; self-hosted PostgreSQL in Docker Compose with a persistent named volume for deployment                    | DB-independent domain logic; no other primary DB                                        |
| DB mapper/migrations   | Prisma migrations + Prisma Client                                                                                                                      | SQL for constraints/indexes not expressible safely in ORM, in reviewed migrations       |
| Authentication         | Self-hosted Better Auth, database-backed sessions                                                                                                      | Phase 0 integration compatibility gate; do not replace with homegrown JWT auth silently |
| Authorization          | Central application-layer resource policy service; deny-by-default                                                                                     | Never trust `spaceId` from request body as authorization                                |
| Object storage         | Private filesystem volume in Docker behind a StoragePort; S3-compatible adapter deferred                                                               | Private objects and short-lived signed links; no public bucket                          |
| Background jobs        | **pg-boss on PostgreSQL**, activated at first durable job batch; no Redis                                                                              | No cron-only reminder correctness; DB remains source of truth                           |
| Email                  | Nodemailer SMTP adapter; **development: console/test sink**, production SMTP credentials/domain configured separately                                  | No provider SDK in domain layer                                                         |
| Dates/time             | UTC instants, IANA timezones; `date-fns` + `date-fns-tz`, `rrule` where applicable                                                                     | Avoid naïve local timestamp calculations                                                |
| Finance                | Prisma Decimal / decimal.js and ISO-4217 currency codes; integer minor units where currency permits                                                    | Never use JS floating-point to calculate money                                          |
| Logging                | `nestjs-pino` / Pino with structured redaction                                                                                                         | No `console.log` of secrets or sensitive entries                                        |
| API docs               | `@nestjs/swagger` or schema-first OpenAPI compatible generator chosen once in Phase 0                                                                  | Generate and snapshot contract in CI                                                    |
| Unit/integration tests | **Vitest + Supertest**, Prisma/DB test harness                                                                                                         | Vitest is mandatory; no second test runner                                              |
| Lint/format            | ESLint flat config + typescript-eslint + Prettier                                                                                                      | CI enforcement                                                                          |
| Architecture tests     | dependency-cruiser + ESLint restricted imports                                                                                                         | CI blocks illegal imports/cycles                                                        |
| Containerization       | Docker Compose for future single-server deployment: API, PostgreSQL, optional worker, persistent data volumes; local Windows development runs directly | No Kubernetes in Phase 0/1                                                              |
| CI                     | GitHub Actions                                                                                                                                         | lint, build, architecture, unit, integration, migration and API-contract gates          |
| Monitoring             | Pino logs, request IDs, basic metrics/health; Sentry **optional adapter disabled by default**                                                          | No mandatory paid telemetry                                                             |
| Security               | `@nestjs/throttler`, secure headers, CORS/CSRF controls, password/session protections from auth library                                                | Test against actual deployment topology                                                 |
| Export                 | Streaming JSON/CSV with safe UTF-8 handling                                                                                                            | No spreadsheet/PDF exporter unless specified                                            |

**Dependency rule:** Pin exact top-level package versions in the lockfile, confirm supported compatibility on installation (Node/Nest/Prisma/Better Auth). Do not fabricate version numbers or use `latest` at runtime. Selected tools are approved categories; Docker-based self-hosting requires a host, disk capacity, backups and SMTP delivery. Do not introduce SaaS providers without an approved ADR.

**Not approved for Phase 0/1:** microservices, Kafka, RabbitMQ, Kubernetes, Elasticsearch, separate analytics database, MongoDB, GraphQL, WebSockets, Yjs/CRDT, native calls, built-in video/audio meetings, workflow builder, automation marketplace, AI/LLM, RAG/vector DB, Company/Team/Project implementations, multiple database ORMs, Redux or unrelated client state frameworks.

## 3. Canonical repository structure

```text
mehran/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── bootstrap/              # start-up, config, exception map, request context
│   │   │   ├── platform/               # technical services shared across domains
│   │   │   │   ├── database/
│   │   │   │   ├── auth/
│   │   │   │   ├── authorization/
│   │   │   │   ├── storage/
│   │   │   │   ├── outbox/
│   │   │   │   ├── jobs/                 # created only when Batch P1 needs it
│   │   │   │   ├── audit/
│   │   │   │   └── observability/
│   │   │   └── modules/
│   │   │       ├── account/
│   │   │       ├── spaces/
│   │   │       ├── tasks/
│   │   │       ├── planning/
│   │   │       ├── calendar/
│   │   │       ├── habits/
│   │   │       ├── goals/
│   │   │       ├── focus/
│   │   │       ├── notes/
│   │   │       ├── journal/
│   │   │       ├── finance/
│   │   │       ├── capture/
│   │   │       ├── notifications/
│   │   │       ├── insights/
│   │   │       └── rewards/
│   │   └── test/{integration,contract,e2e}/
│   └── worker/                          # created only when required
├── packages/
│   └── api-contracts/                   # transport schemas/types; no DB client
├── prisma/
│   ├── schema.prisma                    # OR schema/ multi-file; decide once
│   └── migrations/
├── tooling/
│   ├── eslint/
│   └── architecture-tests/
├── docs/
│   ├── adr/
│   ├── domain/
│   ├── api/
│   └── runbooks/
├── .github/workflows/
├── pnpm-workspace.yaml
├── package.json
└── pnpm-lock.yaml
```

**Do not create empty module directories.** Create each on its approved batch. A domain module generally follows:

```text
modules/tasks/
├── tasks.module.ts
├── public/             # exported façade/read contracts (not full internal services)
├── domain/             # pure invariants, state transitions, value objects
├── application/        # use cases, orchestration, transactional boundary
├── infrastructure/     # repositories, mapped persistence, adapters
├── http/               # controller, request/response schemas
└── tests/              # domain and module tests
```

Small modules may collapse directories while preserving **the exact dependency direction** and ownership. Avoid mechanical file-per-method ceremony; split when complexity justifies it. TypeScript path aliases **must not** bypass public-module exports.

## 4. Layer and module dependency rules

1. `http` -> `application` -> `domain`; `infrastructure` implements ports required by application/domain. Domain imports **no NestJS, Prisma, transport, storage or third-party SDK**.
2. **Single writer/owner:** only the owning module may mutate its aggregate and repository. Other modules interact through exported public façade/port. Read models are explicit and permission checked.
3. A module must not import another module’s `domain`, `infrastructure`, `application`, internal types or repositories. Only `modules/<name>/public` is importable, and only through module's documented exports. Exceptions limited to explicitly listed platform contracts.
4. No circular dependencies and no standard use of `forwardRef`. Resolve with ownership change, query façade, or events.
5. Synchronous calls for required immediate answers and invariants. Committed domain events for independent side effects (notification, achievement, insights invalidation).
6. Every critical side effect delivered asynchronously must be **transactional outbox-backed** or use an equivalent approved atomic mechanism. Consumers must be idempotent; at-least-once execution is expected. Never assume exactly-once queue delivery.
7. **Cross-module transactions:** allow narrowly scoped application orchestration through a documented Unit of Work when consistency absolutely demands it; no cross-owner direct repository writes. Most analytics/rewards/notices are eventually consistent.
8. No API handler directly reaches into Prisma from controller. DTO validation precedes use cases; authorization runs with the current principal and resource ownership.
9. No anonymous polymorphic `targetType/targetId` references for relations requiring database referential integrity. Explicit linking tables or a controlled reference registry with ownership checks are preferred.
10. Business rules and time calculations must be testable as pure functions when feasible.

### Ownership registry (Phase 0/1)

| Owner                   | Owned aggregates / records                                         | Consumers via public API                              |
| ----------------------- | ------------------------------------------------------------------ | ----------------------------------------------------- |
| `account`               | profile/settings/account lifecycle                                 | all modules read locale/timezone via account contract |
| `spaces`                | `Space`, personal ownership and access scope                       | all resource-owning modules                           |
| `tasks`                 | task, checklist, label, recurrence, occurrence, task event history | planning, goals, focus, capture, insights             |
| `planning`              | daily/weekly plans, selections, review/rollover state              | tasks/calendar/goals via façades                      |
| `calendar`              | event, recurrence, time block                                      | planning/tasks/insights                               |
| `habits`                | habit, schedule, completion/skip entries                           | goals, insights, rewards                              |
| `goals`                 | life area, goal, milestone, measures, links to tasks/habits        | insights/planning                                     |
| `focus`                 | focus sessions, time entries                                       | tasks/insights                                        |
| `notes`                 | notes/folders and capture drafts                                   | search/capture                                        |
| `journal`               | private journal/mood/reflections                                   | privacy-respecting insights (opt-in)                  |
| `finance`               | accounts, categories, transactions, budgets, bills, saving targets | insights (permission-limited)                         |
| `capture`               | intake/triage commands and status only                             | dispatches through public APIs                        |
| `notifications`         | notifications, reminder definitions, attempts/preferences          | listens to approved events                            |
| `insights`              | metrics, projections and cached read models                        | read-only queries                                     |
| `rewards`               | achievement state, XP ledger                                       | consumes approved events                              |
| platform `storage`      | object registry/physical lifecycle                                 | domain-controlled attachment references               |
| platform `audit/outbox` | audit evidence / delivery envelope                                 | platform use-cases                                    |

## 5. Foundational data invariants

1. Use globally stable opaque IDs (UUID or ULID: **choose UUIDv7 if supported consistently, otherwise UUIDv4** in Phase 0); no exposed auto-increment identifiers. All relationships are represented by FK when possible.
2. `User` is identity. `Space` is a **data ownership/security boundary, not a Workspace UI**. One PERSONAL space per user created transactionally and uniquely. Phase 0 supports only PERSONAL; later company/team models attach separate domain records to a `Space` and can add membership entities. Do not pretend that all future actors fit a nullable `ownerUserId` without invariants.
3. A personal resource carries an immutable `spaceId` except an explicit future transfer service; `createdByUserId` does not imply ownership. Cross-space joins/references denied and tested.
4. Future teams/companies do **not** justify introducing Team, Organization, Department, Roles or arbitrary custom ACL tables in Phase 0. Phase 0 access rule: only owner of the personal space has access. Auth tables remain under Better Auth's schema ownership.
5. Entity revisions and UTC creation/update timestamps where needed for concurrent edits. Store business-local dates (`YYYY-MM-DD`) for date-only concepts and IANA time zone for schedule resolution; instants UTC. Handle DST gaps/repeats deterministically.
6. All money calculations are exact decimal; currency must accompany amount. A transfer is one business operation with balanced legs or another explicitly consistent model, never two unrelated amounts.
7. Constraints are database-enforced for uniqueness, ownership and foreign keys wherever possible; application code is not the sole integrity barrier.
8. Soft delete only where functional restoration/history demands it; sensitive permanent deletion and retention workflows must be explicit.
9. Use additive migrations by default (expand → backfill → switch → contract), but new associative tables and occasional carefully reviewed structural changes are legitimate. **No promise of only adding columns.**
10. `Space` access is always checked on read, list, nested object and mutations. `ownerId` or `spaceId` in JSON cannot grant access. Enforce tenant-aware indexes and prevent side-channel access via filters, counts, exports or files.

## 6. API and error contract

- Versioned endpoints under `/api/v1`; public endpoints clearly marked (`/health`, auth endpoints).
- UUID resource path keys; strict Zod validation and normalization at entry; no mass assignment from request bodies.
- Standard errors: `{ error: { code, message, details?, requestId } }` with stable codes and HTTP status; never leak secrets, internal SQL or private record existence. 404 for unauthorized inaccessible resources where appropriate.
- Cursor pagination for potentially unbounded lists; stable sort and maximum page size; explicit filters and field whitelist. Use offset only for small bounded views with justification.
- All timestamps ISO-8601 UTC; date-only values explicitly separated; currency amounts serialized as decimal strings, never JS float.
- Concurrency: `revision`/ETag with optimistic conditional update; conflict returns 409 with safe details.
- Use `Idempotency-Key` on high-risk POSTs (finance, bulk actions, capture fan-out, export requests); deduplication expires per documented policy and binds to actor/scope/request fingerprint.
- API changes: additive within v1 unless ADR; OpenAPI snapshot/compatibility check in CI; no leaking ORM shape directly as public response.
- Safe file response and URL handling. Never expose a direct file-volume path or static public mount; authenticated, streaming file endpoints only.

## 7. Security and privacy baseline

- Deny by default, least privilege and ownership checks on every endpoint; test IDOR/cross-user ID swaps, links, exports, search and file downloads.
- Better Auth provides authentication/session. NestJS owns resource authorization. Validate integration, cookie SameSite/Secure/HttpOnly, CSRF origin protections, CORS, sign-in rate limiting, account recovery, session revocation and production domain settings.
- Store secrets using Docker Compose secrets or securely provisioned environment variables; validate env at bootstrap, redact request bodies containing journal/mood/financial data, passwords, tokens, file URLs.
- Journal/mood/financial details are highly sensitive: do not log contents or include them in generic audit payloads; analytic mixing is opt-in. No automatic team/company access now or later.
- Use authenticated streamed uploads, file type/size checks, safe generated paths, verified file finalization, no executable public rendering, private file volumes and orphan cleanup.
- Audit: auth-sensitive events, account deletion/export requests, permission denials where meaningful, financial mutations (metadata only) and file access where policy requires; restrict read access and retention.
- Data export and deletion have well-defined retention and background cleanup; never delete evidence required by legitimate retention without a documented policy.
- For credentials/session data rely on audited library mechanisms, not bespoke crypto.

## 8. Jobs, events and temporal correctness

- Source of truth for reminders/recurrences is the application PostgreSQL record; pg-boss is a dispatch mechanism, not authoritative schedule storage. Sweep due records after restart and verify state again at execution.
- Durable domain events recorded in outbox **in same DB transaction** as state change where needed. Each event has `id`, `type`, `version`, `occurredAt`, `aggregateId`, `spaceId`, minimal payload, `correlationId`. No sensitive content in event payload.
- Jobs have retries with bounded exponential backoff, dead-letter/failure tracking, idempotent handler, cancellation and revalidation of access/state. Scheduler must consider timezone/DST and changed due date.
- Time-dependent rules must be unit tested for leap day, DST transition, timezone change and midnight boundaries.
- A failed optional notification/reward must not roll back a completed task or finance transaction.

## 9. Quality gates and engineering workflow

**Phase 0 creates these CI gates:**

1. Install with frozen lockfile and validate environment/schema.
2. Typecheck, ESLint, formatting, build.
3. Architecture dependency rules and circular-dependency check.
4. Unit + integration tests against isolated PostgreSQL branch/database; never production.
5. Migration from empty DB and from previous schema to current; check destructive changes.
6. OpenAPI generation + compatibility diff.
7. Security tests for auth, ownership, malformed inputs and file operations.
8. Basic concurrency and retry tests for relevant batches.

**Every batch procedure:**

1. Read these two MDs and relevant prior approved ADRs.
2. Summarize exact files/modules/entities/endpoints being changed and list out-of-scope items.
3. Implement **only** the specified batch, with migrations and tests.
4. Run gates, inspect changes and list any manual service prerequisites.
5. Deliver concise report: changed files, entities/migrations, APIs/events, tests with command/result, security/edge cases, deviations, known limitations and next permitted batch.
6. Await approval before next batch. Never silently proceed to new modules. If a requirement is missing/ambiguous, propose a bounded ADR rather than making a product decision by assumption.

**Definition of Done:** business invariants met, migrations reversible or safe forward-fix plan, API documentation in sync, proper ownership/auth, unit+integration+contract tests passing, idempotency/concurrency tested where relevant, no forbidden imports, no secrets in logs, no unresolved high-severity bugs, actual functional smoke test complete.

## 10. Project governance

- Code changes not in approved batch are prohibited (except incidental required compile/test fixes, explicitly reported).
- CI checks are mandatory and should be protected in repository settings; policy cannot physically prevent a repository administrator bypassing protection, so review/branch protection remains necessary.
- Any new dependency requires purpose, maintenance/security/license review and explanation why current stack cannot provide the capability.
- A change to frozen choices requires `docs/adr/NNNN-title.md`: context, options, chosen decision, rejected options, impact, migration path, test plan, explicit approval.
- Persist this file at the repository root as `PROJECT_INSTRUCTIONS.md`; place links from README and AI-agent configuration. Agents must read it at the start of each batch.
- Keep a requirements traceability matrix mapping companion feature IDs → endpoint → entity → tests; never let implemented work drift beyond scope.

## 11. Explicitly deferred

No Project management engine, Team membership/assignment/chat, Company workflows, invoices/subscriptions, third-party platform integrations, native calls, automation designer or AI execution in Phase 0/1. Future extension points are stable ownership, domain events, adapters, explicit permissions, reusable task/goal identities and add-only evolution wherever feasible. **Do not create dormant business modules or tables for these future features.**

## Docker self-hosting infrastructure decision (ADR-006, approved)

- **No Neon or managed PostgreSQL hosting.** Run PostgreSQL in a private Docker Compose service with a persistent volume and pinned image version. PostgreSQL is never exposed directly to the public internet.
- API runs as a non-root container. Production Compose includes health checks, startup dependencies, restart policies, resource limits where supported, bounded logs, and private networks. Apply database migrations as a one-off controlled job; never automatically use schema push in production.
- **No Cloudflare R2 dependency in Phase 0/1.** Use a private Docker volume for file blobs, mounted only in the API (and explicitly authorized maintenance/backup processes). Access is mediated by `StoragePort`; never expose the volume through the reverse proxy. Store durable file metadata and tenant scope in PostgreSQL. Backup and restore database and file volume together to a separately protected destination. A future S3 adapter is additive and not implemented now.
- **No Redis/BullMQ requirement in Phase 0/1.** Use pg-boss backed by the same PostgreSQL instance when durable reminders, deliveries and cleanup become necessary. Retain idempotency, retry, backfill and authoritative application reminder records. A worker may initially run as a separate process using the same image, no new service dependency.
- Email uses an SMTP transport adapter (Nodemailer). Local/test sinks are mandatory; a real SMTP service is operational configuration and may cost money. No embedded mail server is required for release.
- Self-hosting does not automatically provide TLS, firewalling, secrets, off-host backups, monitoring or disaster recovery. Production release requires all of these to be configured and tested.
- Do not add nginx/Traefik/Caddy as a hard dependency in source code; choose a single reverse proxy at deployment configuration time, with HTTPS termination.
- Keep Prisma, Better Auth, Vitest/Supertest, OpenAPI, Zod and security/architecture tests; Docker does not make them obsolete.

## Approved local development amendment (2026-10-27)

Local development and P0-01 acceptance use Windows + Node.js 24 LTS via NVM + local PostgreSQL + pnpm. NestJS runs directly on Node.js and Prisma connects to local PostgreSQL. Vitest is mandatory for unit/integration testing; Supertest verifies HTTP integration. Docker Compose remains the future deployment target, not a local prerequisite. Do not install Docker/WSL or run Docker commands for local P0-01. Docker image/startup/persistence checks are DEFERRED and remain mandatory before Docker release. Other applicable local quality gates remain required. Use an explicitly isolated test database and never reset a database or perform destructive operations without approval. Existing production deployment and architecture rules still apply to future deployment.
