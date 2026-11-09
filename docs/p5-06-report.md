# P5-06 completion report

Batch: **P5-06 — Privacy, Lifecycle, Security & Final Phase 5 Local Acceptance**.
Status: **COMPLETE for the approved local scope; pending owner acceptance**,
2026-11-09 (Asia/Tehran). Operational acceptance is not granted.

P5-05 publication prerequisite: all 71 approved paths, staged/committed bytes and
parent verified; committed and pushed to origin/main as
`ef27d565b74cc955474af82b2abab5a7d3ca82f1`. An independent
`git ls-remote origin refs/heads/main` matched that SHA. Accepted quality evidence
was reused for publication. P5-06 has no commit or push authorization.

Scope implemented: finite REST recovery and missed-change synchronization,
canonical signed cursors, explicit restore admission, unchanged polling budgets
with Retry-After, private durable DM pair blocking/replay, pair mention/Push
suppression, fresh mutual receipt consent after unblock, Personal portability/
erasure, independent conversation/meeting lifecycle, typed bounded retention
cleanup, retained pseudonymized records and bounded structural media security.
Approved delegated administration and Viewer restrictions remain intact.

Files/modules: Messaging, Meetings, Spaces, Storage, Project/Team/Company cleanup
facades, worker registration, contracts, migration verification and tests.
[The exact manifest](p5-06-change-manifest.json) records every task path and
SHA-256, with its self-entry explicitly exempted from recursive hashing.
[Contract](p5-06-contract.md), [migration review](p5-06-migration-review.md),
[complete P5-04 audit](p5-06-p5-04-requirements-audit.md) and
[Phase 5 local acceptance](phase-5-local-acceptance.md) provide the detailed scope.

Entities/migration/constraints: M044 adds three owner-private contact tables,
six FKs and nullable receipt-consent time, with no historical consent/block
backfill. Actual policy-claimed disposal is the sole immutable-history deletion
exception; meeting approval-cycle reset cannot modify content or ownership.
Announcement targets resolve their actual owner through the published version.
Final catalog: 68 migrations, 239 tables including ledger and 766 FKs.
No historical migration or protected database was reset, repaired or migrated.

API/events/jobs: 13 additive operations; 801 operations and 7,249 resolved
references. Prior contracts, including all 730 frozen P5-05 delta signatures, pass.
Existing pg-boss maintenance has bounded conversation/meeting lifecycle consumers.
Private account erasure retains its existing independent Personal erasure fence
and does not require Shared activation/signing keys. Source cleanup removes
work meetings/announcements and their calendar events through their owner facades.
Outside Personal Tasks are preserved. New signed intent/final resource IDs agree;
historical mismatches remain fail-closed rather than weakening replay validation.

Security/edge cases: pending invitee blocking; both directions and recreated DMs;
authorized history/safety actions; disposed original DM; stale notices/receipts;
concurrent send/block; restrictive restore replay and fresh admission/history floors;
account exit/erasure; stale technical seats; existing delegated roles; last departure
and superseded frozen jobs; policy holds/PSEUDONYMIZE; outside references and active
parents; immutable final documents; original attachment bytes; unsafe media.

## Verification

All database commands below used the approved wrapper:
`node --env-file-if-exists=.env.test.local .tools/p5-06-baseline.mjs --run <command>`.
Final canonical database: `p506_acceptance_1bc02ebb3bf748439947044d5f5fb4d9_test`.
Every wrapper run verifies its deployed checksums/FKs and the unchanged legacy DB.
Earlier owned prototype databases, including a failed draft deployment, remain
preserved; corrected unpublished SQL was deployed only to a new owned baseline.

One full `pnpm.cmd quality` invocation ran all 13 stages. Its raw exit was 1:
one formatting finding, one stale controller-route expectation and one Personal
erasure regression. Each was fixed; affected stages/checks were rerun. The full
gate was not repeated, and its original nonzero result is not relabeled a pass.

