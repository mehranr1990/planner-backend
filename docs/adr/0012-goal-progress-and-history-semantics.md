# 0012: Goal progress, linked sources and historical reviews

Status: APPROVED by owner, 2026-10-28, for P1-06 implementation.

## Context

P1-06 specifies MANUAL, METRIC and WEIGHTED progress, raw values, historical
snapshots with rule versions and optional Task/Habit contributions, but not the
formula, observation window or snapshot representation. PROJECT_INSTRUCTIONS.md
sections 1.6 and 9 require approval for temporal/history decisions.

## Approved decision

- LifeArea is an ordered, revisioned personal grouping with ACTIVE/ARCHIVED
  lifecycle. Archived areas remain linked and readable; assigning a new goal to
  one requires reactivation. Goal has explicit SHORT_TERM/LONG_TERM horizon,
  optional startDate/targetDate (ISO dates, ordered), recorded timezone, optional
  same-space lifeArea and parent. Parents form an acyclic hierarchy, bounded to
  five levels. Hierarchy is organizational: no implicit child roll-up. Goals use
  PLANNED/ACTIVE/PAUSED/COMPLETED/ABANDONED; transitions are explicit and reversible
  with revision checks. Progress never changes status automatically. Retain goals
  and milestones through status changes rather than destructive deletion.
- Use exact decimal strings (up to six fractional places) and fixed-point/rational
  domain arithmetic. MANUAL takes an explicit percentage; METRIC computes
  100*(current-baseline)/(target-baseline) for the single explicitly selected metric.
  Targets must differ from baselines, supporting increasing and decreasing metrics.
  WEIGHTED normalizes the sum of explicit positive weights across contributing
  metrics, milestones and configured Task/Habit links. Return sum of weights,
  raw per-source values, raw percentage and visible percentage clamped to 0..100.
  Round percentages to six places only at the output boundary, half away from zero.
  An empty weighted set returns zero with NO_SOURCES, never division by zero.
  Source percentages are not clamped before aggregation.
- Milestones have explicit completion status and ordered position, optional target
  date, contribution flag and weight. A completed milestone contributes 100,
  otherwise zero. Metrics retain baseline/target/current/unit, contribution flag
  and weight; updates require goal revision. All nested mutations increment the
  parent goal revision. Bound each nested collection to 100 and weights to positive
  values <= 1000000; values/percentages are bounded to absolute 999999999.999999.
- Task links are unique per goal/Task and never copy or mutate Tasks. Configured
  contribution is 100 only for DONE ordinary Tasks; OPEN/IN_PROGRESS/CANCELED,
  deleted Tasks, skipped/canceled occurrences and recurrence masters contribute
  zero. Retain unavailable/deleted references with an explicit disposition.
  Reject new links to deleted Tasks or masters. A Task may link to several goals.
- Habit links are unique per goal/Habit, with an explicit bounded [from,to) local
  date window of at most 366 dates and contribution flag/weight. Contribution is
  the owner's canonical due-day completion rate in that range as of today in the
  saved habit timezone; rest/pause/archive/skip are neutral per ADR 0011, future
  dates excluded and a zero denominator contributes zero with NO_DUE_DAYS.
  Historical corrections/schedule edits affect current recomputation; account
  timezone changes do not reattribute Habit entries or prior Goal snapshots.
- GET progress recomputes from current authorized source state without writes.
  POST progress explicitly records an immutable snapshot using goal revision and
  Idempotency-Key; POST reviews stores private reflection plus the same snapshot.
  Store both in GoalReview, distinguished as SNAPSHOT/REVIEW, avoiding an unapproved
  extra entity. Each records server UTC time, saved goal timezone, goal revision,
  ruleVersion=1, source revisions/context and exact raw/visible calculations in a
  strictly validated versioned snapshot. Snapshots are non-queryable historical
  documents, not relational links. They never change after source edits/removal.
  Lists are scoped and cursor paginated; no arbitrary backdating or overwrite.
- Goals read sources synchronously via narrow owner public contracts within a
  caller transaction and consistent lock order; no cross-module repository access.
  Existing transactional Task/Habit events remain intact. Current progress always
  reflects source changes when requested; no background consumer/worker/cache is
  introduced before P1-10. Emit the specified metadata-only goal.progress_changed
  outbox event on progress-affecting goal mutations and explicit snapshots/reviews.
- Use personal ownership, scoped FKs including all source links, optimistic goal
  revisions, actor/scope/request idempotency on creates/snapshots/reviews and safe
  metadata audit. Never place titles, metric values, reflections or source details
  in audit/outbox/logs. No Project/Team/Company, OKR or dashboard entities.

## Alternatives and verification

Automatic status completion, implicit hierarchy roll-up, lifetime Habit measures,
backdated mutable snapshots and eager background recomputation require additional
product rules or infrastructure. Explicit contributions and immutable review
snapshots provide explainable progress within the approved seven-entity registry.

Use additive migrations with unchanged earlier history; test exact weights and
rounding, descending/zero-denominator metrics, cycles, nested revisions, unlinking,
source completion/reopen/delete/correction, historical snapshots, source ownership,
concurrent edits, idempotent replay, safe events, upgrade preservation and compiled
API restart persistence. All prior contracts and mandatory gates remain binding.

Owner approval: Explicit approval of this proposal in the P1-06 session.
