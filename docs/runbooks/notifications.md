# P1-10 reminders and notification operations

Approved [ADR 0018](../adr/0018-reminder-timing-delivery-and-privacy.md) defines
intended dates, quiet hours, recovery and privacy. [ADR 0019](../adr/0019-durable-queue-schema-and-channel-adapters.md)
authorizes the pinned queue schema and transport dependencies. Tasks remain owned
by Tasks; scheduling reads its public facade and never changes Task identity,
status, due dates, recurrence or planning selections.

## Controlled local setup

Use the existing Node 24 / local PostgreSQL environment and private ignored `.env`.

```powershell
pnpm db:migrate:deploy
pnpm jobs:migrate
pnpm build
pnpm start
# Separate terminal/process, using the same database and configuration:
pnpm worker
```

The API never connects to pg-boss or installs schemas. It can accept authorized
reminders while the worker is stopped. The worker verifies an already installed
schema and precreated queues before announcing readiness. Its durable UTC minute
sweep and startup sweep repair missed dispatch. Delivery jobs contain only IDs;
database state, not a job payload, authorizes each effect. Deferred pending jobs
are upserted by delivery ID, including moving a changed deadline earlier.

The first development application-migration attempt referenced `createdAt` on
OutboxEvent; its actual timestamp is `occurredAt`. The preceding additive objects
had been created. Recovery verified unchanged hashes for all 55 earlier tables
and empty new tables, completed only the remaining corrected additive statements
inside a transaction, and marked that new migration applied. No records, tables,
prior migrations or configured databases were removed/reset. The reviewed final
migration includes an outer transaction, and a separate additive guard explicitly
rejects null keys on active Push subscriptions. Both development/test ledgers now
match all 20 reviewed checksums with zero unfinished migrations. The final additive
index migration supports existing active-count, typed history/snooze and consumer
queries without changing business data or earlier migration files.

`jobs:migrate` verifies the pinned construction plan against the reviewed SQL and
hash, creates only `planner_jobs`, stamps its version/hash in the schema comment,
and creates four queues. Repeated matching setup is safe; drift fails closed.
It is a separate reviewed one-off operation, not a Prisma reset or startup hook.
Queue version: **46** / pg-boss **12.38.0**. Reviewed plan SHA-256:
`33395ea7aaf8d17f4eceec23c45fcb6672a278f11d3c1a255d8589491278e238`.
No vendor SQL runs against the public application schema. Tests own a fresh
`planner_jobs_test_<32 hex>` namespace in the isolated loopback test database.
Only that test-owned namespace is removed on cleanup.

## Configuration and channel consent

`JOBS_SCHEMA=planner_jobs`, `JOBS_POLL_SECONDS=1` (1–30). In-app is enabled in
default personal preferences. Email and Push require separate server configuration
and user opt-in; enabling an unavailable adapter is rejected.

- `NOTIFICATION_EMAIL_ENABLED=false` by default. Opt-in email uses the existing
  SMTP configuration; local `MAIL_MODE=sink` writes private test receipts.
- `PUSH_MODE=disabled` by default. `webpush` requires a privately provisioned,
  matching P-256 `PUSH_VAPID_PUBLIC_KEY` / `PUSH_VAPID_PRIVATE_KEY` pair and
  `PUSH_VAPID_SUBJECT` (`mailto:` or HTTPS). The public key is exposed in owned
  preferences; the private key never is. `sink` is nonproduction only.
- `NOTIFICATION_SINK_DIR=.tools/notifications` is private local test output.
  Production forbids Push sinks and test queue namespaces.

Push subscriptions require valid auth/curve material and HTTPS endpoints on
explicit Google FCM, Mozilla, Apple or Windows provider hosts. Ports other than
443, userinfo, fragments, IP hosts and arbitrary forwarding are rejected. The
transport rechecks public DNS addresses, limits request time and does not follow
redirects. HTTP 404/410 revokes and clears endpoint/key secrets. Subscription
rotation/revocation uses its revision. Logging out ends API access; an independently
opted-in subscription persists until explicit revocation or provider expiry.

External email and Push contain generic app text and opaque identifiers only.
Private labels, Task titles, journal/mood/finance content, amounts, endpoints and
keys do not enter jobs, audits or provider error storage. Endpoint URLs/keys are
never returned by subscription list/mutation responses.

## API and scheduling behavior

All routes use `/api/v1`, verified sessions and Personal Space ownership. Reads
use bounded, filter-bound cursors. Mutations require trusted Origin,
`Idempotency-Key` and, except creation/test, `If-Match`. Missing/foreign resources
are 404; stale revisions or identity collisions are 409.

- `/reminders`: create/list. `/{id}`: get/patch/cancel; `/{id}/pause`,
  `/{id}/resume`, `/{id}/deliveries` expose explicit lifecycle and safe history.
