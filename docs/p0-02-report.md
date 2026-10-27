# P0-02 ? Authentication and ownership

Status: COMPLETE for the approved local Windows/PostgreSQL 18 scope. P0-03 has
not started. No commit or push was performed.

## Implemented

Better Auth provides email/password identity, verification, sign-in/out, persistent
sessions, own-session listing/revocation, password recovery/change and old/new
mailbox-confirmed email change. Me profile/settings/space APIs require a verified,
authoritative database session. There are no client-selected identity/owner fields,
public seed tools, OAuth, account linking, account deletion or business resources.

Account preferences cover locale, IANA timezone, calendar preference and week start.
Defaults are en/UTC/GREGORIAN/Monday. Input and response contracts are Zod-based,
OpenAPI 3.1 is updated, and the original P0-01 health/error contracts are unchanged.
Native provider protocol errors are mapped to the shared safe JSON error envelope.

The central personal-space policy and spaces public facade scope every ownership
lookup to the actor, returning the same 404 for missing/foreign spaces. User,
settings and initial space are created by a provider User.create query extension
using owner-provided public relation data; the provider credential write shares its
transaction. Rollback and concurrent signup/reconciliation tests prove the invariant.
Application services use their own persistence ports. No platform-to-business
imports, circular dependency, forwardRef or direct HTTP ORM access was introduced.

CORS/CSRF require exact trusted origins; callbacks are origin-checked. Cookies are
host-only, HttpOnly/Lax and Secure with the production prefix in production.
Cookie caching is disabled, database identity/verification is revalidated, refresh
cookies are forwarded, and revocation is immediate. Email change additionally
requires the provider-default fresh-session window, confirms both mailboxes and
revokes sessions. Recovery tokens expire and are single-use; reset/password change
use provider transactions and revocation. Provider hashes are used without bespoke
crypto. All IDs use the approved supported UUIDv4 fallback.

Real library rate limits apply in all environments, with socket-derived client IP
instead of caller-supplied forwarded headers. Pino omits sensitive request data and
provider messages; auth/SMTP secrets are explicitly redacted. Development mail goes
to ignored private files; tests use an in-memory sink. The SMTP adapter requires
TLS and disables debug logging. Real SMTP delivery/proxy/TLS/Docker verification
remains mandatory before deployment.

## Dependencies and architecture decisions

Existing versions remain pinned: Node 24.22.1, pnpm 10.20.0, NestJS 12.3.2,
TypeScript 6.0.3, Better Auth 1.7.14, Prisma 7.10.1, Vitest 4.1.12, Vite 8.3.5,
Zod 4.6.7 and Supertest 7.3.1. Better Auth 1.7.14 is now also an API runtime
dependency. Added approved supporting packages: official Better Auth schema CLI
(auth 1.7.14, dev), Nodemailer 10.2.1 (runtime, MIT-0), and @types/nodemailer
8.0.2 (dev). These implement the already approved auth/SMTP stack; no new technology
or infrastructure was introduced. Frozen installation and strict server peers pass.
The production advisory audit reports zero known advisories at all severities.

The HTTP adapter uses Better Auth's native standard Request/Response handler inside
Nest Express, after strict parsing, rather than feeding a consumed Node stream to
the Node helper. No third-party Nest auth adapter was added. Runtime provider
schema validation is enabled; the pinned official CLI is checked against all four
auth-owned models. Application relations are the only additions to User metadata.

After-create provider hooks are deferred until after commit in this version, so
initial relation creation is part of User.create instead. Empty-update Prisma
upsert can race; reconciliation instead uses native conflict-safe inserts followed
by owned reads in a transaction. Runtime PostgreSQL pools explicitly use UTC;
no server-wide settings were changed. Auth transactions are bounded to 15 seconds,
with five-second SMTP connection/greeting/socket timeouts.

