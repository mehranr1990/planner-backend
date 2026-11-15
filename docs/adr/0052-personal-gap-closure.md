# 0052: Personal gap closure

Status: Owner-approved scope in P1-GAP-CLOSURE request, 2026-11-15.
Recoverable Focus policy additionally approved explicitly in this session.

The request extends ADRs 0009, 0011, 0013 and 0018 additively.
Existing Focus sessions retain ADR 0013 behavior. Only explicit recoverable
sessions use acknowledged heartbeat evidence. Client event times must fall between
the previous persisted transition and receipt. Work after interruption caps at
the last server acknowledgement; recovery cannot fill the unknown gap. Heartbeats
and commands use revisions and existing idempotency receipts. The technical
liveness window is 60 seconds; send every 30 seconds. Terminalization reserves
the existing revision limit. Discard records no work. Normal finish/stop use the
existing unique tracked-entry pipeline. The frontend must use that pipeline for
recoverable sessions rather than also posting anonymous manual entries.

Routine schedules are optional with explicit local time and saved account zone;
daily, anchored weekly and selected weekdays use Gregorian local dates. End date
is inclusive. Gaps are visible without execution; folds use the earlier instant.
Stable routine/date identities permit one execution per scheduled day. Persisted
executions retain their original instant/zone across schedule edits. Archived
routines permit history reads but no new execution. Progress is computed from
current linked Habits' actual records and effective historical targets, with no
automatic Habit logging. Reminder opt-in uses existing LOCAL reminders and outbox,
not another scheduler. Replacing a schedule cancels its old pending reminder.

Working-hours configuration is account-owned, with explicit independent weekday
intervals and up to 366 explicit date overrides. Empty intervals mean nonworking;
null configuration means UNKNOWN. Splitting intervals represents breaks. No holiday
provider or assumed full-time week. Existing duration availability remains a legacy
contract: a working-hours write derives its nominal weekday minutes; a legacy
availability write clears interval configuration. The schedule capacity read uses
actual Calendar event/TimeBlock occurrences, interval union/intersection and UTC
day boundaries. It is advisory across separately authorized config/calendar
snapshots. Invalid local endpoints produce DST_GAP rather than invented capacity.

Deletion-policy reads expose only existing ADR 0023 policy metadata (seven-day
grace, maximum 30-day backup expiry) and fail closed if policy is unset. Existing
password/proof/retention/hold/closure controls remain authoritative. Inbox counts
use current inbox/read/dismiss predicates, matching the list including existing
snooze semantics. Counts reflect committed DB state at the query; a subsequent
mutation can change the next read. Scope is the authorized Personal space, with
optional same-space Reminder filtering. Other notice stores are not mixed in.

No export code or operational behavior, frontend code, deployment, Shared
activation or Phase 6 implementation is authorized by this decision.