- `/notifications`: owned in-app inbox by default; `history=true` also returns
  external-only history. `/{id}/read`, `/{id}/dismiss`, `/{id}/snooze` preserve
  acknowledgement/history and never mutate the Task. Snooze creates fresh
  deliveries with typed original notification/delivery references.
- `/notifications/preferences`: per-space defaults, channel consent,
  `reactivateOnReopen`, optional paired quiet-hour clocks. Equal quiet endpoints
  and partial clock pairs are rejected. Urgent delivery explicitly bypasses quiet
  hours; other delivery defers while retaining its intended instant.
  Quiet hours use the selected reminder zone, including FIXED zones during travel.
- `/push/subscriptions`: create/list; `/{id}`: revisioned rotation/revocation.
- `/notifications/test`: nonproduction only, channel consent still applies.

Rules are versioned ABSOLUTE UTC, LOCAL date/clock or TASK-relative due/planned
instant/date. Date-only Task schedules require an explicit local clock. A Task
selection includes its revision; master/terminal/deleted Tasks cannot be selected.
LOCAL standalone recurrences support daily, weekly, selected weekdays, monthly,
yearly and intervals with end/count/exclusions. Missing month days / Feb 29 skip.
Selected weekday integers are Sunday=0 through Saturday=6; interval weeks are
anchored to the saved start date and do not drift with account week preferences.
Nonexistent local instants retain SKIPPED/DST_GAP rows with null scheduledAt and
zero sends. Folds use the earlier UTC instant. FIXED zones retain saved context;
ACCOUNT follows changes for future unsent work. Delivered local occurrence keys
prevent repeat delivery during travel, including a gate-time duplicate check.

Source date/state changes reconcile through current Task snapshots and an
independent notification consumer cursor on immutable outbox events. Completed,
deleted, canceled or skipped sources cancel unsent deliveries. Explicit user
cancellation stays canceled. Reopen needs opt-in and a future intended instant.
Pause/resume never silently backfills the paused interval. Ordinary missed work
within seven days can deliver late once; older work retains EXPIRED/MISSED history.

## Recovery, failures and limits

Each catch-up scans at most 100 local dates per reminder transaction and saves its
cursor. A sweep selects at most 100 reminders and 100 delivery IDs; reminder pages
continue by opaque ID. Active reminder limit is 1000 per owner; active Push
subscriptions are limited to 20. Endpoint attempts are children of one unique
logical `(reminderId, scheduledAt, channel)` delivery, never independent channel
fingerprints. Successful siblings are not repeated after another endpoint fails.

Delivery uses PostgreSQL time, scoped locks and leases. Expired pre-network leases
can retry. A network-started lease without a durable provider result becomes
AMBIGUOUS and is **never automatically resent**. External exactly-once delivery
cannot be promised. Deterministic SMTP Message-ID and Push topics are hints only.
Five transport attempts are allowed; definitive temporary failures back off
60/300/900/3600 seconds. A cancellation before the send gate prevents transport;
one already authorized/in flight retains the actual result and cancel-request
timestamp. Provider I/O happens outside business database locks.

Queue handler failures use safe fixed codes, three queue retries and the durable
dead-letter queue. Notification outbox reconciliation has its own bounded five
attempts and failure/retry metadata; a failed event does not block later events.
Source sweeps still repair current reminder state. Operational inspection uses
authorized DB access to delivery state/reason/attempts, lease timestamps, outbox
consumer failure codes and the vendor job/instance tables. Never export private
endpoint keys or replay AMBIGUOUS/DELIVERED rows as a recovery shortcut. There is
no automatic purge of notification/delivery history; lifecycle retention remains
P1-12. Terminal vendor jobs expire after seven days.

Run `pnpm smoke:p1-10` after building. It starts real compiled API and worker
processes against the isolated test database, verifies restart/replay/backfill,
lease ambiguity, expiry/gap history and private sinks, then removes its own
identities and queue namespace. Docker image/startup, Linux permissions, live
SMTP/browser Push and production deployment remain **DEFERRED**. Compose defines
a separate worker using the same image, without API ports or private-file volume.
Perform both controlled schema setup steps before starting it.

The integration harness keeps application statement/health deadlines and every
existing business assertion intact. Fixture teardown is administrative work over
the full schema: it uses only exact recorded IDs/emails/request IDs against the
guarded isolated test database, with a separate five-second statement deadline
and atomic rollback on failure. It never deletes by prefix/time or resets a
configured database. Failed cleanup retains only an ignored ownership manifest
under `.tools/fixture-cleanup` for exact recovery. Prior full-gate attempts exposed
the old coupling between teardown and the 300 ms API health timeout; no security,
rate limit, functional assertion or test-case timeout was relaxed to fix it.
