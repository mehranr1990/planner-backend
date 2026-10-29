# Personal analytics and optional rewards

P1-11 follows approved ADRs 0020 and 0021. All routes require a verified session
and the actor's Personal Space. Source owners expose narrow read facades; Insights
does not write source records. Journal/Mood analytics are unsupported and rejected.

## Analytics requests

Use `/api/v1/insights/{overview|tasks|habits|goals|time|finance}` with `from` and
exclusive `to` ISO local dates, at most 366 dates. Optional `timezone` defaults to
the current account setting. `grouping` is DAY (default), WEEK or MONTH. Weeks
use the account's current week start; months are Gregorian. Return resolved
context, partial edge buckets, canonical metric definitions, source types and
`computedAt`. Saved source dates/timezones remain unchanged after travel.
The preceding comparison must also fit the supported date floor of 1900-01-01;
requests that would cross it receive a validation error.

The previous period contains the immediately preceding equal number of local
dates. Absolute/percentage differences use exact arithmetic; absent observations
and zero baselines are explicit nulls. Current Goal status/progress and live work
are not fabricated historical comparisons. Goal historical observations come
only from actual immutable review snapshots. Explanations contain evidence metric
IDs/ranges and direction, without private content or causal/advisory claims.

Task `cohort` is DUE_DATE (default), SCHEDULED_DATE or COMPLETED_AT. Due/scheduled
cohorts use current dates and current DONE state, with an explicit denominator.
Completion-date metrics count distinct Tasks with historical completion transitions;
there is no invented completion-rate denominator. Counts of distinct Tasks in
separate buckets are not necessarily additive when a Task completes repeatedly.
Recurrence masters and nonactionable skipped/canceled occurrences are excluded.

Planning distinguishes daily selection counts from distinct selected Task counts,
and explicit planned minutes from unknown allocations. Habit consistency sums
canonical achieved/nonneutral due-day counts; skips remain separate and do not
inflate success. Streaks are range-scoped. Time uses clipped current nonvoid
TimeEntries, interval unions and explicit overlaps, with live work separate.
Finance reuses signed ledger effects, excludes transfer principal/adjustments
from expenses, includes fees and restates reversals in the original period.
Amounts stay exact decimal strings grouped by currency, without implicit FX.

Overview excludes Finance unless `includeFinance=true` is supplied on that
request. The dedicated Finance route is explicit owner consent for that read.
Neither setting permits Journal or Mood reads. Search consent grants no analytics
consent. No titles, narratives, reflections or mood values enter explanations.

Each request uses one repeatable-read snapshot, fresh bounded owner reads and
no MetricSnapshot cache. Each family rejects more than 10000 relevant source
records rather than truncating. Habit expectation evaluation and response metric
cells also have a 100000 work/output bound. Reduce the range or grouping density
after a safe 400 density error. No automatic historical source scan or cache job.

## Rewards and worker operations

`GET /rewards/preferences` returns account-owned revision/ETag. PATCH requires
If-Match, Idempotency-Key and explicit `enabled`/`displayAchievements` booleans.
Gamification defaults disabled. Enabling starts prospective accrual at a server
database instant; disabling stops accrual and hides progress/unlocks while retaining
private earned history. Re-enabling starts a new boundary without duplicate awards.

The existing compiled worker consumes committed Task/Habit outbox events using
independent reward handled/attempt/retry/failure fields. It does not take over
notification progress or start in the API process. Existing `pnpm worker` starts
both consumers through the same durable dispatcher and reviewed queue schema.

The first qualifying completion per ordinary Task earns 10 XP. Each first achieved
Habit/localDate pair earns 5 XP. HabitEntry has a nullable scoped source-event FK;
new entry/correction rows link to their exact outbox event in the same transaction.
Old entries are not backfilled or matched by timestamps. The owner rechecks current
canonical due-day achievement. Quantity beyond target, rest/pause/skip and historical
events preceding opt-in cannot produce extra rewards. Subsequent reopening,
correction or deletion never subtracts earned XP.

XpLedger has unique event and semantic source identities, positive integer rules,
same-Space FKs and exact string totals. The three approved catalog definitions are
FIRST_TASK, TEN_TASKS and SEVEN_HABIT_DAYS (distinct rewarded Habit/date pairs, not
a consecutive streak). Unlocks retain original timestamps. Progress is scoped,
cursor paginated and reports pending/failed consumer counts. A cursor from another
actor/scope is invalid. Achievement display can be disabled independently.

`POST /rewards/achievements/recalculate` requires preference revision and an
Idempotency-Key, accepts a bounded `limit` of 1–3 and optional returned `after`
code, and derives badges from retained earned history. It does not add XP or
fabricate events. Continue using the returned `nextCursor` as `after`.

Consumer effects and handled state commit together. Retries use 1/2/4/8-minute
backoff before exhausting five attempts. Failed rows retain the safe
REWARD_RECONCILIATION_FAILED code; inspect scoped freshness and database readiness.
Never manually fabricate rewards, alter source events or reset the database.
Source mutations remain committed if optional reward processing fails. Restart
uses the existing startup outbox job and periodic durable sweep for catch-up.

## Migrations and verification

Deploy the two additive P1-11 application migrations explicitly. The catalog seed
is accepted only by ADR 0021's exact name/SHA-256 guard; all other migrations use
the unchanged general additive/destructive gate. Preserve previous migration bytes
and the reviewed pg-boss artifact. No new queue schema, dependency or worker process.

Run targeted development tests, then `pnpm quality`, migration checksum verification
and `pnpm smoke:p1-11`. Smoke launches compiled API/worker processes in an isolated
test database, verifies restart persistence, reward deduplication, private ownership
and idempotent recalculation replay, and removes only its own fixtures/schema.
Docker and production deployment checks remain deferred to the deployment gate.
