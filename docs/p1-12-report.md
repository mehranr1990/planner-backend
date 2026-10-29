# P1-12 completion evidence

Batch: P1-12 — Personal data lifecycle, resilience and limited offline sync.
Status: COMPLETE for the approved local development scope.

P1-11 was finalized unchanged and pushed normally as
`e906bea18105bdb9882c25d6c2b1380df3ef0967`. Local main, origin/main and the actual
remote branch matched with zero ahead/behind and a clean index/tree before P1-12.

## Implemented scope

- Revisioned, scoped Task/Checklist/Label, Daily Plan, Habit Entry, Note and text
  Capture sync through existing owning commands. Independent per-item outcomes,
  durable operation/entry dedup, explicit text conflicts, rollback-safe source/
  audit/outbox/feed effects, normal REST change tracking, bounded bootstrap/pull,
  signed expiring cursors, tombstones and bounded retention. Financial posting
  remains online; existing EXPENSE drafts may sync. No client sync engine.
- Complete private JSON export through owner facades and a repeatable-read
  snapshot, including retained histories, exact money and an attachment manifest.
  Authenticated proof-bound actual attachment streaming, byte/hash validation,
  bounded size/count, immutable attempt identities, durable retries and expiry.
- Fresh-password, revisioned staged deletion; confirmation closes access and
  revokes sessions under the same mutation fence. Seven-day cancellable grace,
  scoped recovery plus fresh password, no restoration of old sessions, policy
  acknowledgement/version checks, resumable private-file cleanup and atomic
  FK-safe owner/Space/identity purge. Foreign owners remain untouched.
- Signed independent erasure control, fail-closed restore quarantine, bounded
  erasure replay and signed 30-day backup manifests. Minimal evidence retention
  is 90 days. No new worker, queue schema, dependency or external provider.

Account orchestrates source-owner public portability/purge contracts; Sync uses
source-owner public sync commands/read contracts. Spaces owns the access fence;
identity owns credential verification/session/identity operations; Storage owns
bytes. Existing module boundaries, Task identities and prior APIs are preserved.
Approved ADRs 0022 and revised 0023 resolve subset, history, privacy and retention.

## Persistence and verification

Only four entities are added: SyncMutationReceipt, SyncChange, UserExportJob and
AccountDeletionJob. Two additive migrations add these, scoped uniqueness/checks,
Space access/feed context and retention/export-attempt cleanup indexes/progress.
No earlier migration or Better Auth-owned DDL changed.

All **24/24 applied application migration checksums match development and test**,
with no unfinished migrations. All 22 earlier migration files and compatibility
artifacts remain byte-identical. New SHA-256 checksums:

- `20261029001200_personal_data_lifecycle_and_sync`:
  `95ff9cdee2c748cc6f44f53e9c98ade0aa489c3addd40d91abbb896870b198bf`
- `20261029001300_sync_retention_and_export_attempt_keys`:
  `fe0d7a01b1d1999422dba61e6e3ac1aea8e4d81e07f96f3a42b2b0e60110f949`

The reviewed pg-boss v46 artifact remains unchanged:
`33395ea7aaf8d17f4eceec23c45fcb6672a278f11d3c1a255d8589491278e238`.

- Final `pnpm quality`: **PASS, 13/13 stages, native exit 0**. Configuration,
  generation, auth schema, Prisma validation, build/typecheck, formatting/lint,
  architecture, tests, OpenAPI and migration checks all pass.
- **765 tests pass across 76 files**: 389 unit/contract/architecture/compatibility
  tests in 56 files and 376 PostgreSQL integration tests in 20 files. All earlier
  regressions and 3,193 frozen P1-11 API signatures remain protected.
- Migration gate: additive review, empty replay, prior-schema upgrade with all
  63 previous application/provider table snapshots preserved, repeated deploy
  and existing ledger/status checks pass. Only a newly created disposable test
  namespace is reset; configured development/test databases are never reset.
- `pnpm smoke:p1-12`: **PASS, native exit 0**. Real compiled API/worker restarts,
  persisted sync/export and idempotent replay, actual manifest-bound attachment
  bytes, cross-user denial, closed-account persistence, capability/password
  cancellation without session resurrection, and post-grace compiled-worker
  identity/file erasure with the other owner's Task preserved all pass.
- The smoke utility's final erasure assertions were separately typechecked,
  linted and formatted; production code was unchanged after the final gate.

Focused tests cover concurrent operations, stale revisions, exact entry dedup,
historical context, paginated feed expiry, source rollback, private histories,
proof expiry/corruption, policy blocking, interrupted physical cleanup, selected
Goal metrics and Finance/Capture cycles. A real earlier fixture identity/Task/file
snapshot is restored while current independent erasure evidence stays intact;
private access remains quarantined until bounded replay removes restored data.
The reported backup-expiry deadline stays null until live erasure completes and
then uses completion plus 30 days, avoiding a premature claim during grace.

No security assertion, coverage, timeout or production deadline was weakened.
PowerShell stderr redirection made an earlier command status ambiguous despite
passing checks; final commands capture the native process exit independently.

## Operations, Git and boundary

See [traceability](./p1-12-traceability.md),
[lifecycle operations](./runbooks/personal-data-lifecycle.md) and
[Phase 1 exit](./phase-1-backend-exit.md). An installation must explicitly provision
its independent control namespace and approved policy configuration. Missing or
invalid recovery evidence/policy fails closed.

No outstanding implementation blocker or unapproved deviation. Docker image/
startup/persistence, production ACL/TLS/SMTP/push configuration, actual encrypted
off-host restore and enforceable physical backup expiry are **DEFERRED deployment
gates**, not passed local checks. No claim is made that off-host copies already
vanished after live erasure.

Only P1-12 source, contracts, migrations, tests, ADRs and required documentation
are changed. No secret, private data, environment file, build artifact or unrelated
change is included; `.env.example` contains placeholders/configuration guidance.
Index is empty. P1-12 is **uncommitted and unpushed**; HEAD/main/origin/main remain
the accepted P1-11 commit with zero ahead/behind. Phase 2/frontend: NOT STARTED.
