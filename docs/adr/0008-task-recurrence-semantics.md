# 0008: Task recurrence identity and temporal policies

Status: APPROVED by owner, 2026-10-28, through explicit P1-02 policy approval.

## Context

MP-IMP-001 section 10.5 requires locking recurrence ambiguity behavior and the
TaskOccurrence/master Task mapping before implementation. Section 7 defines
short-month and leap-day skipping but permits a choice for DST gaps and folds.
No existing approved ADR resolves the mapping or these DST choices.

## Approved decision

- A TaskRecurrence owns a schedule and references an existing Task as its master.
  The master keeps its ID and existing history. Each actionable TaskOccurrence
  has its own stable ID and references one ordinary Task with a distinct ID.
  Completion/reopen/cancellation of that Task and its occurrence state change in
  the same transaction. Occurrence-only skip preserves the Task and records the
  skip; it does not record task completion. The master is non-actionable: reject
  completion/reopen and exclude it from ordinary task lists, My Day, overdue
  counts, completion statistics and productivity metrics. Occurrence completion
  never completes the master or another occurrence. Terminal occurrence history
  remains immutable and traceable.
- The immutable recurrence key is the original intended local date and time in
  the series timezone. Enforce unique (seriesId, recurrenceKey) and scoped FKs.
  Rescheduling one occurrence keeps its original key and Task ID.
- Persist explicit policies: nonexistent spring-forward wall times produce a
  SKIPPED occurrence with reason DST_GAP and no actionable Task;
  ambiguous fall-back wall times resolve to the earlier instant. These policies
  are returned by the API, so neither resolution is an undetected time shift.
  Monthly dates absent from a month and yearly February 29 in non-leap years are
  skipped, as the specification requires. Use Gregorian schedule dates and IANA
  zones; changing account timezone never changes an existing series implicitly.
- THIS_OCCURRENCE changes only the identified pending occurrence and marks it an
  exception. THIS_AND_FUTURE ends the old segment immediately before the selected
  recurrence identity and creates a linked successor. ENTIRE_SERIES updates the
  series definition and only nonterminal affected occurrences. Completed/skipped/canceled records and explicit exceptions
  remain immutable under series edits. Pending affected generated records are
  canceled with history, rather than deleted or silently assigned new identities;
  unchanged identities are updated in place. Reject changes that would collide
  with a retained identity or rewrite a terminal occurrence.
- Catch-up is explicit and cursor-paginated, bounded per request, persisted and
  idempotent. Missed valid instances are PENDING. No timer, queue or worker is
  introduced before P1-10. Exclusion dates are series-local dates, returned as
  part of the definition; excluded candidates do not create Tasks.

## Alternatives and implications

Keeping occurrences only as non-Task records avoids per-occurrence Tasks, but
would require parallel completion/history/attachment contracts and later planner
integration. Reusing the master Task for all instances loses independent task
state. Distinct ordinary Tasks preserve the unified Task engine at the cost of
one Task per materialized occurrence.

Rejecting DST gaps at definition time cannot reject future gaps in an unbounded
series. Shifting gaps changes intended wall time. Explicit skipping and choosing
the earlier fold are deterministic and do not require two instances per key.

## Migration, testing and approval

Use additive TaskRecurrence/TaskOccurrence tables, scoped foreign keys, unique
keys and persisted policy columns. Preserve existing Tasks and migrations.
Test DST gaps/folds, midnight, leap years, month ends, exclusions, cursor retry,
concurrent generation, all edit scopes, history retention, task-state coupling
and cross-user denial. No approved infrastructure choice changes.

Owner approval: Explicitly approved for P1-02 in the current session after the
owner supplied the final mapping, DST, editing, catch-up and persistence policy.
