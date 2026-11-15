# P1-GAP-CLOSURE completion report

Batch: P1-GAP-CLOSURE. Status: COMPLETE after the checks recorded below.

| Requirement                   | Classification                            | Delivered/reused                                                                                                                                                                                                                                                     |
| ----------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR-1                          | IMPLEMENTED                               | Optional schedules, deterministic bounded occurrences, execution/history, actual Habit progress, archive protection and existing reminder/outbox integration.                                                                                                        |
| FOCUS                         | IMPLEMENTED                               | Explicit recoverable mode, validated event/receipt/effective timestamps, acknowledged heartbeats, interruption status, recovery, phase extension, pause/resume/finish/stop/discard and atomic unique tracked accounting. Existing sessions retain ADR 0013 behavior. |
| CAP                           | IMPLEMENTED                               | Account-owned weekly intervals, breaks through split intervals, date exceptions, explicit unknown states, actual authorized Calendar occupancy, overlap union, DST handling and daily/weekly aggregates.                                                             |
| PR-2 discovery/current status | IMPLEMENTED                               | Authenticated fail-closed policy read and scoped latest deletion request. Only existing approved retention metadata is returned.                                                                                                                                     |
| PR-2 recovery/retention       | ALREADY SUPPORTED                         | Existing scoped expiring proof, password confirmation, throttling, transactional cancellation, session revocation, policy/hold gates and erasure control are retained.                                                                                               |
| PR-3                          | IMPLEMENTED                               | Indexed exact inbox count independent of pagination, optional owned Reminder filter, existing read/dismiss/snooze semantics and mutation consistency.                                                                                                                |
| PUSH review                   | ALREADY SUPPORTED                         | Subscription CRUD, stale-provider revocation, public VAPID discovery, endpoint/key validation and generic private payloads. Frontend service worker/configuration still required; no live-delivery claim.                                                            |
| EXPORT                        | ALREADY SUPPORTED / improvements DEFERRED | Existing implementation reused unchanged; no export changes. A running worker is the known operational dependency.                                                                                                                                                   |

Files/modules changed: account policy/settings boundaries; habits scheduling and
execution; Focus evidence/domain/persistence; planning capacity and the Calendar
public read facade; notification count and routine-reminder facade. Contract
schemas, canonical/mirrored OpenAPI, focused tests and ADR 0052 were updated.
No dependencies, external services, frontend, Social/Admin features or Shared
activation were added.

Entities/migrations: new RoutineExecution with same-space Routine FK and unique
routine/date identity; optional Routine.schedule, FocusSession.recovery,
UserSettings.workingHours and Reminder.routineId with scoped FK; partial unread
index and reminder lookup index. Additive migrations 055–059 were applied only
to the isolated test DB. Earlier migrations were preserved. No real data backfill.

API contracts: eleven new operations, listed with headers, payloads, errors,
pagination and integration rules in
[the frontend handoff](frontend-handoff/PERSONAL_GAP_CLOSURE.md).
The canonical contract now has 1,056 operations. Eleven exact optional Focus
request/response signature transitions are recorded without replacing legacy
compatibility baselines. Existing API shapes remain usable.

Events/jobs/idempotency: reuse reminder.changed outbox and the existing worker;
no new scheduler, job system or event type. Routine actions and Focus heartbeats
use scoped receipts and transaction locks. Focus terminal entries retain unique
session/segment identities. Working-hours PUT uses the settings revision; Routine
schedule PATCH uses the Routine revision. Safe metadata audit is retained.

Security/edge cases: foreign resources/filters denied, scoped database FKs,
stale writes/repeated terminalization rejected, restart-readable persisted Focus
evidence, no indefinite accrual, no recovery-gap fabrication, no Habit auto-logs,
no invented availability, unioned scheduling intervals, visible DST gaps and
earlier folds. Deletion recovery does not restore old sessions or bypass policy.

Verification commands/results:

- `pnpm.cmd db:migrations:check`: PASS, additive review, deployed history, fresh
  schema, populated predecessor upgrades, interruption/repeat-deploy checks;
  configured databases were not reset.
