# 0010: Calendar schedules, exceptions and historical consistency

Status: APPROVED by owner, 2026-10-28, for P1-04 implementation.

## Context

P1-04 authorizes CalendarEvent, EventRecurrence and TimeBlock, bounded range
expansion, and recurrence exception semantics matching Tasks. The specification
does not define calendar occurrence persistence, recurring duration, or how to
preserve elapsed schedules when a series changes. PROJECT_INSTRUCTIONS.md
sections 1.6 and 9 require an approved temporal decision before that work.

## Approved decision

- CalendarEvent owns an independent event or a recurring series. Each virtual
  occurrence is identified by the stable event/series UUID and original local
  recurrence key; it is not a Task and needs no occurrence table. A CalendarEvent
  exception row references its same-space series and has a database-unique
  (seriesId, recurrenceKey). Cancellation retains an explicit exception, rather
  than deleting history. No background materialization or worker.
- Store all-day Gregorian dates with an exclusive end separately from timed UTC
  instants. Timed input provides an IANA timezone and local start/end. Reject
  nonexistent explicit wall times; choose the earlier instant at folds and
  return that policy. A timed recurring event retains its elapsed duration;
  an all-day recurrence retains its number of local dates. Recurring gaps appear
  as SKIPPED/DST_GAP normalized occurrences, with no actionable event instance.
  Use ADR 0008's rule patterns, short-month/leap-day skipping and exclusions.
- Freeze timezone on every event, recurrence version and block. Account timezone
  changes affect defaults/display only. View timezone is explicit; Gregorian
  dates/UTC instants stay canonical, including with Jalali display preferences.
- THIS_OCCURRENCE creates/updates a revision-checked exception at the original
  identity. THIS_AND_FUTURE splits at that identity and creates a linked successor
  series, preserving the old segment and earlier exceptions. ENTIRE_SERIES
  changes only unelapsed, nonexception occurrences; retain elapsed schedule and
  explicit canceled/skipped/edited exceptions. EventRecurrence stores immutable
  typed schedule/content versions with identity boundaries so historical range
  queries retain their former content and timing. Stable recurrence keys do not
  change when an occurrence is moved. Reject identity collisions and edits that
  rewrite elapsed or canceled occurrence history. Series and exception revisions
  are checked under scoped serialization. No recurrence/completion Task writes.
- Event lifecycle is ACTIVE/CANCELED, plus a retained deletion timestamp; deleting
  removes it from normal views but leaves scoped history retrievable by ID.
  TimeBlock has timed start/end and optional existing same-space Task reference.
  New links require a current revision and an actionable Task; existing links
  survive completion/deletion/skip/master conversion with a safe disposition and
  remain detachable. Block edits never change Tasks or My Day selections.
- Views and conflicts use half-open date ranges in the requested timezone, max
  93 local dates, max 100 returned entries per page and bounded scanning with
  scope/query-bound cursors. Include moved exceptions by their actual interval.
  Expose SKIPPED and CANCELED entries explicitly. Conflicts compare active
  half-open intervals, include all-day events at view-zone day boundaries, and
  remain advisory; touching endpoints do not overlap. No strict booking mode.
- Require Idempotency-Key on event/block creation and series splits; use existing
  24-hour actor/scope/fingerprint receipts. Use If-Match on mutations, same-space
  FKs, safe metadata audit and transactional calendar_event.changed /
  time_block.changed outbox events. No event content in logs, audit or outbox.
- Keep ADR 0009 planning capacity's existing allocation-based contract unchanged;
  calendar conflicts/views expose scheduled occupancy independently, avoiding
  double-counting Task selections and blocks without an approved combination rule.

## Alternatives, migration and verification

An extra occurrence/history entity exceeds the approved three-entity registry.
Overwriting a single recurrence definition loses historical schedules. Immutable
EventRecurrence versions and CalendarEvent exception rows preserve history within
the approved entities. Wall-duration recurrence could vary elapsed duration or end
in a DST gap; elapsed duration avoids that ambiguity and is explicit in responses.

Use an additive migration only; never edit prior migrations or Better Auth tables.
Test all-day/DST/midnight/travel, recurring edits and cancellation, month-end and
leap-day, bounded pages and moved exceptions, ownership/FKs, concurrency/retries,
Task lifecycle links, outbox/audit safety and all earlier regression suites.

Owner approval: Explicit approval of this proposal in the P1-04 session.
