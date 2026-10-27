# Mehran Planner — Persistent AI Engineering Agent

**Version:** 1.0  
**Role:** Repository-level operating instructions for AI coding agents working on the backend.  
**Applicability:** Every task, session, change, review, migration, and implementation batch during Phase 0 and Phase 1.

> **Mission:** Implement exactly the approved Phase 0/1 backend contract, with no speculative features, no missing acceptance criteria, no unauthorized technology changes, and no progression to the next batch without explicit approval. Make the backend extensible to Project, Team, and Company later without implementing them now.

## 1. Binding source documents and precedence

Read these files **at the start of every new session and before each batch**:

1. `PROJECT_INSTRUCTIONS.md` — binding architecture, technologies, modular boundaries and non-negotiable engineering rules.
2. `PHASE_0_1_IMPLEMENTATION.md` — binding Phase 0/1 scope, batch order, entity registry, API behavior, rules, tests and acceptance criteria.
3. Relevant approved `docs/adr/*.md` files — explicit changes and decisions (only ADRs approved by the owner are binding).
4. This `AGENTS.md` — behavioral and workflow instructions for the agent; it **does not override** the project instructions or implementation specification.
5. Existing code and tests — evidence of current state, not a substitute for the approved contract.

If a document is missing, unavailable, internally inconsistent, or conflicts with another binding document, **do not silently assume** its contents. Identify the blocking ambiguity, stop only the affected work, and request an owner decision or approved ADR. Do not treat a casual suggestion as scope approval.

## 2. Project boundaries

- **Phase 0:** Backend foundation; four batches `P0-01` to `P0-04`.
- **Phase 1:** Complete solo Personal Planner backend; twelve batches `P1-01` to `P1-12`.
- Execute in the ordered sequence specified in the implementation document; finish and report **one batch at a time**.
- **Not in these phases:** Project engine, Team/Company modules or memberships, chat/WebSockets, native audio/video calls, advanced automation, AI/LLM/RAG, speculative enterprise permissions, extra integrations or unused architectural scaffolding.
- Later Project/Team/Company expansion is supported through stable identifiers, explicit ownership boundaries, narrow contracts and additive evolution wherever possible—not through dormant tables and services today.
- Offline synchronization is **not** part of Phase 0. It is implemented only at the designated Phase 1 batch.
- Unless explicitly asked, work on backend and supporting backend infrastructure only—not frontend, Next.js, PWA or UI designs.

## 3. Locked engineering baseline

Use the exact approved technology register in `PROJECT_INSTRUCTIONS.md`. In particular:

- NestJS + TypeScript strict; modular monolith; REST + OpenAPI; Zod validation.
- PostgreSQL **installed locally on Windows for development; self-hosted with Docker Compose for future deployment**; Prisma migrations and client. **Never add Neon or other mandatory hosted database.**
- Better Auth for authentication; authorization is enforced separately by backend domain/application policies.
- Private on-host Docker volume through a `StoragePort` abstraction. **Do not add Cloudflare R2 or other mandatory object-storage provider in Phase 0/1.**
- PostgreSQL-backed **pg-boss** for durable background jobs when the scheduled batch requires it. **Do not add Redis/BullMQ.**
- SMTP adapter/Nodemailer where email delivery is required; do not add a mandatory proprietary email service.
- pnpm workspace, ESLint, Prettier, Vitest + Supertest, dependency-cruiser, Docker Compose, GitHub Actions, Pino and approved runtime/config tooling.
- Do not introduce new libraries, providers, services, architectural patterns or license costs because they seem convenient. First show a concrete unmet requirement, alternatives and implications, then obtain a documented decision if the locked register must change.

## 4. Start-of-work protocol

Before editing files:

1. Read the binding documents and the current batch specification.
2. Inspect repository structure, git working-tree status, current implementations and tests.
3. Detect uncommitted or unrelated modifications. Never discard, overwrite, stash, reformat, commit, or include someone else's changes without owner instruction.
4. Identify the exact batch, acceptance criteria, permitted modules/entities/APIs and migration impacts.
5. Prepare a brief execution plan: files/modules to change, invariants to protect, tests to run, and any blocking ADR questions.
6. **If no batch is specified**, investigate/review only, or request the next approved batch. Do not assume permission to start the next one.

## 5. Scope and change control

- Implement **all and only** what the current batch requires, including mandated tests, documentation and security handling.
- Never silently omit a required behavior due to complexity or time. Report a blocker or incomplete requirement explicitly.
- Never gold-plate, redesign, prebuild future modules, add feature flags for nonexistent features, or refactor unrelated code.
- Never change locked tool choices, schemas, external contracts, module boundaries, permission rules, retention defaults or recurrence semantics without a documented approved ADR where required.
- For genuine ambiguities: propose the smallest safe options and recommend one; do not invent a product rule and present it as an approved decision.
- Preserve backward compatibility by default. Schema changes may legitimately add tables and indexes; do not promise that future evolution will only add columns.
- Separate necessary bug fixes in the current batch from unrelated improvements. Log the latter for future consideration.

## 6. Module architecture and coding conventions

- Organize code **feature-first**, using the canonical root layout and module ownership registry in project instructions.
- Put HTTP parsing, authentication context and response shaping in presentation/controllers; business behavior in application/domain; persistence and external services in infrastructure.
- A module may depend only on another module's explicitly exported **public contract/facade**; no imports from another module's internal application/domain/infrastructure files.
- No cross-module direct repository or raw ORM access. Own reads/writes and rules in the responsible module.
- Keep domain logic independent of NestJS/HTTP/ORM/storage providers where practical and as required by the architecture contract.
- Avoid circular dependencies, global service locators and `forwardRef` as a workaround for poorly chosen module boundaries.
- Do not create abstract interfaces, wrappers, factories or directories without a current use case. Keep services small and cohesive.
- Keep transaction boundaries explicit; publish durable external consequences only after successful commit via the approved event/outbox strategy.
- Prefer authoritative DB state and idempotent side effects over assumptions about exact-once execution.

## 7. Data model and security invariants

- Each resource belongs to an explicit authorized `Space`; Phase 0 uses personal ownership only. `Space` is a security/ownership boundary, **not** an overloaded UI workspace or future Company entity.
- User identity, creator, owner, member and assignee are conceptually distinct. Never infer ownership from `createdByUserId`.
- Access checks are mandatory on read, list, create, update, export and delete operations, including background jobs and file downloads.
- Enforce same-space relationship constraints at the database or suitable transaction/domain boundary; prevent cross-user/cross-space foreign references and enumeration leaks.
- Use stable opaque IDs, explicit time zone/date behavior, optimistic concurrency where specified, exact money types and safe pagination.
- Prefer actual foreign keys and typed link tables to unvalidated polymorphic reference strings.
- Production changes use reviewed migrations, not schema push, reset or destructive database recreation.
- No hardcoded credentials, production secrets in fixtures, sensitive logs, public file URLs or direct mounting of private volumes through a proxy.
- Changes to authentication, account deletion, journal/mood/finance data or exports require focused security and privacy tests.

## 8. Jobs, reminders and files

- PostgreSQL remains authoritative for reminders, recurrences, deliveries, and job effects. `pg-boss` dispatches work; jobs re-check current state, permissions and idempotency before executing.
- Jobs must survive process/container restart; missed schedules must be recoverable. Respect timezone and daylight-saving rules from the specification.
- Use the private Docker file volume only via the storage abstraction; store access-controlled metadata in PostgreSQL.
- File operations require ownership enforcement, size/type constraints, safe filenames, cancellation/cleanup and backup coordination.
- Backup PostgreSQL and file volumes consistently, to a destination outside the same single-server failure domain. Document and test restore procedures at the mandated release gate.

## 9. Testing and gates

For every batch run the **applicable** checks defined in the binding documents, including:

- type checking, formatting and lint;
- architecture import/boundary checks and circular-dependency checks;
- unit and domain invariant tests;
- integration tests against isolated PostgreSQL;
- API/OpenAPI contract compatibility checks;
- migrations and constraints tests;
- authorization, tenant-isolation and data-leak tests;
- concurrency, idempotency and retry tests when relevant;
- job restart/recovery and file-access tests when relevant;
- Docker build/start and operational smoke tests when required.

**Testing discipline:** During iterative development, run targeted checks for the changed module first, then run the full batch/phase gate **once** for submission unless failures justify reruns. Avoid excessive screenshots, broad unrelated E2E suites, duplicated generated files or running all tests after every tiny edit. Never reduce mandated final coverage merely to save time.

Never claim a test passed unless it actually ran successfully. If a command could not run, report it as **NOT RUN** with the reason and impact.

## 10. Git, deployment, and safety

- Do not auto-commit, push, force-push, rebase or deploy unless explicitly requested; follow any stricter repository policy.
- Never rewrite or delete unrelated uncommitted work.
- Containers use non-root execution where practical, private DB network, persistent named volumes, health checks and external HTTPS reverse-proxy configuration as specified.
- Database migration is a controlled one-off deployment step; do not automatically mutate production schemas on every API startup.
- Keep local/development and production configurations separate; never make dev convenience defaults unsafe in production.
- No mandatory paid cloud integrations; flag costs or required external infrastructure before adding them.

## 11. End-of-batch report (required)

At the end of **every** batch, return a concise factual report with:

```text
Batch: P0-xx or P1-xx
Status: COMPLETE / PARTIAL / BLOCKED
Scope implemented: ...
Files/modules changed: ...
Entities, migrations and constraints: ...
API contracts, domain events and jobs: ...
Security and edge cases addressed: ...
Tests and exact commands/results: ...
Tests not run and why: ...
Deviations from binding specs: ...
Outstanding issues / ADRs required: ...
Git status and whether anything was committed: ...
Next eligible batch: ... (NOT STARTED)
```

After reporting, **stop**. Do not start another batch without the owner's explicit approval.

## 12. Definition of Done

A batch is done only when every acceptance criterion in `PHASE_0_1_IMPLEMENTATION.md` is satisfied, actual required tests have passed, relevant API/documentation and migrations match implementation, security invariants hold, no unauthorized out-of-scope code exists, and the completion report is accurate. An incomplete batch remains partial, even if the project builds.

## 13. Session continuity

When the context is long or a session is ending, produce a compact handoff recording:

- approved current phase/batch and completed batches;
- files and migrations touched, including uncommitted state;
- important rules/decisions and open ADRs;
- last known verification commands/results;
- exact unfinished steps and next allowed action.

Do **not** treat a generated handoff as overriding the binding docs. On resuming, reread the canonical docs and inspect actual repository state.

---

**Agent operating principle:** Be conservative with scope, rigorous with invariants, economical with tooling and tests, transparent about uncertainty, and stop at the approved batch boundary.

## 14. Approved P0-01 environment and tooling amendments (2026-10-27)

- Local development uses Windows, Node.js 24 LTS via NVM, local PostgreSQL, pnpm, Prisma and Vitest + Supertest. Vitest is the sole mandatory unit/integration runner.
- Docker Compose remains the future deployment target. Do not install Docker/WSL or run Docker commands during local P0-01 work. Docker startup, persistence and image checks are DEFERRED, never PASSED, and remain mandatory before Docker release.
- P0-01 may complete using applicable local quality gates. Use an explicitly isolated local test database; never reset or destroy a database without owner approval.
- Pino structured logging and basic health checks replace the removed telemetry integration. For production incidents use available redacted logs and health evidence.
- AGENTS.md is the canonical agent entry point; all unique engineering rules from the reviewed legacy agent file have been preserved here.
- P0-02 and subsequent batches require explicit approval. Do not commit or push without approval.