- `pnpm.cmd exec vitest run --project unit apps/api/src/modules/focus/domain apps/api/src/modules/habits/domain apps/api/src/modules/planning/domain`: 59 PASS.
- Targeted working-hours application/Personal contract tests: 5 PASS, including
  DST elapsed duration, gap endpoints and weekly exceptions.
- `pnpm.cmd test`: final run 767/767 PASS across 167 files. Two exact API/migration
  registry expectations were updated for the approved additions; affected recheck
  also passed 19/19. No test was weakened or skipped.
- Relevant integration run across focus, habits, planning, notifications and
  personal-lifecycle: all five existing suites PASS (131 tests). Initial new HTTP
  failures were corrected. Final `pnpm.cmd test:integration apps/api/test/integration/personal-completion.spec.ts`: 9/9 PASS.
- `pnpm.cmd typecheck`, `pnpm.cmd db:validate`, `pnpm.cmd build`,
  `pnpm.cmd architecture`, `pnpm.cmd openapi:check`: PASS.
- `pnpm.cmd lint` initially exhausted the default heap. The normal complete
  ESLint invocation with `node --max-old-space-size=8192 node_modules/eslint/bin/eslint.js . --max-warnings 0`: PASS after fixing six type-import errors.
- `pnpm.cmd format:check` and `git diff --check`: PASS.

Tests not run: unrelated full integration/E2E/browser suites and live production
push/deployment/restore tests; these were outside this Personal batch. Existing
account-lifecycle integration tests cover signed-out cancellation, proofs, replay,
policy blocking and session behavior. No claim of live erasure or browser delivery.

Deviations/blockers: none outstanding. ADR 0052 records the owner-approved
recoverable Focus decision and additive scheduling/capacity semantics. Habit
progress uses current links and actual date records; no historical association
snapshot or invented completion data is claimed. Schedule capacity remains an
advisory snapshot rather than a booking lock. Frontend must use a single Focus
recording path; anonymous manual entries cannot be inferred to belong to a cycle.

Initial submission Git state: all changes remained uncommitted; no commit, push, deployment or development/
production migration was performed. Initial working tree was clean.
Next step: owner review and separately authorized frontend wiring; NOT STARTED.

## Owner-authorized local migration cleanup and Git checkpoint — 2026-11-15

The owner confirmed that mehran_dev and mehran_test are disposable local databases
without real users or production data, authorized recreation where necessary,
waived backups/rehearsals, and approved the Personal commit and normal main push.

- Development: normal Prisma migrate deploy applied the thirteen pending migrations
  from both 048 directories through 059. The database was not reset.
- Test: Prisma migrate reset --force, after the guard's required fresh consent,
  recreated the schema and applied all 84 unchanged migrations. This replaced the
  earlier deployed drafts of 031 and 054 with their committed canonical SQL.
- Both migration histories contain all 84 migrations, matching file checksums,
  with no pending or failed entries. No migrate resolve, checksum edits, historical
  SQL modifications, new repair migrations, or application changes were required.
- Production, pre-production, other databases and frontend code were not touched.
- Database catalog validation: both public schemas match exactly: 297 tables,
  3,291 columns, 4,912 constraints, 975 indexes and 110 function bodies. The missing
  CompanyRoomBookingTitle table and finance guard objects are now present.
- Revalidation: 767 tests passed across 167 unit/contract/architecture/compatibility
  files; typecheck, production build, OpenAPI, architecture, ESLint and Prisma
  schema validation passed. All six Personal integration suites passed (140 tests).
- Additional Company-finance coverage: 19/20 tests passed. The Project-disposal
  assertion at company-finance.spec.ts:1174 failed reproducibly, including an
  isolated recheck. No Project code or test was changed, weakened or bypassed.
  This broader lifecycle failure remains a separately scoped follow-up; the
  checkpoint does not claim that every Company/Project integration test passes.
- The commit/push result is recorded in the checkpoint reply and Git history.
  Frontend wiring remains separately authorized and unstarted.
