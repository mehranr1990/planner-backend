# P0-04 — Private files, security and Phase 0 gate

Status: COMPLETE for the approved local Windows/Node/PostgreSQL scope. Phase 1,
including P1-01, is NOT STARTED. No commit or push was performed.

## Delivered

StoredFile metadata, a private StoragePort filesystem adapter and exactly four
file routes: initiation, streamed completion, authenticated signed download and
deletion. Completion verifies actual size, content signature/UTF-8 and SHA-256;
filenames are display metadata, never paths. Downloads recheck session/owner,
verify stored bytes, force attachment/no-store/nosniff/sandbox and never expose
object keys or volume paths. READY completion can be retried with JSON `{}` to
renew the signed link without changing the file.

Existing identity/session/verification/revocation, one Personal Space, database
constraints, API bodies/errors, audit/outbox/idempotency/concurrency and ownership
boundaries remain compatible. Storage imports no business internals; the root
composition injects the spaces public facade through a narrow scope resolver.
Controllers do not access ORM; only StoragePort touches physical bytes.

File initiation can use P0-03 scoped idempotency receipts. Conditional claims and
revisions prevent duplicate completion. Persistent attempt/status/purge markers
support cancellation, interrupted publication and deletion retry. In-process
uploads are aborted/drained on cancellation; durable markers cover another
process or a crash. A lost COMMIT response never causes READY bytes to be removed.
Explicit bounded scoped reconciliation preserves live/READY/foreign files; no
worker, scheduled sweep, queue, consumer or dispatcher is activated.

Sensitive file endpoints use the approved native throttler with verified actor
keys. Input caps apply to JSON, fixed-length and chunked binary requests. Audits
add only a nullable resource UUID; content, filenames, hashes, paths, object keys,
signatures and URLs are excluded. Existing Pino redaction is extended. Bootstrap
validates configuration before loading the heavy application graph, preserving
the original fail-fast missing-config contract and its timeout.

Private-volume Compose/image configuration, validated environment templates,
local/file operations, recovery and coordinated encrypted off-host backup/restore
definitions are updated. There are no Phase 1 entities/attachment links, public
file mounts, R2, Redis, BullMQ, business modules or speculative infrastructure.

## Decisions and limits

- The four-route protocol accepts raw bytes at completion; no fifth upload URL,
  multipart dependency or client assertion of physical metadata is introduced.
- Initial MIME allowlist: text/plain, application/pdf, image/png, image/jpeg.
  These are type/signature checks, not full decoding or antivirus. Formats remain
  attachments; audio/business capture is not implemented ahead of Phase 1.
- Default file limit 10 MiB (configurable up to 100 MiB), upload timeout 120s,
  initiation expiry 1h and signed-link TTL 5min. Configuration is bounded.
  Expiry concerns temporary initiation/links, not legal retention of READY files.
- Relative local storage resolves from repository root, so dev/start working
  directories cannot move existing data. Production requires an absolute root.
- Native throttler actor limits: initiate 20/min, complete 10/min, download
  60/min, delete 20/min. The approved single API process uses in-memory limits;
  existing Better Auth auth/recovery limits remain enabled. No proxy headers
  choose file limiter identity.
- UUID-only keys, exclusive staging, symlink/junction/unexpected-hardlink checks,
  inode checks, bounded streams and atomic non-overwriting publication protect
  paths. Linux additionally fsyncs directory entries; Windows uses file fsync
  and requires operational NTFS ACL protection. Host ACL/Linux power-loss and
  real volume durability checks remain deployment gates.
- Physical I/O is not falsely described as a PostgreSQL transaction. Durable
  state makes incomplete bytes unreadable and cleanup retryable. Database
  uncertainty retains evidence; successful READY status/audit commit together.
- Link signatures are domain-separated HMACs bound to actor/space/file/expiry;
  they never replace the verified provider session. Rotating the existing auth
  secret invalidates old links; an authorized owner can renew them.

No unapproved architectural deviation or binding-document change. Exact file
rules and operational limitations are documented in the private-file runbook.

## Schema and migrations

New migration:
`prisma/migrations/202610270003_p0_04_private_files/migration.sql`.

Adds StoredFile/StoredFileStatus, immutable identity/scope/object-key metadata,
expected/actual evidence, lifecycle timestamps/revision/attempt/purge markers,
unique/indexed scope access, a composite FK to Space ownership, and size/type/
hash/attempt/READY/deletion constraints. SecurityAuditEvent gains nullable
resourceId. No provider-owned scalar or existing applied migration is modified.

Applied successfully to local mehran_dev and isolated mehran_test on PostgreSQL
18.6. Both now have three successful migrations, with matching script checksums
(including accepted newline representations) and zero temporary migration schemas
remaining. No existing database/schema reset, schema push, destructive migration,
role recreation, production connection or unrelated data deletion occurred.

