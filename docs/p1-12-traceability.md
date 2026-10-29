# P1-12 scope and traceability

Status: COMPLETE for the approved local development scope. Final quality is
13/13 stages, 765 tests in 76 files; compiled API/worker restart, export/deletion
and replay smoke passes. See the [completion report](./p1-12-report.md).
ADRs 0022 and revised 0023 are explicitly owner-approved.

P1-11 finalized and pushed as `e906bea18105bdb9882c25d6c2b1380df3ef0967`.
All 91 accepted files were unchanged; accepted quality evidence is 13/13 stages,
731 tests in 72 files, with compiled API/worker restart smoke passing. All 22
migration checksums and the reviewed queue hash match development/test. Actual
remote/main/local hashes and clean tree/index were verified before this batch.

PHASE_0_1_IMPLEMENTATION.md P1-12 explicitly requires the limited server-side
Personal sync subset. Sync was deferred from Phase 0, not removed from Phase 1.
Client caches, a general offline engine and actual offline ledger posting are
excluded. Section 10.6 reserves the exact subset to an owner decision; section
10.4 reserves retention/deletion periods. Approved ADRs 0022/0023 resolve both.

| Mandatory scope                         | Contract / owner                                                                              | Required verification                                                                                                               |
| --------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Scoped operation replay/conflicts       | `/sync/push`; source-owner public commands and SyncMutationReceipt                            | Two-client races, stale revisions, normalized replay, per-item isolation, preserved client/server text                              |
| Ordered bounded feed and tombstones     | `/sync/pull`, `/sync/status`; SyncChange and explicit owner read registry                     | REST coverage, rollback/commit order, bootstrap interleaving, trimming/cursor loss, deletion/restore and foreign cursors            |
| Expense drafts only offline             | Existing text CaptureItems                                                                    | No financial posting through sync; atomic online conversion retains source identity                                                 |
| Complete private portability            | `/me/export`, `/me/exports/{id}` and nested download; Account and source-owner export facades | All owned modules/retained history, attachment manifest, exact finance, consistency, size limits, token/owner expiry and corruption |
| Reauthenticated staged closure          | `/me/deletion-request` family; Account, Spaces and identity adapter                           | Password/proof denial, explicit confirmation, immediate revocation, in-flight mutation fence and grace cancellation                 |
| Bounded physical and relational erasure | AccountDeletionJob, owning purge commands and private StoragePort                             | No premature destruction, foreign data preservation, FK cycles, file/DB interruption, safe retries and erased-source replay denial  |
| Restart and orphan recovery             | Existing compiled API/worker                                                                  | Interrupted jobs resume, no duplicate export/mutation, no orphan artifact/file or private queue payload                             |
| Compatibility and preservation          | Additive migrations, generated OpenAPI and earlier baselines                                  | Every previous checksum/API retained; empty/previous upgrade/redeploy, all 13 final quality stages and compiled restart smoke       |

`personal-sync.spec.ts` covers concurrent replay, permanent dedup, mixed results,
text conflicts/merge, normal REST feed/tombstones, ownership/cursors, nested Task
tools/Day selection, retained Note versions, draft-only Capture, failed source
rollback, Habit entry dedup/history, paginated resync/retention and closure fencing.
`personal-lifecycle.spec.ts` covers password/proof/revision privacy, complete
private history, manifest-bound attachment bytes, corrupt/unavailable downloads,
export retry/expiry, session closure/cancellation, policy blocking, interrupted file
purge, financial Capture cycles/selected Goal metric, foreign preservation and
real earlier fixture snapshot restoration with fail-closed replay.
`lifecycle.spec.ts` verifies exact export bounds/decimals and signed backup/cursor
expiry/tampering. `lifecycle-openapi.spec.ts` verifies the route/security contract
and all 3,193 accepted P1-11 signatures. Earlier tests continue to protect temporal
semantics, finance correctness and the domain isolation matrix.

Only four entities are added: SyncMutationReceipt, SyncChange, UserExportJob and
AccountDeletionJob. Two additive migrations add these, Space fencing/feed context,
constraints, scoped uniqueness and retention/export cleanup indexes/progress.
All 22 earlier migration files remain unchanged. Final 24-migration checksums,
13-stage gate and compiled smoke results are recorded in the completion report.
The migration upgrade gate snapshots all 63 prior application/provider tables,
including XP, achievement and source-event history, before P1-12 and compares
them after deploy/redeploy. It ignores only the four additive Space fields.

See [lifecycle operations](./runbooks/personal-data-lifecycle.md) for setup,
retention, attachment access, cancellation and signed restore-replay commands.
Docker/production backup, TLS, SMTP and restore drills remain deployment gates.
No P1-12 commit/push, Phase 2 or frontend work is authorized.
