# P5-05 completion report

Batch: **P5-05 — Meetings, Decisions & Announcements**.
Status: **COMPLETE locally; awaiting owner acceptance**, 2026-11-09 (Asia/Tehran).

## Publication prerequisite and scope

The accepted P5-03 was committed and pushed as
`4515f1516f9dcdb4274c4a20b5981f444d7b019d`, parent
`5a074703bc402b706916fb44d6360373768033cf`. Exactly the approved 59 paths,
their SHA-256 hashes, staged/committed Git blobs and parent were verified.
Independent `git ls-remote origin refs/heads/main` returned that exact commit.
Publication did not repeat the accepted P5-03 quality gate.

P5-05 implements independent/Personal and exact Project/Team/Company-root
meetings, named invitations and ACCEPTED/TENTATIVE/DECLINED RSVP, organizer
delegation/removal, selected agenda/proposals, immutable minutes snapshots,
separate review and organizer finalization, decisions/actions, explicit Task
release/conversion/linking, private attachments and stored HTTPS meeting URLs.
Scoped announcement drafts, immutable audience publications, withdrawal, pinning
and optional private acknowledgement are implemented. All three owner decisions
in ADR 0048 are approved; no policy decision remains pending.

Files/modules changed: **71 task paths: 39 tracked modifications and 32 new files**,
listed with SHA-256 hashes in [the exact change manifest](p5-05-change-manifest.json).
Meetings owns its
application/domain/HTTP workflow and persistence. Calendar, Tasks, Spaces,
StoragePort/SharedFiles and account lifecycle are reused through public contracts.
Team legacy extension reuses the old Calendar event/agenda; new confidential Team
events are filtered before Calendar pagination. No new dependency/provider exists.
See [API/security contract](p5-05-contract.md) and
[migration review](p5-05-migration-review.md).

## Entities, migration, events and security

M043 adds 21 tables and 62 typed FKs. Final catalog: 235 domain tables, 236 with
ledger; 67 migrations and 760 FKs. Migration SHA-256:
`91372e3e8a2db9b3fde0afbff55c89565505fd42260c6b7c1dacac29a5fe5806`.
Only two predecessor CHECK allowlists and the reviewed additive Calendar function
change; published SQL remains unchanged. No seed, historical audience/Push
backfill or automatic deployment occurs.

There are 52 additive REST operations and 788 total operations. All 736 published
operation shapes and historical compatibility baselines are retained; the 351
P5-03 delta signatures are frozen before implementation. Mutations use existing
metadata audit/outbox and pg-boss maintenance. Meetings/announcements add no chat
Push event, receipt sharing, realtime presence or subscription change.
OpenAPI resolves **7,119 references**. Final architecture checks pass with
547 modules and 3,602 dependencies, without cycles or forbidden imports.

Current verified identity, custody/source membership, admission generation and
restore generation are checked on content/files, commands and worker effects.
Draft/review notes stay private. Final content snapshots include selected agenda,
minutes, decisions/actions and attachment identity. Reviewer eligibility is
rechecked before finalization. Solo self-finalization never returns after another
admission. Work Task release is explicit and source-bound; Personal Task links
are private to their requester and can retain a null pointer after Task erasure.
Announcement targets bind publication-time generations; new/rejoined members do
not gain old publications. Acknowledgement is explicit, idempotent and personal;
only aggregate counts are available to managers. Actual closure/purge clears
private state while retaining shared final content.

File claim, stream completion and download-open handoff independently recheck
authority. Type/size/hash/safe-name controls and cancellation use private storage;
linked content is protected while expired unlinked bytes have durable bounded GC.
Existing source disposal stops with MEETING_RETENTION_PENDING before destructive
cleanup. New APIs preserve strict validation, current revisions, payload-bound
idempotency, signed pagination, verified sessions, no-store and rate budgets.
Cancellation updates the authoritative Calendar status; revocation remains
available after cancellation. Current invitation-issuer management is rechecked.
Announcement draft files require current management even for a demoted uploader.
The Tasks owner's transfer catalog recognizes the new FK through a narrow
Meetings-owned reference-count facade: unrelated transfers still work, while a
linked private Task stays blocked under the existing REJECT reference policy.

## Verification

Targeted integration: **25/25 passed** before the final gate, including actual
Personal closure/purge, concurrent work creation and Task conversion, independent
organizer delegation, legacy Team extension, separate review, immutable agenda,
private uploads and revocation during streaming, source rejoin/restore, Viewer
restrictions and announcement snapshot/acknowledgement privacy.

The mandatory **13-stage gate ran once** against the isolated canonical baseline:

```powershell
node --env-file-if-exists=.env.test.local .tools/p5-05-baseline.mjs --run quality
```

The raw command exited **1** and is retained unchanged. Eleven stages passed;
the nonintegration and integration stages required affected reruns. Initial
nonintegration results were **672 passed / 2 failed**, 674 cases in 139 files.
Integration initially had **888 passed / 2 failed / 26 skipped**, 916 cases in
43 files, with the new suite's setup hook failing before its cases ran.