Migration verification replays from empty, upgrades the previous P0-03 schema
with preferences/revision, outbox, audit and idempotency fixtures intact, checks
the new nullable audit field, and repeats deploy/status. Reset/cleanup targets
only freshly-created disposable fixture schemas in the guarded test database.
Rollback guidance is an additive forward fix; do not drop populated file/evidence
tables or rewrite the prior migration history.

## Dependencies and compatibility

Added the already-approved `@nestjs/throttler` **6.7.1** (API runtime and root dev
resolution), MIT, compatible declared Nest 12/reflect-metadata peers. It is the
only added package; no unrelated package version was changed. The
[official Nest rate-limiting guidance](https://docs.nestjs.com/security/rate-limiting)
documents this module and guard customization; published package metadata and
actual guarded HTTP/rate tests were verified.

Existing pins remain Node 24.22.1, pnpm 10.20.0, NestJS 12.3.2, TypeScript 6.0.3,
Better Auth 1.7.14, Prisma/adapter/client 7.10.1, PostgreSQL 18.6, pg 8.23.1,
Vitest 4.1.12/Vite 8.3.5, Zod 4.6.7 and Supertest 7.3.1. Frozen offline install,
strict peers, native ESM/NodeNext, Vitest decorators, provider schema validation
and compiled Node operation pass. Production dependency audit reports zero known
advisories at every severity. No Jest or second runner was added.

## Verification — actual results

The complete `pnpm quality` gate ran once. It exercised every required stage and
found one formatting issue, a production SMTP unit fixture missing the newly
required absolute storage root, and the compiled missing-config startup timeout.
These were corrected without weakening tests: the original startup test keeps
its 10-second bound, configuration now precedes heavy imports, and the SMTP
fixture supplies its required path. Relevant failed/affected gates were rerun.
The aggregate first invocation exited 1; final individual gate results below
are PASS. No full suite was repeatedly run after small changes.

| Command/check                                                                                                                                 | Final observed result                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| pnpm install --offline --frozen-lockfile                                                                                                      | PASS, all three workspaces                                                                 |
| pnpm config:check                                                                                                                             | PASS, values withheld                                                                      |
| pnpm db:generate / pnpm auth:schema:check / pnpm db:validate                                                                                  | PASS, provider-owned schema preserved                                                      |
| pnpm build / pnpm typecheck                                                                                                                   | PASS, including final bootstrap correction                                                 |
| pnpm format:check / pnpm lint                                                                                                                 | PASS after correction; report separately formatted/checked                                 |
| pnpm architecture                                                                                                                             | PASS, 90 modules/303 dependencies, zero violations                                         |
| pnpm test                                                                                                                                     | 49 tests in 12 files covered; two initial failures corrected and affected files rerun PASS |
| pnpm exec vitest run --project unit apps/api/src/platform/auth/mail.service.spec.ts --project contract apps/api/test/contract/startup.spec.ts | PASS, all 4 tests, including both previously failing cases                                 |
| pnpm openapi:check                                                                                                                            | PASS, current snapshot and P0-02/P0-03 compatibility baselines                             |
| pnpm test:integration                                                                                                                         | PASS, 34 tests in 6 files, including all earlier-batch regressions                         |
| pnpm db:migrations:check                                                                                                                      | PASS, additive/empty/prior-data upgrade/repeat/history checks                              |
| pnpm db:migrate:deploy / pnpm db:check                                                                                                        | PASS, local additive migration and real SELECT 1                                           |
| Compiled Node HTTP/process recreation smoke                                                                                                   | PASS, actual application and PostgreSQL 18.6                                               |
| pnpm audit --prod --json                                                                                                                      | PASS, all vulnerability severity counts zero                                               |
| Git/secret/artifact/history review                                                                                                            | PASS; no secrets/artifacts included, prior migrations unchanged                            |

Final coverage: **83 tests in 18 files**: 49 unit/contract/architecture/
compatibility and 34 integration. No unresolved failures. New checks include:

- Valid file/UTF-8/hash roundtrip; content/size/hash/malformed UTF-8 rejection;
  traversal, reserved/control/lone-surrogate names, root junctions and hardlinks.
- One row for concurrent same-key initiation, changed fingerprint conflict,
  foreign receipt separation, competing completion and active cancellation.
- Real partial HTTP disconnect, chunked overflow 413 and bounded stream timeout.
- Mandatory session/verification/revocation, cross-user completion/download/delete,
  copied/expired/tampered links, renewal, CSRF/CORS and direct-volume URL denial.
- Same-size corrupt bytes rejected before delivery; failed physical deletion
  blocks new access and retries; ambiguous commit response preserves READY bytes.
- Scoped stale cleanup/noop retry; live/READY/foreign data preserved; real database
  ownership/lifecycle constraints and audit-sink failure before file access.
- Real actor rate limits despite spoofed headers, metadata-only audit and log
  redaction; unchanged auth/session/concurrency/outbox/health security regressions.

The compiled smoke used a separate Node process and private temporary root,
verified 201 initiation, 200 completion/download, byte equality after an actual
process restart, signed-link renewal, foreign download/delete 404, anonymous 401,
direct blob URL 404, owner delete 204 and subsequent download 404. Physical bytes
were removed and expected metadata audit actions persisted. An initial startup
readiness wait expired; the final bounded 30-second valid-startup smoke passed
after clean rebuild/startup hardening. This is distinct from the unchanged
10-second invalid-config contract. Children and exact test fixtures were cleaned;
no development identity/file was seeded.

Reproducible tests/contracts/runbooks are committed-source candidates. Local
detailed evidence is ignored under .tools/p0-04: quality.log (initial failures),
files-targeted.log, compiled-smoke.json, databases.json, dependency-audit.json and
review.json. No credentials, signatures or private mail belong in Git.

## Files

18 created, 31 modified, none removed. See the exact inventory below.

Created:

```text
apps/api/src/platform/storage/content-policy.ts
apps/api/src/platform/storage/download-links.ts
apps/api/src/platform/storage/files.controller.ts
apps/api/src/platform/storage/files.repository.ts
apps/api/src/platform/storage/files.service.ts
apps/api/src/platform/storage/local-storage.ts
apps/api/src/platform/storage/storage.module.ts
apps/api/src/platform/storage/storage.port.ts
apps/api/src/platform/storage/storage.spec.ts
apps/api/test/integration/files.spec.ts
docs/p0-04-report.md
docs/p0-04-traceability.md
docs/runbooks/backup-restore.md
docs/runbooks/private-files.md
packages/api-contracts/src/files-openapi.ts
packages/api-contracts/src/files.ts
prisma/migrations/202610270003_p0_04_private_files/migration.sql
tooling/compatibility/p0-03-api-signatures.json
```

Modified:

```text
.env.compose.example
.env.example
Dockerfile
README.md
apps/api/package.json
apps/api/src/app.module.ts
apps/api/src/bootstrap/api-exception.filter.ts
apps/api/src/bootstrap/configure-app.ts
apps/api/src/bootstrap/environment.spec.ts
apps/api/src/bootstrap/environment.ts
apps/api/src/main.ts
apps/api/src/platform/audit/audit.service.ts
apps/api/src/platform/auth/mail.service.spec.ts
apps/api/src/platform/database/foundation.spec.ts
apps/api/src/platform/observability/logging.spec.ts
apps/api/src/platform/observability/logging.ts
apps/api/test/contract/openapi.spec.ts
apps/api/test/support/application.ts
compose.yaml
docs/api/conventions.md
docs/api/openapi.json
docs/runbooks/docker-release.md
docs/runbooks/local-development.md
package.json
packages/api-contracts/src/index.ts
packages/api-contracts/src/openapi.ts
pnpm-lock.yaml
prisma/schema.prisma
tooling/compatibility/openapi.spec.ts
tooling/scripts/migrations-check.ts
tooling/scripts/openapi.ts
```

## Phase 0 exit and remaining deployment work

All approved **local** P0-04 acceptance criteria and Phase 0 checks are satisfied:
identity/session/ownership foundation, private streamed lifecycle/isolation,
migration/transaction/event/reliability baseline, security/contract/architecture
gates and operational definitions. Local storage survives API recreation.

The following remain **DEFERRED / NOT RUN**, never claimed passed:

- Docker image build/start/recreate, actual named-volume persistence, non-root
  volume ownership, Linux permissions/directory-fsync/power-loss behavior.
- Actual deployment HTTPS/reverse-proxy/direct-volume denial, host firewall,
  SMTP delivery, disk-capacity alerts and Windows/Linux operational ACL review.
- Coordinated encrypted off-host database/file backup and isolated restore drill;
  owner-selected destination, retention, recovery objectives and incident policy.
- Hosted GitHub Actions execution for this uncommitted change.

No Docker/WSL installation or command was run. Actual Docker/deployment checks
remain mandatory before release; local COMPLETE does not mean deployment-ready.
No local blocker or additional architectural ADR is required for this batch.

Git: main remains at approved P0-03 commit 14cd427; 31 modified tracked files and
18 new files are unstaged. Nothing was committed/pushed. Existing owner files,
credentials, generated artifacts and prior migration history are preserved.

Next eligible batch: **P1-01, NOT STARTED. Await explicit owner approval.**

## Final Phase 0 verification

The owner-requested finalization gate ran `pnpm quality` once against the final
implementation state and passed with exit 0: all mandatory local stages, 49
unit/contract/architecture/compatibility tests and 34 integration tests (83 tests
in 18 files). No implementation change or failing-check retry was required during
this finalization. Development and test PostgreSQL 18.6 databases are healthy;
all three applied migration checksums match the reviewed scripts.

The earlier Git/verification sections record the batch-submission state. Final
commit/push authorization is supplied separately by the owner; commit hashes are
recorded in Git history. Docker/deployment/backup gates above remain DEFERRED,
and Phase 1/P1-01 remains NOT STARTED.
