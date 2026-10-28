# 0011: Habit schedules, entry history, streaks and water

Status: APPROVED by owner, 2026-10-28, for P1-05 implementation.

## Context

P1-05 requires due-day checkbox uniqueness, multiple quantity entries, historical
corrections, pause/skip-neutral streaks and safe schedule changes. Weekly periods,
historical confirmation and entry-history representation are not yet defined.
PROJECT_INSTRUCTIONS.md sections 1.6 and 9 require an approved temporal decision.

## Approved decision

- Habit has immutable CHECKBOX/QUANTITY/DURATION type, canonical unit and
  GENERIC/WATER classification. CHECKBOX target is 1; DURATION uses integer
  seconds; QUANTITY uses exact decimals with up to three fractional digits.
  Values are nonnegative, targets positive, bounded to 999999999.999 (duration
  values/targets are integers). Decimal strings at the API and fixed-scale integer
  domain arithmetic avoid floating-point threshold/total errors. WATER is only
  QUANTITY with unit ML; there is no separate water entity or inferred goal.
- Schedules are calendar-date rules: DAILY; WEEKLY every seven days anchored at
  startDate; WEEKDAYS on selected ISO weekdays; INTERVAL every N days (1–365)
  anchored at startDate. No weekly quota or monthly recurrence is introduced.
  HabitSchedule stores typed snapshots of target, ACTIVE/PAUSED/ARCHIVED status,
  timezone and version-1 rule configuration with an effectiveFrom date. Choose
  the highest-revision applicable snapshot for a date; edits mean that date and
  future dates. Prior snapshots remain immutable and inspectable.
- Default a schedule/status/target change to today in the saved habit timezone;
  explicit effectiveFrom before today requires confirmHistoricalChange:true.
  Preserve all entries when changing a schedule, including confirmed historical
  edits. Never implicitly delete logs or move their dates. Type/unit/classification
  cannot change; explicitly create a new habit for a different measure. Archiving
  suspends expectations and new logging; historical corrections remain possible.
- Capture an explicit attributed localDate, immutable server recordedAt UTC and
  timezone of the effective schedule, plus the current account recordedTimezone.
  The attributed date may be historical and is distinct from the time the log was
  recorded. Default logging date is today in the saved habit timezone. Account
  timezone changes do not rewrite existing habit schedules or entries; a habit
  timezone change is an explicit versioned schedule edit. No local-time alarms or
  fabricated DST-gap occurrences are needed for date-only habit expectations.
- HabitEntry stores typed append-only correction revisions within that entity:
  stable logical entry UUID, revision-row UUID, same-habit root/previous FKs and
  a unique current revision. Prior amounts, attributed dates, context and
  recordedAt remain unchanged; only the previous row's current marker is closed.
  A correction/void appends a new revision with a timestamp and actor. Checkbox
  has at most one nonvoid current logical entry per habit/localDate; toggling uses
  a correction. Quantity and duration permit multiple logs per day. Entries cannot
  change attributed date or measurement type during correction.
- An explicit SKIP entry is unique per due date, can be voided with revision
  checks, and preserves partial logs. Skipping an already completed date is
  rejected. Further logging while a skip is active requires clearing it first.
  Logging on rest/paused dates is retained but does not create a due-day success;
  archived habits reject new logs. Skip is valid only for an active due date.
- For each attributed date, sum nonvoid current contributions using exact units;
  a due day succeeds at total >= the effective target (checkbox value 1). Rest,
  paused, archived and explicitly skipped dates are neutral and never increment
  streaks. A past unmet due day is MISSED and breaks a streak. An unmet as-of date
  is PENDING and does not break the current streak before that date closes.
  Recompute from canonical snapshots/current entry revisions after corrections.
  Statistics use explicit bounded date ranges (max 366 dates), return RANGE-scoped
  current/longest streak and due/completed/skipped/missed/pending counts and an
  explicit completion-rate numerator/denominator. Neutral dates are excluded from
  the denominator. No lifetime cached projection or worker is introduced.
- Routines are ordered same-space habit associations, at most 100 unique habits,
  with atomic revision-checked replacement/reordering and retained archive status.
  They do not duplicate habits, log entries or execute automatic bulk completion.
  Paused/archived associations remain readable and removable.
- Water summary sums nonvoid quantity logs of WATER habits by attributed dates,
  including retained history of archived habits and rest-day contributions.
  Return exact ML totals and per-habit targets/context; never combine separate
  targets into an invented global hydration recommendation.
- Use verified personal ownership on every resource/nested query and scoped FKs,
  optimistic revisions, existing 24-hour actor/scope/request idempotency receipts
  on creation/logging, transactional metadata audit and the specified version-1
  habit.entry_recorded / habit.entry_corrected outbox events. No quantities, titles
  or private habit content in audit/outbox/logs. No new consumers or jobs.

## Alternatives and impact

A separate HabitEntryHistory table exceeds this batch's approved entity registry;
overwriting entries loses correction evidence. Typed revisions inside HabitEntry
preserve history without JSON logs or extra entities. Weekly quotas and retroactive
timezone rebucketing would require additional product rules; anchored weekly due
dates and preserved local contexts follow existing date-only conventions.

Use additive migrations only, preserving all previous data and migration files.
Test daily/weekly/weekday/interval rules, thresholds and exact water totals,
pause/resume/archive/skip/miss, historical changes and corrections, DST/midnight/
travel, ownership/FKs, stale/concurrent writes, retries, ordered routine integrity,
earlier regressions and compiled API persistence after restart.

Owner approval: Explicit approval of this proposal in the P1-05 session.
