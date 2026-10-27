# P0-01 traceability

| Requirement                | Implementation                                      | Verification                                                                         |
| -------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Workspace/strict ESM       | apps/api, packages/api-contracts, shared TS configs | build, typecheck                                                                     |
| Safe config/startup        | bootstrap/environment, main                         | environment unit tests, config:check, compiled startup smoke                         |
| Logging/privacy            | platform/observability/logging                      | logging unit test, HTTP error tests                                                  |
| Request/correlation IDs    | bootstrap/request-context                           | HTTP contract tests                                                                  |
| Strict validation/errors   | Zod schemas, validation pipe, exception filter      | HTTP malformed/oversized/overposting tests                                           |
| Live/ready health          | HealthController, Prisma DatabaseService            | HTTP contracts, read-only PostgreSQL integration                                     |
| OpenAPI 3.1                | Zod JSON schemas and deterministic generator        | compatibility probe, openapi:check                                                   |
| Module/layer boundaries    | dependency-cruiser + ESLint restrictions            | architecture gate and forbidden-import regression probe                              |
| Stable stack compatibility | pinned packages, native ESM, Vitest/Oxc             | compatibility suite: metadata DI, Better Auth Node health handler, model-free Prisma |
| Isolated CI DB             | explicit TEST_DATABASE_URL and loopback guard       | configuration unit tests, CI PostgreSQL service                                      |
| Canonical instructions     | AGENTS.md and approved amendment                    | legacy rule merge verified before removal                                            |
| Docker deployment          | Dockerfile, compose.yaml, release runbook           | DEFERRED until Docker release                                                        |

No business entities, migrations, events, jobs, auth endpoints or permissions are
implemented in this batch. Better Auth's test-only health handler verifies
transport compatibility without installing an auth schema or testing sessions.
P0-02 must prove real authentication persistence, revocation and ownership.

Because P0-01 intentionally has no auth models, schema validation is disabled
only in the test-only Better Auth transport probe. This is not an application
auth configuration. P0-02 must use generated auth-owned models and enabled
schema validation before claiming auth/database compatibility.