- The legacy Team route-parity test now includes the added extension, and all
  51 new standalone controller handlers are checked against their contracts.
- The portfolio compatibility test's 20 existing mutation scenarios now run as
  independent cases. Every prior assertion, mutation, normalizer and hash check
  is retained; no timeout was raised and the compatibility helpers are unchanged.
- The Task transfer catalog now gives the new MeetingTaskLink FK an explicit
  disposition through the Meetings public core; unlinked Task/checklist transfer
  still preserves IDs and linked private references remain blocked.
- Owned-schema deployment and application bootstrap are separate setup hooks,
  retaining the existing hook and test timeouts. Every Meetings case ran in the
  affected rerun; none remains skipped.
- The Finance concurrent-write case reported a pool connection timeout. Its
  complete 41-case file subsequently passed without a Finance code/test change.

Affected checks passed with these exact commands:

```powershell
node --env-file-if-exists=.env.test.local .tools/p5-05-baseline.mjs --run test:integration apps/api/test/integration/meetings.spec.ts apps/api/test/integration/project-collaboration.spec.ts apps/api/test/integration/finance.spec.ts
node --env-file-if-exists=.env.test.local .tools/p5-05-baseline.mjs --run test:integration apps/api/test/integration/meetings.spec.ts
pnpm.cmd exec vitest run --project contract --project compatibility --no-file-parallelism tooling/compatibility apps/api/test/contract/team-interactions-routes.spec.ts apps/api/test/contract/meetings.spec.ts
```

Results: **94/94 integration cases** across the three affected files, final
**27/27 Meetings cases**, and **53/53 contract/compatibility cases**. Initial
targeted domain/contract checks also passed **22/22**. Final distinct case coverage
is **1,611: 694 nonintegration + 917 integration**, counting the current cases once
across the gate and affected reruns. The 20 additional nonintegration cases split
existing mutation scenarios; they do not represent new product features.

Final `pnpm.cmd typecheck`, `pnpm.cmd build`, `pnpm.cmd openapi:check`,
`pnpm.cmd architecture`, changed-file ESLint (61 TypeScript files), formatting
and `git diff --check` passed. All 13 required checks are satisfied through the
single gate and affected verification; the complete gate was not repeated.

```powershell
node --env-file-if-exists=.env.test.local .tools/p5-05-baseline.mjs --run smoke:p5-05
```

The final compiled API/worker smoke **passed**: actual API restart preserves
accepted meetings, approved immutable minutes, private idempotent Task links,
attachment bytes and aggregate announcement acknowledgement. Actual worker
restart collects expired unlinked bytes, preserves linked content and continues
the approved generic durable chat Push. P5-02/P5-03 restart behavior also passes.
HTTP pacing respects the unchanged production IP/actor budgets. An early smoke
caught internal fields escaping the strict members DTO; explicit projection
corrected the issue and its failed log remains available.

The final M043 populated-upgrade rehearsal **passed**: all 214 predecessor
datasets, all nine populated M042 relations, 66 published checksums and prior
constraints are preserved except the two reviewed additive CHECK expansions.
Forced rollback, repeat deployment, no historical Push backfill and the exact
760-FK catalog are verified. The canonical baseline reports 67 matching migration
checksums. Local ignored evidence includes `.tools/p5-05-quality.log`,
`.tools/p5-05-affected-94.log`, `.tools/p5-05-test-integration.log`,
`.tools/p5-05-affected-contracts-matrix.log`, `.tools/p5-05-smoke-p5-05.log`,
`.tools/p5-05-checks.json` and `.tools/p5-05-final-preservation.json`.

## Preservation and stopping point

P5-05 uses a fresh owned isolated canonical baseline with child-only
TEST_DATABASE_URL selection. A schema prototype is preserved separately; no
existing database reset, drift repair or protected-database migration occurs.
Final read-only comparison covers the legacy M031-drift database and the accepted
P4-06/P5-01/P5-02/P5-03 databases, 12 unrelated documents, five environment files
and 67 published migration artifacts. Data/catalog digests and all protected
file hashes match preflight. The index is empty and HEAD/origin/main remain at
the published P5-03 commit.

Tests not run: production migration/deployment, Docker/Compose/release restore,
hosted CI, live SMTP/Push-provider delivery and frontend/PWA/Service Worker work.
They are outside this authorized local scope; local compiled API/worker and
isolated PostgreSQL checks provide the backend evidence.

Deviations from binding specifications: none. Outstanding owner ADRs:
none. P5-05 remains unstaged, uncommitted and unpushed on main, with HEAD at the
published P5-03 commit. No deployment, Shared activation, P5-04 or P5-06 work.
Next roadmap batch: **P5-06 — NOT STARTED; not authorized**. P5-04 remains deferred.
