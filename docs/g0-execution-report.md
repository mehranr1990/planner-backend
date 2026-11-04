# G0 execution readiness

Date: 2026-10-30. Result: **GO to begin P2-01 after explicit owner instruction**.
P2-01 has not started. This is local prerequisite acceptance, not production or
shared-feature acceptance. Approved ADRs 0024–0031 remain unchanged.
Baseline HEAD: `6a9ccdb81e8c3b4842f1d7ea63c3531a6abbd2bb`.

## Completed prerequisites

- Reviewed the exact two SQL candidates and hashes in the
  [migration review](g0-migration-review.md). Candidates remain outside
  prisma/migrations; Prisma schema and all 24 historical migrations are unchanged.
  No production migration exception or deployment was introduced.
- Rehearsed empty and populated previous-release schemas in newly owned isolated
  test namespaces. All 68 baseline tables were snapshotted; the representative
  synthetic Personal fixture populated 42. Preserved original rows, all 139 FK
  definitions, all 37 owner-composite FKs, migration checksums and synthetic bytes.
  Verified interrupted kernel rollback, resume, matching-hash repeat no-op,
  18 negative constraint probes, valid staged closure and Personal owner cascade.
- Both configured local databases' public rows, constraint definitions and
  pg-boss schema metadata matched read-only before/after snapshots during rehearsal.
  Both owned rehearsal namespaces were cleaned up. No configured database was reset
  or given candidate DDL. This check measures rehearsal scope, not arbitrary later
  test-fixture activity or a production backup/restore drill.
- Fixed the canonical OpenAPI exporter, regenerated the canonical JSON and froze
  the P1-12 compatibility baseline, including component schemas. Exactly six local
  reference values changed; all 2,166 references resolve across 293 operations and
  189 paths. Prior API baselines still pass. Existing handoff JSON is untouched and
  semantically identical. No API route, DTO validation or Personal behavior changed.
- Added compiled P1-10/11/12 CI smoke steps. Retained all 13 quality gates.
  Preserved the checksum-bearing supplied V3 bundle's bytes with a narrowly scoped
  formatting exclusion; maintained source, ADRs and architecture docs stay checked.

Sanitized rehearsal evidence:
`.tools/g0-rehearsal-da69edc1-af83-47cd-b31d-982a9b8a150e/report.json`.
Ignored local evidence is reproducible with `pnpm g0:rehearse`; it contains no
configured row contents or credentials. The review documents committed-step
recovery and why destructive rollback is unavailable after shared writes.

## Executed validation

Commands below use the repository's pinned pnpm 10.20.0. In this restricted Windows
session it was invoked as
`node .tools/corepack/v1/pnpm/10.20.0/bin/pnpm.cjs`, with process-local COREPACK_HOME
pointing to the existing .tools/corepack cache. No install, persistent environment
change or dependency change was needed.

| Command/check                                             | Result                                                                                                                                                                                                                      |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm quality`                                            | All 13 stages executed once. Initial exit 1: nested pnpm global-cache permissions affected build/typecheck; formatting flagged 12 pre-existing supplied V3 bundle files. Affected checks rerun after correction; see below. |
| config:check, db:generate, auth:schema:check, db:validate | PASS in quality run                                                                                                                                                                                                         |
| `pnpm build`, `pnpm typecheck`, `pnpm format:check`       | PASS after process-local cache correction and reference-bundle formatting exclusion                                                                                                                                         |
| `pnpm lint`, `pnpm architecture`                          | PASS; 333 modules, 1,842 dependencies, no violations                                                                                                                                                                        |
| `pnpm test`                                               | PASS: 393 tests / 58 files across unit, contract, architecture and compatibility projects                                                                                                                                   |
| `pnpm openapi:check`                                      | PASS; current canonical equality, prior baselines, P1-12 baseline, reference/operation validation                                                                                                                           |
| `pnpm test:integration`                                   | PASS: 376 tests / 20 files against isolated PostgreSQL                                                                                                                                                                      |
| `pnpm db:migrations:check`                                | PASS: historical additive review/status, empty replay, owned-schema reset, previous-schema populated upgrade and repeat deploy                                                                                              |
| `pnpm g0:rehearse`                                        | PASS: empty/populated exact candidates, preservation, interruption/resume/repeat and negative probes                                                                                                                        |
| `pnpm smoke:p1-12`                                        | PASS: compiled API/worker restart, sync/export replay, private attachment bytes, isolation, closure persistence and recovery cancellation                                                                                   |

The full orchestration was not repeated. Build/typecheck/format were affected
reruns; lint/architecture/non-integration test results were recaptured after a
tool-output truncation. Integration and historical migration gates were not rerun.
PostgreSQL tests emitted an existing pg concurrent-query deprecation warning;
no test failed or was weakened. OpenAPI validation is targeted offline validation
plus existing Zod/HTTP tests, not third-party metaschema/SDK certification.

## Remaining stage gates

No unresolved technical design blocker prevents beginning P2-01. These requirements
must remain explicit in its acceptance plan:

1. **P2-01 implementation acceptance:** reconcile Prisma with the reviewed SQL,
   review final deployment filenames/hashes and any SQL delta, retain generic
   migration rejection, and pin the actual runtime function search path. The G0
   harness uses a dedicated search path and its own exact-hash ledger; that ledger
   is not a substitute for Prisma deployment history. Extend/review the harness
   when promoting the kernel; it currently rehearses the 24-migration P1 baseline.
2. **P2-01 security/concurrency acceptance:** implement the exclusive custody fence
   and fresh authority checks; deterministic independent-connection tests with
   barriers/lock observation and both winning orders must cover mutation/revoke,
   closure/owner-exit, owner-seat transfer, retry/idempotency and lock ordering,
   including implicit FK locks. Regress Personal closure/sync fencing. SQL shape
   probes do not prove application authorization or linearizable revocation.
3. **Before shared activation:** provision an operator-approved complete retention
   policy under the [register's contract](g0-implementation-prerequisites.md).
   Actual class durations, market/hold basis and accountable operator are still
   deployment-owner input. Missing policy fails closed. SYNTHETIC_REHEARSAL is not
   an activation policy. Keep the approved 30-day shared and seven-day Personal
   recovery rules independent.
4. **Before shared recovery acceptance:** independent restrictive-control persistence,
   key-ID/version rotation with legacy Personal proof verification and inventory-based
   retirement, plus isolated restore/replay of erasure/revocation/media controls.
   These operational mechanisms and shared races were NOT RUN or implemented here.
5. **Release gates:** worker private-file and independent control mounts/ownership,
   actual Compose startup/persistence, encrypted off-host restore/expiry evidence,
   workload/SLO/RPO/RTO and alert/runbook evidence. Docker and production operations
   were NOT RUN. Hosted CI and its 15-minute budget remain unverified; new P1-10/11
   smoke steps were configured but not separately rerun locally.

Next eligible work: explicitly authorize P2-01 only, with the above implementation
acceptance tests. No commit, push, deployment or production-data change occurred.