| Check / exact command                                                                                                             | Final evidence                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `config:check`, `db:generate`, `auth:schema:check`, `db:validate`                                                                 | PASS in the full gate                                                                                                                                                                                                                                                                                        |
| `pnpm.cmd build`, `pnpm.cmd typecheck`, `pnpm.cmd lint`, `pnpm.cmd architecture`                                                  | PASS; affected source/provider changes rechecked; 560 modules, no boundary/cycle violations                                                                                                                                                                                                                  |
| `pnpm.cmd format:check`                                                                                                           | PASS after formatting task-owned files only                                                                                                                                                                                                                                                                  |
| `pnpm.cmd test`                                                                                                                   | PASS, 142 files / 709 unit, contract, architecture and compatibility cases                                                                                                                                                                                                                                   |
| `openapi:check`                                                                                                                   | PASS, 801 operations / 7,249 refs; previous signatures preserved                                                                                                                                                                                                                                             |
| `test:integration`                                                                                                                | Original full run: 950 passed / 1 failed, 44 files / 951 cases; affected reruns below resolve the failure and add three cases                                                                                                                                                                                |
| `test:integration apps/api/test/integration/personal-lifecycle.spec.ts apps/api/test/integration/communication-lifecycle.spec.ts` | PASS, 44 cases, including all 10 Personal lifecycle cases and the original 34 P5-06 cases                                                                                                                                                                                                                    |
| `test:integration apps/api/test/integration/communication-lifecycle.spec.ts`                                                      | PASS, all final 37 cases, including finalized source meeting/announcement disposal in Project, Team and Company and preservation of converted Personal Tasks                                                                                                                                                 |
| `db:migrations:check`                                                                                                             | PASS after final M044 correction: 235 populated predecessor datasets, 67 immutable predecessor checksums, prior constraints, interrupted function/data rollback, repeat deploy and exact 766-FK catalog                                                                                                      |
| `smoke:p5-06`                                                                                                                     | PASS: actual compiled API/worker processes on a newly created isolated database; restart preserves messaging, advanced privacy, voice bytes/progress, generic Push sink, meetings/documents/Task links/announcements, finite recovery cursors and private block state; captured hold blocks destructive work |
| `.tools/p5-06-baseline.mjs --verify`, `.tools/p506-preservation.mjs`                                                              | PASS: canonical 68 checksums/766 FKs; 12 unrelated docs, 5 environments, 68 historical migration artifacts and all 6 protected DB data/catalog snapshots match; index empty                                                                                                                                  |

Integration evidence covers **954 distinct passing cases cumulatively**: the 951
original cases plus three new owner-cleanup cases, using the complete run and
affected reruns. This is not a claim that a second 954-case full run occurred.
The initial supplementary source-cleanup tests exposed the announcement-target
trigger defect; Company invitation fixtures were corrected to use CompanyAccess.
The initial smoke fixture needed an explicit PostgreSQL parameter cast.
Concurrent schema-drop checks once exhausted local PostgreSQL lock memory;
they passed when rerun sequentially, without changing server configuration or
repairing/deleting existing targets.

Synthetic polling: 48 requests / 3 devices / limit 7;
30 HTTP 200, 18 HTTP 429 and 0 unexpected errors.
Measured p50 1700.45 ms, p95 2444.28 ms,
max 2510.95 ms; total 2542.41 ms.
This is bounded local evidence, not a production capacity or SLO commitment.
Raw evidence is retained locally in `.tools/p5-06-quality.log`,
`p5-06-personal-regression.log`, `p5-06-test-integration.log`,
`p5-06-db-migrations-check.log`, `p5-06-smoke-p5-06.log`,
`p5-06-polling-load.json` and `p5-06-final-preservation.json`.

NOT RUN / release blockers: actual malware-engine integration/scanning (approved
ADR 0049); deferred realtime/socket/Presence/Typing checks; production Docker/HTTPS,
external SMTP/Web Push/browser delivery, operational backup/restore and production
capacity/SLO/RPO/RTO. Local structural checks are not antivirus clearance.
Existing earlier operational blockers remain in force. No deployment, Shared
activation or real worker execution against existing data occurred.

Deviations from binding scope: only the explicit ADR 0044–0049 boundaries.
No new provider/dependency, default retention policy, automatic role promotion,
realtime transport or Phase 6 feature. Existing tests were updated only where
accepted lifecycle/history policy changed their expected behavior.

Outstanding issues/ADRs: no unresolved local requirement or owner-policy decision.
Automatic approval review's initial worker/recovery-route rejection was resolved
by the owner's explicit authorization for local code and fresh isolated testing;
operational activation remains forbidden.

Git: P5-06 is entirely unstaged, uncommitted and unpushed; HEAD remains published
P5-05 `ef27d565b74cc955474af82b2abab5a7d3ca82f1`.
Next eligible step: owner review/acceptance of P5-06 and this local Phase 5 summary.
Publication requires separate authorization. P5-04 transport and Phase 6 are
**NOT STARTED**; this batch stops here.
