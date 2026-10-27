# P0-03 — Database, API and events

Status: COMPLETE for the approved local Windows/PostgreSQL 18 scope.
P0-04 and Phase 1 are NOT STARTED. No commit or push was performed.

## Delivered and preserved

Reusable verified RequestActor and authorized personal-space capability; explicit
AND-scoped query helper; strict cursor/keyset helpers; settings revision/ETag and
optional If-Match; safe class-checked ORM error mapping; bounded transactional
serialization retry; same-transaction settings/audit/outbox writes; passive outbox
envelope storage; actor/scope/operation/fingerprint-bound idempotency receipts;
metadata-only sensitive auth/account audit; migration safety and disposable-schema
reset/replay/upgrade harness; OpenAPI snapshot and P0-02 contract compatibility CI.

Existing Better Auth routes, request/response bodies, email lifecycle, session
revocation/security, personal ownership and original constraints are preserved.
No provider-owned scalar schema was modified. P0-02 compatibility hashes cover
all prior operations, existing parameters/bodies/responses/security and shared
health/errors. New optional headers/statuses/components are additive.

No dispatcher, consumer, pg-boss activation, jobs, storage/files, sync, personal
business entity, public audit/list endpoint or later-batch feature was introduced.

## Architecture decisions

- The owning repository keeps transaction/query semantics visible; controllers
  never access Prisma, and cross-module calls use public facades.
- An authenticated context is not itself resource authorization. The spaces
  facade issues a checked scope; a composite receipt FK additionally enforces
  actor ownership in PostgreSQL.
- Settings writes always compare/increment revisions. Optional If-Match preserves
  existing P0-02 clients; clients needing read-to-write protection send the ETag.
  JSON bodies are unchanged. Later aggregate contracts specify required revisions.
- Timezone changes emit account.timezone_changed v1 with an empty payload and
  correlation ID; settings, audit and event are atomic. No private preference value
  is copied into event/audit metadata.
- Receipt work and result UUID/status commit together under a scoped PostgreSQL
  transaction advisory lock at READ COMMITTED. Matching retries replay; changed
  fingerprints conflict. Expiry is 24 hours by database clock; reuse after expiry
  may execute again. No raw keys, request bodies or private response JSON are stored.
- Native auth/profile operations persist an audit intent before invoking the
  provider, then record its response outcome. A crash can leave ATTEMPTED/unknown;
  no false claim of sharing the provider transaction. Error redirects are audited
  conservatively as denied. App-owned settings audit is atomic with the mutation.
- Audit has no arbitrary JSON or public reader; fields are constrained metadata.
  There is no automatic audit deletion or invented legal retention policy.
- The required reset capability targets only a newly-created disposable schema,
  never an existing schema/database. This satisfies isolated migration tests while
  respecting the owner's prohibition on database resets.

No unapproved architectural deviation or binding-document change. Audit retention
and deployment operations still need their specified owner/release decisions at
the appropriate gate; they do not block this local foundation batch.

## Entities and migration

`prisma/migrations/202610270002_p0_03_data_api_events/migration.sql` adds
SecurityAuditEvent, OutboxEvent and IdempotencyRecord; settings revision default 1;
scope/owner uniqueness; foreign keys; revision/version, payload-size, receipt/hash
and audit-field constraints; scoped ordering/history and expiry indexes.

Reviewed additive SQL was deployed successfully to both mehran_dev and mehran_test
on local PostgreSQL 18.6. Both show the original P0-02 and new P0-03 migrations as
successfully applied. SELECT 1 passes. No reset, schema push, destructive migration,
existing-user deletion, database/role recreation or production connection occurred.

Prisma's diff repeated already-present provider UUID defaults; those redundant
alterations were excluded before the migration was applied. Auth scalars/defaults
and the original applied P0-02 migration were preserved. The new migration was not
edited after deploy. Failure recovery is additive forward-fix, not a destructive
down migration.

The migration gate passes from empty and from P0-02 with fixture preferences,
proves revision backfill/data preservation, checks deploy/status and repeat deploy,
and resets/cleans only its random owned namespace. Zero p003_ fixture schemas
remain in either configured database after verification.