No unapproved architectural deviation. No audit/outbox/idempotency table, generic
scoped repository, synchronization/job/storage code or later-batch helper was built.
The existing actor/correlation middleware is only extended by the minimal verified
identity needed for P0-02 endpoints.

## Migration and data handling

Migration: prisma/migrations/202610270001_p0_02_identity_ownership/migration.sql.
The provider-owned User, AuthSession, AuthAccount and AuthVerification models come
from the official generator. Application-owned UserSettings and Space are added.
The only space kind is PERSONAL; its owner is non-null, UUID/FK-constrained and
unique by kind/owner. Settings have user uniqueness/FK plus calendar/week-start
checks. No unnecessary business-domain tables exist.

The initial additive migration was applied to local mehran_dev and mehran_test,
upgrading the P0-01 table-free schema. Subsequent deploy/status checks pass as a
no-op. No existing records were reset, dropped, overwritten or migrated destructively.
Tests create and delete only their own known fixture identities in the guarded
loopback *_test database. No development seed identity was created.

An early SQL draft contained only the appended checks because a read-only CLI diff
without configured datasource returned no SQL. The isolated test attempt failed
before creating any application table. That was verified, its failed migration
metadata was marked rolled back, and the complete provider-generated migration
was then applied. The final migration has not been edited after successful deploy.
No reset/schema push or production connection occurred.

The ignored local .env received a generated random auth secret and canonical local
origin only when absent. All pre-existing owner values were preserved; neither
credentials nor tokens were printed or placed in tracked sources.

## Verification

The complete batch gate ran once at submission and passed (exit 0). Ordinary
implementation failures were fixed using targeted checks before that gate.

| Command/check                                     | Observed result                                                                                                                           |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| pnpm install --offline --frozen-lockfile          | PASS, all three workspace projects                                                                                                        |
| pnpm quality                                      | PASS, all batch gates below                                                                                                               |
| config:check                                      | PASS; safe key-only config validation                                                                                                     |
| db:generate / db:validate                         | PASS                                                                                                                                      |
| auth:schema:check                                 | PASS; provider scalar/index/relation schema matches official generator                                                                    |
| build / typecheck                                 | PASS                                                                                                                                      |
| format:check / lint                               | PASS; no warnings                                                                                                                         |
| architecture                                      | PASS; 63 modules, 173 dependencies, zero violations                                                                                       |
| pnpm test                                         | PASS; 28 unit/contract/architecture/compatibility tests in 9 files                                                                        |
| test:integration                                  | PASS; 15 PostgreSQL/HTTP/security tests in 4 files                                                                                        |
| openapi:check                                     | PASS; snapshot matches authoritative schemas                                                                                              |
| P0-01 compatibility comparison                    | PASS; existing health paths and error/health schemas unchanged                                                                            |
| db:migrations:check                               | PASS; additive statement review, deploy replay and status                                                                                 |
| Production dependency audit                       | PASS; zero known advisories                                                                                                               |
| Compiled Node API smoke                           | PASS; isolated DB signup, verification, signin, profile/settings, one personal space, health, signout/revocation and absent future routes |
| Real SMTP / trusted production proxy / Docker/TLS | DEFERRED to deployment                                                                                                                    |
| Hosted GitHub CI                                  | NOT RUN for these uncommitted changes; workflow updated                                                                                   |

Total: 43 tests passed in 13 files. Coverage includes real provider crypto/schema,
verification and reset expiry/tampering/replay, generic recovery responses,
password/session rotation, restart persistence, each revocation variant, two-step
email change, stale sessions, unverified principal denial, strict overposting,
foreign ownership, scoped lists/settings, DB unique/FK/check constraints, atomic
rollback, missing-space reconciliation races, concurrent sign-up, CSRF/CORS,
callback abuse, production cookie flags and spoof-resistant rate limiting.
The tests advance the clock between rate-limit windows; they do not disable or
weaken the actual provider limiter, security validation or architecture checks.

