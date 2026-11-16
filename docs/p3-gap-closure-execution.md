# P3-GAP-CLOSURE execution

Initial implementation authorization: 2026-11-16. Backend only; no commits,
pushes, deployment, Shared activation, browser tests or development database
migrations at that checkpoint. The owner's subsequent finalization authorization
permits local mehran_dev migration, final checks, commit and normal origin/main
push; it does not permit production/staging, frontend changes or Shared activation.

Baseline: main at 1e2a36fd4ff4bf8e5ce875fbd973740b42450ddb; clean tree;
95 migration directories and 95 applied migrations in mehran_test; PostgreSQL
18.6; Node 24.22.1; canonical OpenAPI 1,092 operations. Development database
history is checked read-only separately. Frontend requirements inspected read-only.

Checklist:

- Reuse Team assignments, dated capacity, points, file library and Calendar.
- Extend existing RSVP transitions and organizer summaries, without copying events.
- Reuse Spaces invitation metadata/resend, preserving recipient proof privacy.
- Add explicit weekly member capacity and preserve dated exceptions/unknown values.
- Add requester-only pending leave edits; approved dates require cancel/resubmit.
- Add Sprint point capacity and evidence-based history/burndown/velocity.
- Add separately authorized Project association review and source projections.
- Add bounded availability, cross-Team workload, activity, analytics and forecast.
- Verify isolation, revisions, replay, migration preservation and compatibility.
- Generate canonical contracts, frontend handoff and factual completion report.

TB numbering differs: frontend TB-1 invitations = request TB-4; frontend TB-4
MAYBE = request TB-1; frontend TB-5 Sprint points = request TB-6/T-POINT;
frontend TB-6 association = request TB-5; frontend TB-7 calendar = request TB-8;
frontend TB-8 withdrawal/visibility = request TB-7/T-VIS. TB-2 agrees.
TB-3 is DEFERRED BY OWNER: destination admission and source removal remain
independent existing operations, with no transfer API or automatic work migration.

Existing support: Team files have folders, real versions and private downloads;
Team Tasks and Project work-items preserve separate source authority; Project
assignment withdrawal exists. Existing capacity-summary uses dated Team capacity,
approved time-off, accepted Team assignments and explicit Shared logs. Legacy
Sprint daily remaining values use present scope and must not be advertised as
historical snapshots. Activity currently covers Task activity only.

Owner-authorized isolated test recovery: M071's draft nullable point-capacity
constraint rejected WEEK rows. The owner explicitly authorized backup/restore of
mehran_test only. A full custom-format pg_dump was actually restored into an owned
verification schema; all 301 tables and 96 ledger rows matched. A predecessor
schema was rebuilt from the exact original 95 SQL migrations, then restored from
the verified records and exact original 95-entry ledger. Corrected M071 was
reapplied through normal Prisma migrate deploy. All existing public business rows,
95 approved ledger rows/checksums and every other test schema were verified
unchanged. No development or production database was changed. No checksum was
edited to pretend the rejected draft matched corrected SQL.

Verified backup and manifest:
`.tools/p3-test-recovery/77aff773-71d7-4d78-b0ec-31b2d468c4a9/mehran_test.dump`
and adjacent `verification.json`. The backup remains local and Git-ignored.

Implementation checkpoint: M071 and M072 were applied only to mehran_test (97 migrations,
zero checksum mismatches). Read-only verification confirms mehran_dev remains at
95 migrations with zero checksum mismatches. The populated rehearsal verified
M072's typed request backfill and retained metadata, interruption rollback and
the unchanged 970-FK catalog. All final quality gates and relevant integration
suites passed; see [completion report](p3-gap-closure-report.md). No later batch,
frontend change, activation, deployment, commit or push was performed.

Owner-approved finalization: normal `pnpm.cmd db:migrate:deploy` applied only
M071–M072 to local mehran_dev. Both local databases now have 97 successful
migrations, zero pending, zero unresolved failures and zero checksum mismatches.
All 95 approved SQL files remain byte-identical to the baseline; M071–M072 match
the successfully applied test versions. The two old resolved rollback records in
the development ledger were preserved unchanged. They are not failed migrations.

Before/after comparisons preserved all 1,536 existing development business
records, all seven test business records and every original migration ledger row.
Private comparison snapshots remain Git-ignored in `.tools/p3-finalization/`.
No reset, checksum repair or other database modification was used for finalization.
Final quality results and the exact integration command are in the
[completion report](p3-gap-closure-report.md). Commit/push are authorized for this
batch only; the resulting commit identity is recorded in Git and the final report
to the owner. No later batch was started.
