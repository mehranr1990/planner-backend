# P1-10 completion report

Batch: **P1-10: Reminders, Notifications & Scheduled Jobs**  
Status: **COMPLETE for approved local development scope**  
Date: 2026-10-29. Runtime Node 24.22.1; local PostgreSQL 18.6; Windows.

P1-09 was finalized with the requested message, committed as
`dbe3de6573473321db73a29f5faf9906ce3ee76a` and normally pushed to origin/main.
The push, clean starting tree and zero ahead/behind were verified before P1-10;
a final independent remote read still matches that hash. P1-10 is uncommitted.

## Scope and boundaries

Implemented the five approved entities: Reminder, Notification,
NotificationDelivery, NotificationPreference and PushSubscription. Absolute,
local and Task-relative scheduling includes standalone recurrence, saved timezone
context, deterministic DST gap/fold history, quiet hours, cancellation/pause/resume,
future-only opt-in reopen, bounded catch-up, stable logical fingerprints, endpoint
fanout, five-attempt transport backoff, lease fencing and explicit ambiguous
acceptance. In-app publication is atomic; snooze references its original delivery.
External email/Push are server-configured and user-opt-in with generic payloads.

Tasks exports read-only ReminderTasks and Account exports NotificationIdentity.
No Task, Goal, recurrence, My Day, attachment permission or earlier contract is
rewritten by notification work. APIs cover reminders, owned inbox/read/dismiss/
snooze/preferences, private Push subscriptions and a nonproduction test route.
Mutations retain owner checks, revisions, idempotency, safe audit and outbox rules.
The only new domain event is reminder.changed v1 with an empty payload.

A lazy pg-boss adapter, notification-only outbox cursor, startup/periodic repair
and a separate compiled worker are implemented. API startup never opens a queue
connection or installs schemas. No additional broker, AI/provider integration,
frontend, Project/Team/Company module, P1-11 or P1-12 feature was started.

Changed areas: Notifications domain/application/infrastructure/HTTP; narrow Task
and Account public facades; platform jobs/outbox/audit; configuration and separate
worker entrypoint; Zod/OpenAPI; three additive migrations; focused tests and
exact-identity integration fixture support; Compose preparation, ADRs, notices,
runbooks and traceability. The final review contains **91 changed/new files**,
including this report, with no staging or P1-10 commit.

## Verification

Final `pnpm quality`: **13/13 stages PASS**, **678 tests in 67 files**:
350 unit/contract/architecture/compatibility tests in 50 files, and 328 real
PostgreSQL integration tests in 17 files. No skipped or weakened final tests.

All mandatory stages passed: config:check, db:generate, auth:schema:check,
db:validate, build, typecheck, format:check, lint, architecture, test,
openapi:check, test:integration and db:migrations:check. Architecture reports no
violations across 246 modules / 1283 dependencies. OpenAPI matches its snapshot
and every earlier compatibility baseline through P1-09.

`pnpm smoke:p1-10`: **PASS** against the final compiled API and worker. Real
process restarts verify persisted reminders/inbox, durable backfill, receipt replay,
pre-network lease recovery, no automatic resend of ambiguous acceptance, expired/
DST-gap history, private delivery sinks, generic job/audit payloads and owner denial.
Real pg-boss tests cover queue restart, concurrent pending upsert, bounded retry/
dead letters, reviewed schema drift and repeat setup in an owned test namespace.
`pnpm audit --prod --json`: zero advisories across 374 production dependencies.

Initial full-gate attempts exposed fixture teardown running under the deliberately
short API health timeout and an outbox test assuming an empty global backlog.
Only test support was corrected: exact recorded identities, an isolated bounded
administrative cleanup transaction and private failure manifest; unchanged API
query/test-case deadlines and assertions; the same 10001 exact finance fixture
rows with less setup overhead; bounded passes settling recorded owner events.
The final full gate and compiled smoke passed after those corrections.

NOT RUN / DEFERRED: Docker image/startup/Linux permission checks, production
deployment/restore release checks, and live SMTP/browser Push. Local sinks and
mocked vendor transports verify the approved backend behavior; no real external
message was sent. These deferrals do not claim deployment completion.

## Migrations, preservation and decisions

**20 successful application migration checksums match in development and test;
zero unfinished migrations.** All 17 previously approved migration files remain
byte-identical. Empty-schema replay, preserved earlier-batch fixtures (including
exact finance postings/FX/budget/bill/savings/capture identity), repeated deploy and
all new constraints passed. Development/test migration deployment retained hashes
of every pre-existing table/row projection. Configured databases were never reset.

The first new development migration attempt referenced OutboxEvent.createdAt
instead of occurredAt and stopped after preceding additive DDL. Recovery verified
all 55 earlier table hashes and empty new tables, completed only the corrected
remaining additive DDL transactionally, then resolved that new migration as applied.
The final file is atomic; failed/rolled-back evidence is retained. Separate additive
migrations enforce active subscription keys and current query/history indexes.

