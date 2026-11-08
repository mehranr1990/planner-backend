# P5-02 local acceptance report

Batch: **P5-02 — Advanced Messaging**. Status: **COMPLETE for the approved local
scope**, 2026-11-08. Phase 5 as a whole is not complete.

## Publication prerequisite

P5-01 was committed and pushed first, using exactly its 54 accepted paths
(31 modified, 23 new). Published commit and independently verified actual remote
SHA: **dd73a901b1ed55d5a44d5fda225b798143003166**. Parent:
8ab53e6c5d6acb973c64f81ad27ccd4e01e25fe8. P5-01 accepted quality evidence was
reused for publication; its full gate was not repeated just to publish.

## Scope, files and contracts

Implemented replies/threads, Unicode emoji reactions, author edits/deletion,
personal visibility, live authorized forwarding/chains, pins, explicit mentions,
authorized search, private reports/scoped moderation and immutable history.
Both owner decisions in [ADR 0046](adr/0046-advanced-messaging-permissions-and-forwarding.md)
are approved; no policy question remains open.

There are **35 P5-02 paths: 19 modified tracked files and 16 new files**. The
[manifest](p5-02-change-manifest.json) lists every path and its hash (excluding its
own self-reference). Messaging owns the new service/controller and storage;
Spaces supplies current authorization fences and opaque invalidation metadata.
Supporting changes cover contracts/OpenAPI, migration/cleanup verification and
tests. The compiled smoke reuses the P5-01 process fixture through an explicit
advanced mode, avoiding a duplicate fixture.

Added **11 REST operations**: one typed command endpoint and ten read endpoints.
OpenAPI now contains **711 operations / 6,346 resolved references**. All 14 P5-01
operation shapes and earlier frozen baselines are preserved; an additive
196-signature P5-01 snapshot closes its compatibility gap. See the
[contract](p5-02-contract.md) for exact routes, command variants, concurrency,
bounded pagination, cursor resnapshot and client cache behavior.

Entities/migrations/constraints: M041 adds eleven tables, 26 typed FKs, two
Conversation counters and one legacy identity unique key. Metadata-only TEXT
headers/change events are backfilled and maintained for legacy writers by a
transactional trigger. Histories reject update/delete. No published migration,
body constraint or prior FK was weakened. See [migration review](p5-02-migration-review.md).

Domain events/jobs: existing shared signed audit/outbox transactions record only
metadata; a durable ordered message-change feed supplies current projections.
No new job, Push delivery or external consequence consumer was introduced.

Security/edges: all operations enforce current accepted participation, exact
source authority, Viewer restrictions, own join window/admission generation,
account/identity/custody fences and safe idempotency. Author edits/deletes use the
inclusive 48h boundary; work deletion defaults denied until authorized policy.
Moderation is separately scoped and reasoned. Forward readers must retain access
at every source hop. Deleted/hidden/revoked bodies cannot be recovered through
legacy retries, delayed events, search, revision APIs or forwarding. Existing
disposal blockers protect the new retained history before destructive cleanup.

## Verification

The mandatory 13-stage quality command ran **once**, through the approved fresh
canonical baseline runner and a child-only TEST_DATABASE_URL override:

```powershell
node --env-file-if-exists=.env.test.local .tools/p5-02-baseline.mjs --run quality
```

| Stage               | Actual result                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| config:check        | PASS                                                                                                              |
| db:generate         | PASS                                                                                                              |
| auth:schema:check   | PASS                                                                                                              |
| db:validate         | PASS                                                                                                              |
| build               | PASS; affected final build also PASS                                                                              |
| typecheck           | PASS; affected final check also PASS                                                                              |
| format:check        | PASS                                                                                                              |
| lint                | PASS; affected final check also PASS                                                                              |
| architecture        | PASS; final 516 modules / 3,327 dependencies, no violations                                                       |
| test                | Initial 645 passed / 1 failed; affected 31/31 PASS, including the preserved foundation test and new contract case |
| openapi:check       | PASS; affected final check also PASS                                                                              |
| test:integration    | 856/856 PASS; final focused messaging 62/62 PASS                                                                  |
| db:migrations:check | PASS, including M041 rollback/backfill/preservation/repeat deploy                                                 |