## Dependencies and compatibility

All versions remain pinned: Node 24.22.1, pnpm 10.20.0, NestJS 12.3.2, TypeScript
6.0.3, Better Auth/auth CLI 1.7.14, Prisma/adapter/client 7.10.1, pg 8.23.1,
Vitest 4.1.12, Vite 8.3.5, Zod 4.6.7 and Supertest 7.3.1. No new technology or
version upgrade. Existing approved pg 8.23.1 (MIT, already API runtime dependency)
is now also a root development dependency for the migration/test harness.

Offline frozen installation passes. Native ESM/NodeNext, Nest/Vitest decorator
metadata, real provider schema validation, actual PostgreSQL transactions and
compiled Node HTTP behavior pass. No Jest or second runner was added.

## Tests and gates — observed results

The full `pnpm quality` gate was run once. All production/static/contract/migration
stages passed; one integration fixture initially attempted audit cleanup against
the intentionally unreachable health-test database. Cleanup was corrected to
record only auditable HTTP requests. The integration gate was rerun and all
23 tests passed. The suite was not weakened and no application gate was bypassed.
An additional final-review assertion covers native verification error redirects;
its affected integration file and relevant static/build checks were rerun.

| Command/check                                                            | Final observed result                                                                                                |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| pnpm install --offline --frozen-lockfile                                 | PASS, all workspace projects                                                                                         |
| pnpm config:check                                                        | PASS, values withheld                                                                                                |
| pnpm db:generate / pnpm auth:schema:check / pnpm db:validate             | PASS, official provider schema match                                                                                 |
| pnpm build / pnpm typecheck                                              | PASS; repeated after final auth audit correction                                                                     |
| pnpm format:check                                                        | PASS; final edited files/report also checked with Prettier                                                           |
| pnpm lint                                                                | PASS; affected files checked again after final fixes                                                                 |
| pnpm architecture                                                        | PASS, 75 modules/224 dependencies, zero violations                                                                   |
| pnpm test                                                                | PASS, 37 tests in 11 files, including architecture negative probes                                                   |
| pnpm openapi:check                                                       | PASS, snapshot and canonical P0-02 compatibility hashes                                                              |
| pnpm test:integration                                                    | PASS on corrective rerun, 23 tests in 5 files                                                                        |
| pnpm test:integration apps/api/test/integration/data-reliability.spec.ts | PASS, 8 scenarios including final redirect regression assertion                                                      |
| pnpm db:migrations:check                                                 | PASS, additive review, existing history/status, empty replay, owned fixture reset, prior-data upgrade, repeat deploy |
| pnpm db:migrate:deploy                                                   | PASS, new additive migration applied to local development; test setup/checks applied it to isolated test             |
| pnpm db:check                                                            | PASS, real local SELECT 1                                                                                            |
| Compiled API smoke                                                       | PASS, real Node child and local PostgreSQL 18.6                                                                      |
| git diff --check / ignored-secret/artifact review                        | PASS                                                                                                                 |

Final test coverage totals **60 tests in 16 files** (37 unit/contract/architecture/
compatibility + 23 integration), with no unresolved failures. Assertions include:

- Real process exits before and after commit: no partial state before; durable
  outbox/state after; evidence read from a new connection.
- Eight concurrent duplicate keys: one callback/effect/receipt; same semantic JSON
  with reordered keys replays; changed body conflicts; another actor/operation
  cannot retrieve a receipt. Failure rollback, retry, expiry and invalid inputs.
- A real PostgreSQL serialization conflict retries and preserves both increments.
- Real cross-space queries/FKs, cursor timestamp ties, paging bounds/filter/scope
  rejection, strict validation and safe ORM error envelope.
- Concurrent HTTP settings writes yield one 200/one 409 and one committed event/
  audit; legacy PATCH still succeeds; no private event/audit values.
- Auth/profile/denial metadata, invalid-token redirects, session spoof/revocation
  and a failed audit sink preventing sign-in mutation.
- All prior P0-01/P0-02 health/auth/lifecycle/cookie/ownership tests still pass.