Owner-approved ADRs **0018** and **0019** govern semantics, privacy, dependencies
and the exact vendor schema exception. No unapproved architecture/scope deviation
or unresolved ADR remains. The pinned dependencies and notices are documented.

Vendor schema planner_jobs: pg-boss **12.38.0**, schema version **46** in both
databases, exact reviewed construction plan **22056 bytes**, SHA-256
`33395ea7aaf8d17f4eceec23c45fcb6672a278f11d3c1a255d8589491278e238`.
It is installed only by the explicit reviewed one-off command, outside the Prisma
application ledger. Runtime migration/schema creation and telemetry are disabled.

Applied application SHA-256 (development = test):

| Migration                                       | SHA-256                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| `202610270001_p0_02_identity_ownership`         | `378358fa7e8ce9ea3e88ac0c59e5df5bdefab923d3126ba943b0bb09165f2b55` |
| `202610270002_p0_03_data_api_events`            | `c351a30a0b1f55979b6fc2d13d2fb4683ddc5e880541a7774c51d6e0c78ca833` |
| `202610270003_p0_04_private_files`              | `1a8b6c10e7681166fce6a84e98355150efe2b58918cdbabc57b9bacb8ef07b07` |
| `202610280001_p1_01_tasks`                      | `b756f32a2b578d41172ba3c0cf30d3735535b54d184c513609c83acc66adde68` |
| `202610280002_p1_02_task_recurrence_tools`      | `cefe69017ff57383b188960ba734982b140a1eadfffaee4b43e11f758e20afd2` |
| `202610280003_p1_03_personal_planning`          | `fba0b1e53da2cb239add7278473230fc695409fa1efab79af9ee7abd51d2c6a4` |
| `202610280004_p1_04_calendar`                   | `5845390f0af36663781451c88e92d24acf55587d9ed20e44a401e96535333a40` |
| `202610280005_p1_04_calendar_integrity`         | `441f7b88dfba3a19c8942a2a4d8c4e1a873ec98f7c0a48f9d227cd65281f2112` |
| `202610280006_p1_05_habits`                     | `84ef468f8542a5bc7de152f0c17ab9e9fa4cb1cf36aed021d6977c5b3ce6f78e` |
| `202610280007_p1_05_habit_config_integrity`     | `31d412b93603e4a7520b37f3c7dae009e626c1f70969b741feb054d0b751087d` |
| `202610280008_p1_06_goals`                      | `7bdb92bae5c416c864c2363763a092282fbc7cfa8142049c6b64d928c1d9c7e3` |
| `202610280009_p1_07_focus`                      | `5082240f049dd925fff0e50a384322d6bd42a4dff80b51bc256108ad3221e0e0` |
| `202610280010_p1_07_productivity_audit`         | `e551139a49771ab809e07f8f53e200137e6ad7b2c05592de347a136689dd6ec3` |
| `202610280011_p1_08_private_writing`            | `bb56406efedf8d0e96117e3c98d0e773cecdbce06e7e9414a0e5b29a988de593` |
| `202610280012_p1_08_private_voice`              | `fdb40cbbdc0fffc5d631fdda67eb0455ac73d689a6e5009172eab6442c63fbbb` |
| `202610280013_p1_09_finance`                    | `e31dcb994b477ec6f737ba48d176f23af84ced52bf9cbc7ae7a07d3783fca6c5` |
| `202610280014_p1_09_capture_finance`            | `03e1cdddf71bafec282fa9ec334453ea0549f55a5a2d4df47c0a15eec97d7448` |
| `202610290001_p1_10_notifications`              | `9ef22bc64e6bbc1df3382bc732b72bae3c3fcad1184d6ff6093342d3d0683524` |
| `202610290002_p1_10_notification_guards`        | `2c6797191a9b3671129ba751935e9cc5c4bdd1e1971a9dc15c4214c96e2fbd06` |
| `202610290003_p1_10_notification_query_indexes` | `c14530ba67674c65937e707ebd37b844d60fa346c202c7b3e026006928d88a50` |

Local ignored evidence: .tools/p1-10/quality-final.log, quality-final-result.json,
compiled-smoke.json, checksums-final.json, database-verification.json,
migration-recovery.json, dependency-audit.json and candidate-review.json.
Earlier failed gate evidence is retained separately; exact fixture recovery
manifests are empty after successful cleanup/recovery.

## Final Git and next boundary

Branch main; HEAD and independently checked origin/main remain
`dbe3de6573473321db73a29f5faf9906ce3ee76a`; zero ahead/behind.
Working tree contains the approved uncommitted P1-10 files; index empty.
No secrets, actual environment files, private uploads/databases, build outputs or
unrelated changes are included. The tracked .env.example contains only safe samples.

Blockers: none for the approved local scope. Next eligible batch: **P1-11: NOT STARTED**.
No P1-10 commit or push. Stop after this report.