The raw full quality process exited 1 because the historical foundation contract
test expected its path builder to expose only 14 operations. Foundation and
advanced builders were separated, preserving that test unchanged. Only affected
checks were rerun. A final thread-anchor correction was covered by the focused
messaging rerun and fresh build/typecheck. Initial focused testing also exposed
and corrected signed-action naming and unnecessary sibling-target cursor
invalidation; those behaviors pass in final coverage.

**1,504 distinct cases now pass across the full run and affected reruns: 647
non-integration and 857 integration**, including 49 added cases. Counts are unions,
not sums of repeated runs. The final extra read-only-group test accounts for the
integration difference between the full run and final coverage.

Affected commands/results:

```powershell
pnpm.cmd build
pnpm.cmd typecheck
pnpm.cmd lint
pnpm.cmd architecture
pnpm.cmd openapi:check
pnpm.cmd test packages/api-contracts/src/messaging.spec.ts packages/api-contracts/src/advanced-messaging.spec.ts apps/api/src/modules/messaging/domain/advanced-messaging.spec.ts tooling/compatibility/openapi.spec.ts
node --env-file-if-exists=.env.test.local .tools/p5-02-baseline.mjs --run test:integration apps/api/test/integration/messaging.spec.ts
node --env-file-if-exists=.env.test.local .tools/p5-02-baseline.mjs --run smoke:p5-02
```

All listed affected commands PASS. The actual compiled API/worker smoke verifies
API restart, persistent replies/reactions/pin/edit/report/redaction, safe report
replay, unavailable deleted forwards, reusable legacy polling/idempotency and
worker BLOCKED_POLICY before disposal. Revision/report rows remain intact across
worker restart. Local ignored logs are .tools/p5-02-quality.log,
.tools/p5-02-test-integration.log and .tools/p5-02-smoke-p5-02.log.

Migration rehearsal preserves **194 predecessor datasets**, populated five-table
P5-01 history, **64 prior checksums and every old constraint**; forced interruption
rolls back, backfill is exact and deployment repeats safely. The fresh baseline
has **65 matching canonical checksums and 681 FKs**, with the reviewed catalog
digest recorded in the migration review. An earlier owned development baseline
was preserved and replaced by a different newly created acceptance database when
the unpublished forwarding reference was refined; no protected database was
repaired, migrated or reset.

Preservation PASS: original legacy **190 table datasets including ledger** and
columns/constraints/functions/triggers/indexes match their recorded digests.
Previously accepted P4-06 and P5-01 databases retain 63/64 migrations and 637/655
FKs respectively; M041 was not applied to either. All **65 historical migration
artifacts, 5 protected environment files and 12 unrelated documents** remain
byte-identical. Secrets/URLs/runtime evidence are excluded from task changes.

Tests not run: Docker/deployment/production migration and Shared activation are
outside this authorized local batch. P5-03 delivery, P5-04 realtime (DEFERRED),
media/voice, meetings and P5-06 final lifecycle/load/recovery remain unimplemented.
Exact legal retention and external DM triage remain separately authorized work;
no retention default, hosted provider or new dependency was introduced.

Deviations from binding specifications: **none**. Outstanding P5-02 blockers or
ADRs: **none**. Operational limitations are the documented live-reference/cache
protocol, bounded scanning/forward graph and deferred lifecycle/triage capabilities.

Git: main/HEAD and origin/main remain at the published P5-01 SHA above. P5-02 is
**unstaged, uncommitted and unpushed**: 19 modified paths, 16 new task files, plus
the original 12 unrelated untracked documents; index is empty. No deployment or
production change was performed.

Next planned action: owner review of this local report/manifest. P5-02 publication
requires separate authorization. Next eligible implementation batch: **P5-03
(NOT STARTED; separate owner approval required)**.