Repository detail: [runbook](./runbooks/authentication.md),
[requirements traceability](./p0-02-traceability.md), [OpenAPI](./api/openapi.json).
Ignored local evidence: .tools/p0-02-quality.log, .tools/p0-02-audit.json,
.tools/p0-02-compiled-smoke.json and .tools/p0-02-review.json.

## Files created (36)

- [apps/api/src/modules/account/application/account.service.ts](../apps/api/src/modules/account/application/account.service.ts)
- [apps/api/src/modules/account/application/settings.port.ts](../apps/api/src/modules/account/application/settings.port.ts)
- [apps/api/src/modules/account/http/me.controller.ts](../apps/api/src/modules/account/http/me.controller.ts)
- [apps/api/src/modules/account/infrastructure/settings.repository.ts](../apps/api/src/modules/account/infrastructure/settings.repository.ts)
- [apps/api/src/modules/account/public/identity-creation.ts](../apps/api/src/modules/account/public/identity-creation.ts)
- [apps/api/src/modules/spaces/application/spaces.port.ts](../apps/api/src/modules/spaces/application/spaces.port.ts)
- [apps/api/src/modules/spaces/application/spaces.service.ts](../apps/api/src/modules/spaces/application/spaces.service.ts)
- [apps/api/src/modules/spaces/infrastructure/spaces.repository.ts](../apps/api/src/modules/spaces/infrastructure/spaces.repository.ts)
- [apps/api/src/modules/spaces/public/identity-creation.ts](../apps/api/src/modules/spaces/public/identity-creation.ts)
- [apps/api/src/platform/auth/auth-options.ts](../apps/api/src/platform/auth/auth-options.ts)
- [apps/api/src/platform/auth/auth.controller.ts](../apps/api/src/platform/auth/auth.controller.ts)
- [apps/api/src/platform/auth/auth.module.ts](../apps/api/src/platform/auth/auth.module.ts)
- [apps/api/src/platform/auth/auth.service.ts](../apps/api/src/platform/auth/auth.service.ts)
- [apps/api/src/platform/auth/create-auth.ts](../apps/api/src/platform/auth/create-auth.ts)
- [apps/api/src/platform/auth/identity-relations.ts](../apps/api/src/platform/auth/identity-relations.ts)
- [apps/api/src/platform/auth/identity.ts](../apps/api/src/platform/auth/identity.ts)
- [apps/api/src/platform/auth/mail.service.spec.ts](../apps/api/src/platform/auth/mail.service.spec.ts)
- [apps/api/src/platform/auth/mail.service.ts](../apps/api/src/platform/auth/mail.service.ts)
- [apps/api/src/platform/auth/session.guard.ts](../apps/api/src/platform/auth/session.guard.ts)
- [apps/api/src/platform/authorization/space-policy.service.spec.ts](../apps/api/src/platform/authorization/space-policy.service.spec.ts)
- [apps/api/src/platform/authorization/space-policy.service.ts](../apps/api/src/platform/authorization/space-policy.service.ts)
- [apps/api/test/contract/openapi.spec.ts](../apps/api/test/contract/openapi.spec.ts)
- [apps/api/test/integration/auth.spec.ts](../apps/api/test/integration/auth.spec.ts)
- [apps/api/test/integration/identity-lifecycle.spec.ts](../apps/api/test/integration/identity-lifecycle.spec.ts)
- [apps/api/test/integration/production-cookies.spec.ts](../apps/api/test/integration/production-cookies.spec.ts)
- [docs/p0-02-traceability.md](../docs/p0-02-traceability.md)
- [docs/runbooks/authentication.md](../docs/runbooks/authentication.md)
- [packages/api-contracts/src/account.ts](../packages/api-contracts/src/account.ts)
- [packages/api-contracts/src/auth.ts](../packages/api-contracts/src/auth.ts)
- [prisma/migrations/202610270001_p0_02_identity_ownership/migration.sql](../prisma/migrations/202610270001_p0_02_identity_ownership/migration.sql)
- [prisma/migrations/migration_lock.toml](../prisma/migrations/migration_lock.toml)
- [tooling/auth/schema-config.ts](../tooling/auth/schema-config.ts)
- [tooling/scripts/auth-schema-check.ts](../tooling/scripts/auth-schema-check.ts)
- [tooling/scripts/migrations-check.ts](../tooling/scripts/migrations-check.ts)
- [tooling/testing/integration-setup.ts](../tooling/testing/integration-setup.ts)
- [docs/p0-02-report.md](../docs/p0-02-report.md)

