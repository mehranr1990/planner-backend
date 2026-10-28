# 0009: Personal planning, rollover and capacity

Status: APPROVED by owner, 2026-10-28, for P1-03 implementation.

## Context

P1-03 requires daily/weekly planning, reviews, explicit rollover and capacity.
Its capacity rule mentions planned blocks, but Calendar/TimeBlock begins only in
P1-04; Task-level estimates begin in P1-07. Existing account preferences have
timezone and firstDayOfWeek, but no configured available hours. These omissions
must not introduce a premature calendar or invent task estimates.

## Approved decision

- DailyPlan is unique per (spaceId, localDate). DailyPlanItem references the
  existing same-space Task, with at most one selection per date/Task, explicit
  order and optional plannedMinutes. This is a planning allocation, not a Task
  estimate or TimeBlock. Null means unknown; zero means explicitly no allocation.
  Limit a daily plan to 100 selections and a single allocation to 0–1440 minutes.
  Preserve Task identity, dates, history and revisions: planning never writes Tasks.
- WeeklyPlan is unique per (spaceId, weekStartDate). It composes the seven daily
  plans in its date range and stores its own revision/context; there is no second
  weekly Task store or undated weekly backlog. Weekly selection/order/removal is
  performed through the corresponding daily plans. No WeeklyPlanItem entity.
- Record timezone on creation of daily/weekly plans and reviews; weekly plans
  also record firstDayOfWeek (existing account convention Sunday=0). Existing
  records keep their original date/context after preference changes. New weeks
  must begin on the current preferred weekday. Existing weeks remain readable
  and editable by their original date after a week-start change. New plans use
  current preferences. Explicit dates are never silently reinterpreted or moved.
- Store optional version-1 weekday available-minutes configuration on existing
  UserSettings, owned/written through the account public contract. Configure it
  through /planning/capacity/availability with strong settings revision checks;
  preserve the existing /me/settings response/request shapes. Null means not
  configured, not an assumed eight-hour day. Each of seven values is 0–1440.
  Capacity is the sum of explicit planning allocations versus configured minutes
  for those local dates. Report unknown allocations and availability explicitly;
  over-capacity is advisory. Durations are minutes, so a DST day does not silently
  change configured duration. No calendar events, blocks or Task estimates.
- PlanningReview supports MORNING/EVENING for a daily date and WEEKLY for a week
  start, unique per space/date/kind, with private reflection text and revisions.
  Weekly reviews record the week's original context when available. Content
  lives only in planning, with no Journal entity/link before P1-08. Never copy
  reflection text into audit, outbox or logs.
- Daily selections are deliberate references. Selecting a master, missing,
  deleted, completed, skipped or canceled Task is rejected. Existing selections
  remain traceable if their Task later changes, and can always be removed.
  Record the selected Task revision; explicitly refreshing the selection with
  the current Task revision resolves a stale reference without changing the Task.
- Rollover preview is read-only: source/target dates and revisions, settings
  revision, candidate Task/item revisions, and READY/STALE/COMPLETED/DELETED/
  SKIPPED/CANCELED/BLOCKED/ALREADY_SELECTED dispositions. No Task or plan writes.
  Commit requires Idempotency-Key, those revision snapshots and explicit selected
  Task IDs; COPY retains source selections, MOVE removes only successfully moved
  references. Changed plan/settings revisions reject the request with 409; changed
  or ineligible Tasks receive per-item safe outcomes and remain untouched.
  Missing destination is represented by revision 0 and may be created explicitly
  by commit only if still absent. Commit never changes Task due/scheduled dates.
  Snapshot inputs are revalidated authoritatively; no preview token/entity/worker.
- Use existing scoped transactions, safe metadata audit and idempotency receipts.
  Acquire Task consistency through its public read contract inside the same
  transaction; no cross-owner raw ORM access. No new planning event types are
  introduced without a current consumer; existing Task outbox behavior is untouched.

## Alternatives and impact

Implementation consequence of approved ADR 0008: when a previously selected Task
is subsequently converted into a recurrence master, retain its selection only as
blocked reference metadata. Exclude the master from My Day items, weekly Task
counts and capacity totals; expose the unresolved allocation count and keep the
reference removable. No Task or historical selection is silently deleted.

Implementing TimeBlock or Task estimates now would cross approved batch
boundaries. Assuming a workday or inferring effort from titles/due dates would
invent capacity. Explicit allocations/configuration expose known and unknown
capacity without those features. Weekly composition avoids duplicate Tasks and
an unapproved weekly-selection entity. A separate weekly backlog or wall-clock
availability windows can be decided later if explicitly requested.

## Migration and verification

Add only DailyPlan, DailyPlanItem, WeeklyPlan, PlanningReview and nullable account
availability configuration, with scoped FKs, uniqueness and positive revisions.
Test isolation, uniqueness/order/move/removal, recorded timezone/week contexts,
DST/midnight, stale/concurrent edits, rollover retries/partial results, terminal
Task/occurrence handling, unknown/invalid capacity and private reviews. Preserve
all earlier migrations/contracts and run the required final gates/restart smoke.

Owner approval: Explicit approval of this proposal in the P1-03 session.
