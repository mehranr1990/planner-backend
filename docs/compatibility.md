# P0-01 bounded compatibility spike

Native ESM is selected (`type: module`, TypeScript NodeNext, `.js` import
specifiers). NestJS 12 and Better Auth ship ESM entry points. No CommonJS bridge,
second compiler/test runner or community Nest auth wrapper is introduced.

| Component                         | Exact selection                       | Evidence / limit                                                                              |
| --------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------- |
| Node.js                           | 24.22.1                               | Active NVM runtime; compatibility suite asserts this version                                  |
| pnpm                              | 10.20.0                               | Workspace install with strict server peers and exact manifests                                |
| Nest common/core/Express/testing  | 12.3.2                                | Compiles; HTTP contracts and constructor injection pass                                       |
| Nest CLI/schematics               | 12.0.11                               | Node 24 / TypeScript 6-compatible package metadata; watch tooling                             |
| TypeScript                        | 6.0.3                                 | Strict NodeNext build and typecheck                                                           |
| Vitest / Vite                     | 4.1.12 / 8.3.5                        | Existing runner family retained; Oxc legacy decorators/metadata enabled and verified          |
| Prisma/client/pg adapter          | 7.10.1                                | Model-free client generation and build succeed; no schema writes                              |
| Better Auth                       | 1.7.14                                | Prisma adapter construction and test-only Node health handler via actual Nest Express app     |
| Zod                               | 4.6.7                                 | Strict runtime validation; native JSON Schema export                                          |
| OpenAPI                           | 3.1.0                                 | Deterministic schema-first generation directly from Zod; reviewed snapshot                    |
| nestjs-pino / Pino / pino-http    | 5.3.1 / 10.4.0 / 11.0.0               | Supported Nest 12 peers; structured redaction test                                            |
| pg / Supertest                    | 8.23.1 / 7.3.1                        | Prisma driver adapter / actual HTTP contract tests                                            |
| ESLint / typescript-eslint        | 10.13.0 / 8.72.1                      | Flat config; parser peer range includes TypeScript 6.0                                        |
| Prettier / eslint-config-prettier | 3.9.10 / 10.1.8                       | Repository formatting and lint reconciliation                                                 |
| dependency-cruiser                | 18.7.0                                | Node 24 support; forbidden-import, cycle and layer regression probes                          |
| PostgreSQL                        | 18.6 local / 18.6-bookworm deployment | Real Prisma development/test queries and compiled readiness passed; container checks DEFERRED |

The spike does not implement sign-up, sessions or ownership. Since P0-01 has no
auth models, Better Auth schema validation is disabled only inside its test-only
transport probe. P0-02 must generate the auth-owned schema, enable its schema
validation, and test persistence/revocation against real PostgreSQL. No result
here claims those authentication acceptance tests have already passed.

`peerDependencyRules.ignoreMissing` excludes only React/React DOM peers of
unused Prisma Studio and optional Better Auth browser clients. Auto peer
installation is disabled; all other peer failures remain fatal. This avoids
installing a frontend for a backend repository. Direct dependencies use MIT or
Apache-2.0 licenses (the application itself remains private/UNLICENSED).

Purpose review: Prisma/pg provide the approved DB foundation, Zod supplies both
validation and OpenAPI schemas, Pino supplies logging, and the remaining direct
packages implement the approved runtime, tests and gates. Better Auth is a
development-only spike dependency until the approved authentication batch.

Primary references reviewed:

- [NestJS 12 migration and runtime requirements](https://docs.nestjs.com/migration-guide)
- [Vite metadata support and its limits](https://vite.dev/guide/features)
- [Better Auth Express integration](https://better-auth.com/docs/1.6/integrations/express)
- [Prisma model-free generation](https://www.prisma.io/docs/cli/v7/generate)
- [PostgreSQL 18.6 release](https://www.postgresql.org/docs/release/18.6/)
- [Official PostgreSQL image tags](https://github.com/docker-library/official-images/blob/master/library/postgres)

Exact package manifests and lockfile are the installed dependency record.
Deployment images remain subject to release-time build, digest and persistence
verification. No Docker command is required or run for the local spike.
