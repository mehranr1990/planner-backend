# 0019: Durable queue schema lifecycle and channel adapter dependencies

Status: APPROVED by owner, 2026-10-29, for P1-10 implementation.

## Context and reviewed evidence

P1-10 explicitly requires pg-boss/PostgreSQL jobs and configured SMTP/Web Push.
The existing schema has immutable outbox events but no dispatch progress. Queue
library installation includes vendor-owned functions and tables that are not
ordinary additive Prisma business migrations. Web Push needs standard encryption
and VAPID support; implementing that cryptography locally is inappropriate.

Official npm metadata and published source were inspected:

| Dependency         | Exact version | Purpose / compatibility                                                       | License    |
| ------------------ | ------------- | ----------------------------------------------------------------------------- | ---------- |
| pg-boss            | 12.38.0       | Required PostgreSQL queue; Node >=22.12, PostgreSQL >=13; matches Node24/PG18 | MIT        |
| @opentelemetry/api | 1.9.0         | Mandatory pg-boss import/peer only, with telemetry explicitly disabled        | Apache-2.0 |
| web-push           | 3.6.7         | Configured Web Push encryption/VAPID adapter; Node >=16                       | MPL-2.0    |
| @types/web-push    | 3.6.4         | Compile-time types only                                                       | MIT        |

References: [pg-boss](https://github.com/timgit/pg-boss),
[Web Push](https://github.com/web-push-libs/web-push), official npm package metadata.
Pin exact direct versions and the full pnpm lockfile, retain package license
notices, and use unmodified vendor packages. No service/provider fee or SaaS
subscription is introduced. Review transitive production dependency advisories
before completion and report unresolved findings instead of silently upgrading
locked unrelated packages. The peer API adds no SDK, exporter, collector, tracing
pipeline or telemetry integration; pg-boss telemetry is explicitly disabled.

The exact review artifact is [pg-boss schema SQL](../../tooling/compatibility/pgboss-12.38.0-schema.sql), with its [MIT notice](../licenses/pg-boss-MIT.txt).

## Proposed bounded decision

- The architecture-required pg-boss dependency is approved for this batch. Explicitly
  approve the minimal peer API and Web Push adapter/types above for configured
  channel support. Nodemailer is already installed and remains the SMTP adapter.
  No Redis/BullMQ, dashboard/proxy packages, new workers beyond the required one,
  external NLP, bank/payment integration or other infrastructure.
- Keep the five application entities and outbox progress in additive reviewed
  Prisma migrations in the public application schema. Preserve all earlier files,
  provider auth schema, data and migration history. No application schema push/reset.
- pg-boss owns only a separate fixed `planner_jobs` schema, vendor schema version 46. Its reviewed construction SQL is 22056 bytes, SHA-256
  `33395ea7aaf8d17f4eceec23c45fcb6672a278f11d3c1a255d8589491278e238`.
  The plan contains 11 logical vendor infrastructure tables, internal partitions,
  functions/indexes/types; no public-schema references or SECURITY DEFINER functions.
  They are required queue implementation storage, not extra business entities or
  future application workflows. Only the minimal current queues are populated.
- Approve this narrowly scoped vendor-schema migration exception: check in the
  exact public getConstructionPlans output and hash, and install it only through
  an explicit one-off `jobs:migrate` command. Validate the pinned vendor package,
  schema name, exact plan/hash and expected empty/existing vendor schema before
  execution. Store/check installation hash metadata plus vendor version in both
  development and test. Existing mismatches stop; no automatic upgrade/uninstall,
  generic unreviewed SQL permission, or touching public application tables.
- This vendor schema lifecycle is separate from Prisma's application migration
  ledger, as the library owns its internal format. Report both application
  migration checksums and vendor version/plan hash. The generic application
  destructive-migration rejection and ADR0015/0016 exceptions remain unchanged.
- Queue clients use migrate:false and createSchema:false. Worker startup verifies
  existing schema readiness and refuses mismatches; neither process installs or
  upgrades schemas. The API persists authoritative work without opening a queue
  connection, so a stopped worker cannot block unrelated Task/Finance requests. Pre-create the
  bounded outbox/delivery/sweep/dead-letter queues during the explicit setup command.
  Permit only normal vendor-owned runtime queue data/partition maintenance within
  planner_jobs, never application DDL. Disable unnecessary queue statistics,
  automatic reindexing and telemetry. Application delivery history is authoritative
  and retained independently of disposable queue jobs; terminal queue jobs may be
  removed after seven days. No application notification/history purge is added.
- Tests use explicitly isolated local test databases and unique validated
  `planner_jobs_test_<32hex>` schemas, with the reviewed plan normalized only for
  that exact safe schema identifier. Installation/cleanup is restricted to the
  newly created owned namespace; never drop/reset configured databases or the
  shared standard queue schema. Migration gates test empty/repeated vendor setup,
  exact-plan drift rejection, source-data preservation and restart recovery.
- Run one worker entrypoint from the existing application build/image. Local
  Windows execution is supported; Compose service documentation/configuration may
  be extended, but Docker/production execution checks remain deferred. The API
  never starts a worker implicitly. Worker startup and durable periodic sweep jobs
  repair enqueue/ack gaps using authoritative application rows and unique effects.
- Queue payloads contain opaque IDs only. Worker wrappers sanitize every failure
  before pg-boss serializes it; no provider errors, SQL input, endpoint/auth keys or
  reminder content enters queue output/logs. Owned outbox consumer progress commits
  atomically with reminder scheduling changes through platform-owned contracts.
- Default external modes are disabled. EMAIL requires explicit server enablement
  plus existing SMTP configuration or explicit nonproduction sink. WEB_PUSH requires
  explicit webpush mode plus valid VAPID configuration, or a nonproduction sink.
  User preference opt-in remains independently required. Sink never makes network
  calls. Production rejects test/sink Push configuration. No external send is used
  in automated local tests unless it is a controlled test adapter.
- Reuse private mail sink conventions and SMTP connection limits. Use web-push for
  encrypted HTTPS with fixed provider allowlist, valid keys, bounded request time,
  no redirects, deterministic topic and generic payloads. Do not implement browser
  UI/service workers or custom cryptography. VAPID private material stays in
  environment/secret configuration, never fixtures or tracked generated files.

## Alternatives and verification

Silent startup schema creation violates the controlled migration rule. Copying
vendor tables into ad hoc application models loses library compatibility. A raw
general SQL bypass weakens migration safety. Homemade Web Push/VAPID cryptography
or public endpoint forwarding adds avoidable security risk. A second broker is
unapproved. These alternatives are rejected.

Verify exact package/plan hashes, application/queue schema isolation, no public
schema mutation during vendor setup, configured channel gating, privacy/SSRF
denial, partial endpoint failure, stale subscription cleanup, real pg-boss jobs,
deduplication, bounded retry/dead-letter recovery and actual compiled worker/API
restart. Preserve all earlier API contracts and run all mandatory quality gates.

Owner approval: Explicit approval of this proposal in the P1-10 session.
