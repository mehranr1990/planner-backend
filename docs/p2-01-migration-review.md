# P2-01 migration review

The owner authorized complete P2-01 implementation on 2026-11-04. This engineering
review promotes the rehearsed G0 shape; it is not production deployment approval.
Historical migrations and G0 candidate bytes remain unchanged.

| Artifact                                         | SHA-256                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| `202611040001_shared_space_kind/migration.sql`   | `80c62729e0d5b534194bda06b415ce817e96a4341000cac729d740b8db68b56d` |
| `202611040002_shared_space_kernel/migration.sql` | `0901f65badfef176120ff6b6e10f859d24ebe9085e1518919bb1566ba25edfde` |
| `202611040003_shared_exit_retry/migration.sql`   | `e2ef7e503e9d0cae86dc96e2887d9602771cb768fe83c68368900daca6085bd3` |

M01 is byte-identical to the G0 enum candidate and commits before using SHARED.
M02 preserves the candidate's typed custody, conditional owner CHECK, reviewed
owner DROP NOT NULL, all existing owner-composite FKs, exclusive shape/custodian/
interval/job triggers and Personal-only source guards. It adds no source transfer
or attribution relaxation. Function names use `shared_` rather than `g0_`, and
`SET search_path FROM CURRENT` pins each function to the actual migration schema.
The upgrade gate checks catalog `proconfig` in an independent runtime connection.

M02 additionally adds durable exit progress, a shared-only outbox and usage ledger,
plus a generation guard preventing same-generation resurrection, skipped generation
increments or admission identity moves. M03 adds bounded exit retry metadata/index.
There are 14 new tables, 81 application/provider models, 82 tables including the
Prisma ledger, and 27 application migrations. Prisma represents actual shared FKs;
partial uniqueness and deferred/check/trigger constraints remain reviewed SQL.

The exact M01/M02 filename/hash exceptions are registered in
`tooling/testing/reviewed-shared-kernel.ts`; generic procedural/enum/nullability
rejection remains intact. M03 passes the unchanged generic additive review.
Renamed or edited exceptional SQL is rejected. No new library or provider is used.

## Preconditions, locking and forward recovery

Before non-test application: reviewed backup and compatible release, the 24 baseline
migration checksums, no existing shared objects/invalid Personal owners, no open
transactions holding Space DDL locks, and an explicit one-off migration window.
The kernel transaction uses five-second lock and 30-second statement timeouts.
CHECK validation and ALTER TABLE require table locks; this is not a zero-lock claim.
Indexes target new empty tables. Production-volume timing needs measurement before
deployment; local populated upgrade evidence is recorded by the gate.

M01 may commit independently. Interrupted M02 rolls back atomically, leaving the
enum expansion; the gate executes the exact kernel with ROLLBACK and then resumes
using Prisma history. A failed real Prisma migration requires inspection and the
appropriate reviewed `migrate resolve`, never blind reset. Repeat deployment must
be a no-op. M03 is additive; inspect ledger state before any retry.

Before shared activation, a rollback may restore compatible Personal code while
leaving harmless expansion. After shared writes, a Personal-only release cannot
safely service the database. Prefer a compatible rollback or forward correction;
do not drop the enum, tables, shared data or integrity constraints. Restores must
retain independent current restrictive evidence and quarantine stale authority.
Compatibility also includes the resumable Personal erasure `IDENTITY` progress
stage introduced here. Drain pending erasures or use a release that understands
that stage; the original P1 binary is not a safe blind rollback for an in-flight job.

## Verification

`pnpm db:migrations:check` retains existing historical/empty/prior-release checks
and adds a populated P1-12 upgrade using the actual promoted artifacts. It snapshots
all 67 P1 tables, compares every one of 139 FK definitions and all 24 historical
checksums, proves interrupted kernel rollback/resume/repeat, and verifies pinned
function search paths. Only newly owned unpredictable test schemas may be reset or
dropped. Configured development data is not migrated or reset by this batch.

The new integration suite uses an owned schema and independent PostgreSQL
connections for constraints, authorization and observed lock races. The configured
isolated `_test` schema receives reviewed migrations through the existing test
setup; no production migration or deployment is performed. Actual final command
results are recorded in the batch report.