## Files modified (32)

- [.env.compose.example](../.env.compose.example)
- [.env.example](../.env.example)
- [.github/workflows/ci.yaml](../.github/workflows/ci.yaml)
- [README.md](../README.md)
- [apps/api/package.json](../apps/api/package.json)
- [apps/api/src/app.module.ts](../apps/api/src/app.module.ts)
- [apps/api/src/bootstrap/api-exception.filter.ts](../apps/api/src/bootstrap/api-exception.filter.ts)
- [apps/api/src/bootstrap/configure-app.ts](../apps/api/src/bootstrap/configure-app.ts)
- [apps/api/src/bootstrap/environment.spec.ts](../apps/api/src/bootstrap/environment.spec.ts)
- [apps/api/src/bootstrap/environment.ts](../apps/api/src/bootstrap/environment.ts)
- [apps/api/src/modules/account/account.module.ts](../apps/api/src/modules/account/account.module.ts)
- [apps/api/src/modules/account/public/index.ts](../apps/api/src/modules/account/public/index.ts)
- [apps/api/src/modules/spaces/public/index.ts](../apps/api/src/modules/spaces/public/index.ts)
- [apps/api/src/modules/spaces/spaces.module.ts](../apps/api/src/modules/spaces/spaces.module.ts)
- [apps/api/src/platform/database/database.service.ts](../apps/api/src/platform/database/database.service.ts)
- [apps/api/src/platform/observability/logging.spec.ts](../apps/api/src/platform/observability/logging.spec.ts)
- [apps/api/src/platform/observability/logging.ts](../apps/api/src/platform/observability/logging.ts)
- [apps/api/test/contract/http.spec.ts](../apps/api/test/contract/http.spec.ts)
- [apps/api/test/integration/database.spec.ts](../apps/api/test/integration/database.spec.ts)
- [apps/api/test/support/application.ts](../apps/api/test/support/application.ts)
- [compose.yaml](../compose.yaml)
- [docs/api/conventions.md](../docs/api/conventions.md)
- [docs/api/openapi.json](../docs/api/openapi.json)
- [docs/runbooks/local-development.md](../docs/runbooks/local-development.md)
- [package.json](../package.json)
- [packages/api-contracts/src/index.ts](../packages/api-contracts/src/index.ts)
- [packages/api-contracts/src/openapi.ts](../packages/api-contracts/src/openapi.ts)
- [pnpm-lock.yaml](../pnpm-lock.yaml)
- [prisma/schema.prisma](../prisma/schema.prisma)
- [tooling/compatibility/stack.spec.ts](../tooling/compatibility/stack.spec.ts)
- [tooling/scripts/quality.ts](../tooling/scripts/quality.ts)
- [vitest.config.ts](../vitest.config.ts)

Files removed: none. Generated clients, builds, package caches, private mail and
local credentials remain ignored; existing untracked/ignored owner data is preserved.

## Git and next step

Branch main remains at 39e896ca654adac539562e021f13d81c96a7abbb; all changes above are
uncommitted and unstaged. No push or new commit was made. Git reports an environment
permission warning reading the user's global ignore file; repository operations
and explicit ignore checks remain usable. No local P0-02 blocker remains.
P0-02 is ready for owner review. P0-03 has NOT STARTED and requires explicit approval.
