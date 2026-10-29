# 0020: Personal analytics definitions and optional rewards

Status: APPROVED by owner for P1-11 implementation, 2026-10-29.

## Context

P1-11 specifies explainable analytics, comparisons and an additive XP ledger,
but leaves cohort definitions, point values, achievement thresholds, private-data
opt-in and reward recomputation undefined. PROJECT_INSTRUCTIONS.md sections 1.6,
7 and 9 and the owner's P1-11 instructions require approval before implementing
these decisions. Existing ADRs 0008-0019 remain binding.

## Approved bounded decision

### Periods, exact metrics and source history

- Every analytics request uses explicit half-open Gregorian ISO local dates
  [from,to), an IANA view timezone and DAY/WEEK/MONTH grouping. Default timezone
  and week start come from account settings; return the resolved context. Maximum
  range is 366 dates. Group weeks using the resolved week start and months using
  Gregorian boundaries; return partial edge buckets explicitly. Jalali remains a
  presentation preference, not an implicit change to these request boundaries.
- The comparison period is the immediately preceding equal number of local dates,
  resolved independently through DST. Return current and previous raw values,
  absolute change and percentage change only when the previous value is nonzero;
  otherwise return null with NO_BASELINE. Ratios include integer numerator and
  denominator, decimal percentage rounded HALF_UP to six fractional places and
  null with NO_DENOMINATOR when empty. Never fabricate a positive zero-data score.
- Task completion uses an explicit cohort selector DUE_DATE, SCHEDULED_DATE or
  COMPLETED_AT. Due/scheduled cohorts count distinct nondeleted ordinary Tasks
  currently attributed to that period, including canceled Tasks in the denominator;
  numerator is those currently DONE. COMPLETED_AT counts distinct Tasks with a
  recorded completion transition in the period and reports a count, not a rate
  with an invented denominator. Repeated completion transitions count a Task only
  once per requested period. Masters and skipped/canceled recurrence identities
  without actionable Tasks do not count. Completion transitions remain historical
  facts after reopening; due/scheduled cohorts explicitly reflect current dates.
- Planning metrics use distinct daily Task selections and their explicit planned
  minutes, not copied Tasks or inferred due dates. Report selected/completed Task
  counts and completion ratio per daily plan; weekly totals distinguish selection
  count from distinct Task count to avoid claiming repeated selection is new work.
- Habit metrics reuse the owning module's effective historical schedules and
  current entry revisions. Count achieved, skipped, missed and pending due days
  separately; rest/pause/archive/skip are neutral per ADR 0011. Aggregate consistency
  is the sum of achieved due days divided by the sum of nonneutral due days, never
  an unweighted average of individual percentages. Retain RANGE-scoped streaks.
- Goal analytics return current canonical progress and status counts, with explicit
  per-goal values. Comparisons of historical progress use only actual immutable
  GoalReview snapshots in each period; missing snapshots yield NO_OBSERVATION.
  Do not backdate current progress, average unrelated goal units or roll up hierarchy.
- Time metrics reuse current nonvoid TimeEntry intervals: clip to period bounds,
  calculate raw, distinct union and overlap milliseconds, and expose live work
  separately. Never add FocusSession totals to their tracked TimeEntries. Finance
  metrics reuse exact signed ledger reports grouped by currency; transfer principal
  and adjustments are excluded from income/expense, explicit fees count as expense,
  reversals restate their original period. No combined currency total or new FX.
- Each response identifies ruleVersion=1, metric IDs, definitions, source types,
  source context and computedAt. On-demand scoped reads use a consistent database
  snapshot and bounded owner facades; cap relevant source rows at 10000 per family
  and reject dense requests rather than truncate totals. No MetricSnapshot cache:
  current source corrections are visible on the next request. Historical immutable
  reviews/entries retain their saved dates/zones; view-time grouping of UTC instants
  never rewrites them. Comparisons describe recomputation, not an as-of database.

### Explainability and privacy

- Overview includes productivity families by default. Finance requires explicit
  includeFinance=true on each overview request; the dedicated /insights/finance
  request is explicit owner opt-in. Neither consent includes Journal or Mood.
