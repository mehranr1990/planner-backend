# 0013: Focus timers, Pomodoro intervals and time accounting

Status: APPROVED by owner, 2026-10-28, for P1-07 implementation.

## Context

P1-07 requires authoritative elapsed time, start/pause/resume history, Pomodoro
break exclusion, restart recovery, actual work entries and Task productivity
properties. It does not define interval advancement, stopping versus finishing,
entry generation or summary denominators. PROJECT_INSTRUCTIONS.md sections 1.6
and 9 require approval of these temporal decisions before implementation.

## Approved decision

- FocusSession has STOPWATCH or POMODORO mode, saved IANA timezone, optional
  existing same-space Task and IDLE/RUNNING/PAUSED/FINISHED/ABANDONED lifecycle.
  New Task references require source revision and an actionable ordinary Task.
  References survive later completion/deletion/skip/master conversion; existing
  sessions remain pausable, resumable and terminalizable without changing Tasks.
  Only IDLE session metadata/configuration/link may be edited.
- One RUNNING or PAUSED session reserves the user's timer. Enforce this through
  a database partial unique index and scoped transactional serialization, including
  different API processes. IDLE and terminal sessions do not reserve it.
- Pomodoro configuration is explicit integer workMinutes (1-180), shortBreakMinutes
  (1-60), longBreakMinutes (1-120), longBreakEvery (1-16) and workIntervals (1-16).
  Defaults are 25/5/15/4/4. Insert a short/long break between work intervals;
  choose long break after every longBreakEvery work intervals; no trailing break.
  Derive advancement deterministically from accumulated active milliseconds.
  No automatic completion, worker, alarm or notification is introduced.
- The server uses PostgreSQL clock instants for timer transitions. Clients cannot
  submit elapsed durations or transition timestamps. Persist typed transition
  revision rows inside FocusSession (stable logical UUID, row UUID, predecessor,
  action, timestamp, accumulated active milliseconds and runningSince). Earlier
  timestamps/configuration/state remain unchanged; only the former current marker
  is closed. Bound a session to 1000 revisions, reserving terminalization at the
  bound so it cannot strand an active timer.
- Pauses stop accumulation. Closing the client or restarting the API does not
  pause a RUNNING session; elapsed UTC time continues. Pomodoro accrual caps at
  its finite schedule end, returns READY_TO_FINISH and continues reserving the
  timer until explicit finish/stop. STOPWATCH accrues until explicit pause/terminal
  action. Use integer milliseconds; protect each clock comparison with max(0,
  elapsed), never move the stored transition timestamp backwards, and expose
  clockAdjusted when the authoritative clock regresses. No claim of recovering
  unknowable elapsed real time from a misconfigured server clock.
- start is IDLE->RUNNING; pause RUNNING->PAUSED; resume PAUSED->RUNNING when work
  remains; finish makes FINISHED (STOPWATCH at any point, POMODORO only after its
  configured work/break schedule is exhausted). stop makes ABANDONED from IDLE,
  RUNNING or PAUSED and retains actual earned work. FINISHED/ABANDONED are terminal;
  pause after finish fails. Require If-Match and Idempotency-Key for transitions;
  duplicate requests replay their original result, stale conflicting requests fail.
- On finish/stop, atomically create immutable TRACKED TimeEntry rows for the
  actual contiguous WORK portions of running spans, excluding pauses/breaks.
  Unique (session root UUID, segment ordinal) prevents duplicate accounting.
  Zero-duration portions produce no TimeEntry. Keep session history and entries
  linked by scoped FKs; never also add session totals to TimeEntry-based totals.
- Manual TimeEntry accepts explicit UTC startAt/endAt, optional Task and note,
  captures a saved timezone and derives duration from instants (positive, <=7 days,
  not future). Revisions within TimeEntry preserve corrections/void history with
  stable logical UUIDs and typed immutable values. TRACKED entries cannot be edited
  or voided independently of their authoritative session history. No separate
  TimeEntryHistory or FocusSessionEvent entity is introduced.
- Overlapping manual entries remain explicit user records. Summary exposes raw
  recorded milliseconds, distinct work milliseconds (union of clipped TimeEntry
  intervals), overlap milliseconds and per-source totals; these totals are not
  asserted to be additive when overlaps exist. Only current nonvoid entries count.
  Running/paused live work is returned separately as uncommitted work, not mixed
  into recorded totals. Summaries use explicit [from,to) local date ranges and
  view timezone, max366 dates and 10000 relevant rows; reject overly dense queries
  instead of returning incomplete totals. Clip intervals at local day boundaries
  and report counts/definitions, with no P1-11 insight/reward/dashboard features.
- Add nullable estimatedMinutes (0-10080), important and urgent to existing Task,
  owned only by Tasks via /tasks/{id}/productivity GET/PATCH. Unknown flags yield
  UNCLASSIFIED; otherwise use DO/SCHEDULE/DELEGATE/ELIMINATE for the four explicit
  important/urgent combinations. No due-date/priority inference or delegation
  functionality. This endpoint uses the Task revision, safe changed-key audit and
  task.updated outbox; do not change prior Task response/history contracts or the
  existing TaskChange constraint. Existing TaskChange history is preserved; these
  new properties have metadata audit evidence rather than mislabeling old history
  fields. Recurrence/template application does not silently copy these new flags
  or estimates. Productivity summary obtains current actionable Task counts and
  explicit estimate totals through a scoped Tasks public read facade.
- Use existing personal ownership, scoped FKs, revisions, 24-hour actor/space/body
  receipts and atomic metadata audit. No new domain event names are needed without
  a current consumer; durable external effects remain behind existing outbox
  conventions. No Task/Goal completion, ownership, dates or estimates are inferred
  from a timer; no cross-module raw ORM writes. Preserve planning capacity policy.

## Alternatives, migration and verification

Automatic background Pomodoro transitions require an unnecessary worker and
additional product policy. Explicit finish with deterministic derived phases gives
restart recovery without dispatching jobs. Overwriting session/entry history loses
evidence; typed revisions use only the approved two new entities. Dedicated Task
productivity routes avoid breaking earlier Task and history response contracts.

Use additive migrations for FocusSession, TimeEntry and nullable Task properties;
preserve all prior migration bytes and Better Auth schema. Test lifecycle/interval
boundaries, pause/break exclusion, concurrent timers, replay/stale writes, clock
regression, client/API downtime, entry correction/overlap, DST/midnight/travel,
private Task links, exact summaries, existing regressions and compiled restart
persistence. No dependencies, workers, future modules or destructive migrations.

Owner approval: Explicit approval of this proposal in the P1-07 session.

Implementation note: the existing account-only audit changedFields constraint stays
unchanged. A forward-only additive migration provides a separate typed
productivityFields array on SecurityAuditEvent for the approved Task changed-key
audit. This changes no product, ownership or temporal semantics.