The compiled smoke independently observed signup/verification/sign-in/settings
200, conditional update 200, stale update 409, one outbox row/atomic audit, signout
200, revoked cookie 401 and out-of-scope file route 404. Its process was stopped;
only its exact fixture identities/audits were removed. Private local mail/temporary
evidence remains ignored. There is no development seed identity.

Local detailed logs are ignored .tools/p0-03-quality.log (initial fixture failure),
p0-03-integration-rerun.log, p0-03-final-targeted.log,
p0-03-compiled-smoke.json, p0-03-database-verification.json and p0-03-review.json.
Reproducible tests, contracts and this traceable report are repository evidence.

## Files changed specifically for P0-03

23 created, 26 existing files modified, none removed. Existing P0-02 work was
reviewed and preserved; Git totals below include it.

Created:

```text
apps/api/src/bootstrap/concurrency.ts
apps/api/src/platform/audit/audit.service.ts
apps/api/src/platform/auth/request-actor.ts
apps/api/src/platform/authorization/authorized-space.ts
apps/api/src/platform/database/cursor-pagination.ts
apps/api/src/platform/database/foundation.spec.ts
apps/api/src/platform/database/idempotency.ts
apps/api/src/platform/database/persistence-error.ts
apps/api/src/platform/database/scoped-where.ts
apps/api/src/platform/database/transaction.ts
apps/api/src/platform/outbox/outbox.ts
apps/api/test/integration/data-reliability.spec.ts
docs/p0-03-report.md
docs/p0-03-traceability.md
docs/runbooks/database-api-events.md
packages/api-contracts/src/foundation.ts
prisma/migrations/202610270002_p0_03_data_api_events/migration.sql
tooling/compatibility/openapi-compatibility.ts
tooling/compatibility/openapi.spec.ts
tooling/compatibility/p0-02-api-signatures.json
tooling/testing/migration-safety.ts
tooling/testing/migration-sandbox.ts
tooling/testing/outbox-crash.ts
```

Modified:

```text
README.md
apps/api/src/bootstrap/api-exception.filter.ts
apps/api/src/bootstrap/configure-app.ts
apps/api/src/modules/account/account.module.ts
apps/api/src/modules/account/application/account.service.ts
apps/api/src/modules/account/application/settings.port.ts
apps/api/src/modules/account/http/me.controller.ts
apps/api/src/modules/account/infrastructure/settings.repository.ts
apps/api/src/modules/spaces/application/spaces.service.ts
apps/api/src/platform/auth/auth.controller.ts
apps/api/src/platform/auth/auth.module.ts
apps/api/src/platform/auth/auth.service.ts
apps/api/src/platform/auth/session.guard.ts
apps/api/test/support/application.ts
docs/api/conventions.md
docs/api/openapi.json
docs/runbooks/local-development.md
package.json
packages/api-contracts/src/index.ts
packages/api-contracts/src/openapi.ts
pnpm-lock.yaml
prisma/schema.prisma
tooling/scripts/auth-schema-check.ts
tooling/scripts/migrations-check.ts
tooling/scripts/openapi.ts
tooling/testing/integration-setup.ts
```

## Git, safety and remaining gates

This checkout does not contain the stated P0-02 commit: HEAD/local origin/main
still point to 39e896c (P0-01), with P0-02 edits present in the working tree at
entry. They were preserved, not committed, stashed or replaced. The initial
working diff/untracked inventory was saved privately under ignored .tools.
No pre-existing untracked file was removed.

Final local main has **33 modified tracked files and 59 untracked files**, all
unstaged, including preserved P0-02 work. Nothing was committed or pushed; remote
history/configuration was not changed. No secret or ignored runtime/generated
artifact is included in the candidate repository files. .env/.env.test.local,
mail, credentials, generated client, builds and temporary evidence remain ignored.

No local P0-03 blocker remains. Docker build/start/recreate/persistence, production
TLS/proxy/SMTP and deployment backup/retention gates are **DEFERRED / NOT RUN**,
not passed. No Docker command/install or hosted CI run was performed. The existing
GitHub workflow runs the expanded quality/migration/contracts suite after an
explicitly approved commit/push. Docker release checks remain mandatory.

Next eligible batch: **P0-04, NOT STARTED; explicit approval required.**
