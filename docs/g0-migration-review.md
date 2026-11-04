# G0 exact migration review and rehearsal

Status: ENGINEERING REVIEWED for the owner-authorized isolated G0 rehearsal,
2026-10-30. Not an automatic deployment approval. P2-01 business implementation
has not started; application Prisma migrations/schema remain unchanged.

## Exact artifacts

| Candidate                                                                         | SHA-256                                                            |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [01-shared-kind.sql](../tooling/migration-candidates/g0/01-shared-kind.sql)       | `80c62729e0d5b534194bda06b415ce817e96a4341000cac729d740b8db68b56d` |
| [02-custody-kernel.sql](../tooling/migration-candidates/g0/02-custody-kernel.sql) | `1bc5c5053772677c75de599fe0335ff9e836199f0bf4618dfec7ce40e9fe0a7b` |

[Byte review](../tooling/testing/g0-candidates.ts) accepts only these names/hashes.
Neither artifact is inside prisma/migrations; no application migration exception
was added. Generic migration rejection remains. Changed SQL needs new review.

## Objects and integrity

01 adds SHARED to SpaceKind in a committed transaction before use. 02 creates:
SharedRetentionPolicy, SharedCustody, AccessScope, SharedActor, ContextAccess,
ContextAccessInterval, ContextCapabilityPolicy, SharedMutationReceipt,
SharedLifecycleJob, ResourceGrant and SharedAuditEvent. PK/unique/composite FKs,
expiry/pending indexes and deferred custody checks enforce the kernel shape.
The root scope is the only scope kind currently allowed.

The only existing-column change is Space.ownerUserId DROP NOT NULL, guarded by
the conditional Personal/shared CHECK and commit-time exclusive-subtype triggers.
Keep both owner unique keys, User cascade, all 37 owner-composite FKs and all 139
historical FK definitions. No source data is backfilled or moved.

Commit guards cover both sides of custody/scope/actor/access/interval/policy/job
changes. They reject missing root/current policy, ineligible active custodian,
missing interval and closing/frozen state without matching durable work. Policy
updates are immutable; role ceilings/export maxima are constrained. Job evidence
retains an opaque custody identity after unlinking from deleted custody.

The grant envelope rejects all writes until concrete resource targets are reviewed
and introduced. Personal-only guards cover eight existing id-only Space paths:
Task, Label, OutboxEvent, TransactionPosting, ExchangeRateSnapshot, SyncChange,
XpLedger and AchievementUnlock. Other owner-bound sources remain protected by
their unchanged non-null composite FKs. No shared Task/sync/reward functionality
is activated by schema rehearsal.

There is no Team/Company/Group/Project business table, auth-owned DDL, existing FK
drop or new broker. Functions are invoker-rights, never SECURITY DEFINER. Search
path is pinned to the newly owned rehearsal schema; future deployment must pin
its intended schema. User-supplied SQL/schema identifiers are not accepted.

## Locks and rollback

Lock timeout is 5s and kernel statement limit 30s. Catalog creation and nullability
relaxation require no source-row copying; the new Space CHECK validates existing
Space rows under its DDL lock. Small-fixture evidence does not establish production
timing or zero downtime. Measure deferred-guard cost at real membership cardinalities.

Failing step 02 before COMMIT rolls back its tables and owner-column relaxation,
with source rows unchanged. Resume from committed step 01. The rehearsal's own
hash ledger commits atomically with each candidate; repeat deployment is a matching
hash no-op. It is separate from the unchanged Prisma ledger. No IF NOT EXISTS
drift masking or destructive enum rollback is used.

Before shared activation, a previous application may run over harmless expansion.
After shared writes, use a compatible rollback or forward correction. Never drop
new tables/data or restore an old database over later writes automatically.

## Reproduction and scope

`pnpm g0:rehearse` requires --isolated-only, nonproduction loopback *_test settings
and newly owned p003_<32hex> schemas. It replays 24 historical migrations only into
those schemas. It does not migrate/reset configured databases. Cleanup drops only
schemas created by this invocation. No Docker/production operation is performed.

Synthetic fixtures include two owners, active/closed Personal Spaces, auth, Task
hierarchy/checklist/history/labels/files/recurrence, planning, selected Goal metrics
and reviews, private writing, Capture/Finance cycles/exact postings, audit/outbox,
receipts, sync, export and seven-day Personal deletion state. No configured private
content or file bytes are copied into fixtures.

Checks cover empty/populated upgrades; 67 application tables plus Prisma's ledger
snapshotted (42 nonempty fixture tables); exact FK/checksum/row preservation;
interruption/resume/repeat; negative custody/role/scope/export/closure probes; valid
durable closure; Personal cascade; unchanged synthetic bytes; and read-only before/
after configured database rows/constraints/pg-boss metadata. The sanitized report
is under ignored .tools/g0-rehearsal-*; final results are in the
[execution report](g0-execution-report.md).

These SQL probes are not implemented HTTP permissions, membership workflows or
application fencing races. Those remain P2-01/later acceptance tests. Retention
JSON has kernel structural checks; strict admission/holds and a real policy must
exist before shared activation. SYNTHETIC_REHEARSAL is test-only, never a deployment
policy. Legacy auth/backup evidence and physical restore are not modified here.