- No Journal/Mood source is queried in P1-11. Reject attempted includeJournal or
  includeMood opt-in with a safe unsupported-option error, including true values;
  search consent from ADR 0014 grants no analytics consent. No private content,
  narratives, account names or mood values in insight explanations/audit/events.
- Deterministic explanations report only increases/decreases/unchanged values for
  defined task completion, habit consistency and distinct work metrics compared
  with the preceding period. Include evidence metric IDs, range and rule version;
  suppress a trend when its denominator/baseline is absent. No causal, medical,
  financial advice, productivity score, AI inference or speculative threshold.

### Optional XP and achievements

- Gamification defaults disabled. Account-owned revisioned preferences hold
  enabled, enabledSince and displayAchievements; no new preference entity. Enabling
  starts prospective accrual from that database instant. Disabling stops accrual
  and hides progress/unlocks from normal responses but preserves private history.
  Re-enabling starts a new eligibility boundary without re-awarding prior sources.
- Version-1 XP rules: first qualifying task.completed event per ordinary Task
  earns 10 XP; first achieved habit due day per (Habit, attributed localDate) earns
  5 XP. No XP for quantity beyond target, rest/pause/skip, finance, mood, goals,
  timer duration or historical events predating opt-in. Habit entry/correction
  events recheck the owning module's canonical achieved state. Historical logging
  can qualify only when its event occurs during opt-in; no automatic lifetime scan.
- XpLedger is append-only, positive integer points, unique source-event UUID and
  unique same-space semantic reward key. Recompletion/retries/multiple quantity
  entries cannot reward a source twice. Later reopening, correction or deletion
  never subtracts earned XP. Return that explicit earned-history policy rather
  than presenting XP as current completion accuracy. Bound totals with exact
  integer arithmetic and serialize totals as decimal strings.
- Three immutable version-1 AchievementDefinition rules: FIRST_TASK (one rewarded
  Task), TEN_TASKS (ten rewarded Tasks), SEVEN_HABIT_DAYS (seven distinct rewarded
  Habit/localDate pairs). They are participation badges, not consecutive streak
  claims. AchievementUnlock is unique per personal Space/definition and records
  original unlock time/rule version. Recalculation derives unlocks from the retained
  ledger, is bounded/paginated and idempotent, and never changes points or invents
  source events. Disabling display hides badges without deleting history.
- Reuse the existing compiled worker and durable outbox dispatch, with independent
  reward-consumer handled/retry/failure metadata; notification consumption remains
  unchanged. No new worker process, queue schema or dependency. Process committed
  Task/Habit events asynchronously, in bounded batches with per-space serialization,
  owner-facade revalidation, positive ledger constraints and atomic ledger/unlock/
  handled-state writes. Failed rewards never undo source mutations. A retry after
  ambiguous process termination rechecks the unique ledger identities. Surface
  processing freshness/pending state without exposing another owner's events.

## Alternatives, migration and verification

Lifetime source backfills, negative XP, arbitrary productivity scores, private mood
inference and implicit cross-currency aggregation introduce unsupported product
semantics. Cached metric snapshots require invalidation complexity without an
established expensive query, so bounded fresh reads are preferred.

Use only AchievementDefinition, AchievementUnlock and XpLedger as new entities,
additive account/outbox fields and scoped constraints/indexes. Preserve all twenty
application migrations and the hash-pinned pg-boss artifact byte-for-byte. No
Better Auth schema changes, new infrastructure or P1-12 functionality.

Test exact aggregation, zero denominators, multi-currency, changed Task dates,
source corrections, repeated events and semantic duplicate rewards, opt-in bounds,
disable/re-enable, historical recomputation, worker/API restarts, DST/local midnight,
week start changes, ownership and rejected private opt-in, dense query rejection,
bounded pagination and prior API compatibility. Run all thirteen quality stages,
migration checksum/preservation checks and compiled restart smoke at completion.

Owner approval: Explicit approval of this proposal in the P1-11 session.
