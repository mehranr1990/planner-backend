# 0018: Reminder timing, delivery, recovery and privacy

Status: APPROVED by owner, 2026-10-29, for P1-10 implementation.

## Context

P1-10 activates reminders, inbox, configured email/Web Push and PostgreSQL jobs.
The specification requires deduplication, quiet hours, snooze, Task changes,
restart repair and bounded retries, but leaves several product/temporal choices
undefined. The owner explicitly requires an ADR for these decisions.

## Proposed bounded decision

- Add only Reminder, Notification, NotificationDelivery, NotificationPreference
  and PushSubscription. Notifications owns them. Reminder may stand alone or link
  one existing same-space actionable Task through a typed FK/public Task facade.
  No polymorphic/unvalidated target IDs, source writes, automatic Task completion,
  Finance/Journal links, escalating overdue automation or later-phase consumers.
- Reminder rules: ABSOLUTE UTC instant; LOCAL date/time in an IANA zone; or TASK
  relative to dueAt, plannedStartAt or scheduledDate plus explicit local time for
  date-only input, and an explicit signed elapsed-minute offset. Missing source
  dates block scheduling visibly. Optional standalone LOCAL recurrence supports
  daily, weekly, selected weekdays, monthly, yearly and day intervals with bounded
  end/count/exclusions, missing month-day and February 29 skipping. Task recurrence
  and occurrence identities/lifecycles remain unchanged.
- Save timezone mode FIXED or ACCOUNT (default ACCOUNT), actual IANA zone and
  intended local context. Account timezone changes reschedule only future pending
  ACCOUNT-mode work; FIXED and delivered history retain their context. Relative
  UTC Task instants stay UTC; quiet hours follow the selected reminder zone.
  DST gaps produce explicit SKIPPED/DST_GAP history without a send; scheduledAt
  may be null only for such noninstant gap records. Folds use the earlier instant.
  Local recurrence keys prevent travel/retry from sending an already delivered
  local occurrence again. Existing delivered/canceled history is retained.
- Definition lifecycle is ACTIVE, PAUSED or CANCELED with explicit reason and
  revisions; next scheduled work can be null when exhausted. Pause/cancel stops
  unsent work. Explicit resume schedules future work, not an unexpected backlog.
  Terminal/deleted/skipped/canceled/master Tasks cancel pending sends. Reopen or
  restoration reactivates only automatically canceled, still-future rules when
  reactivateOnReopen is enabled (default false). Manual cancellation never
  reactivates from a Task event. Re-check source eligibility at every send.
- Due-date/planned-date changes cancel obsolete unsent delivery identities and
  calculate replacement identities from current authoritative Task state. Sent
  history never moves. Reusing a canceled still-future identity may reactivate its
  logical pending record with revision/audit and retained cancellation metadata;
  delivered or ambiguous external identities never resend automatically.
- A logical channel delivery has unique (reminderId, scheduledAt, channel).
  Preserve original scheduledAt separately from notBefore (quiet hours/retry).
  Gap-only history has a separately unique local-key/rule-version/channel identity.
  NotificationDelivery may also contain typed per-subscription child rows with
  same-space parent/subscription FKs and unique parent/subscription identity; these
  are endpoint attempt state, not additional logical channel deliveries. This
  preserves the specified fingerprint while supporting bounded multi-device fanout
  without an unregistered entity or JSON endpoint state.
- Notification is unique per logical reminder/instant and contains private title,
  source and immutable intended context. IN_APP delivery publishes it transactionally
  once. External-only records remain available as owner history, excluded from the
  default inbox. Reads/unreads require revisions; read=true is acknowledgement and
  never changes a Task. Explicit dismissal retains history. No unapproved purge or
  retention duration: application notification/delivery history remains until the
  separately approved account data lifecycle handles it.
- Explicit snooze on an owned Notification schedules new future channel deliveries
  referencing the original notification/delivery, with If-Match and Idempotency-Key.
  It retains original history and never changes Task due/status. Reject collisions
  with an existing logical delivery rather than duplicate it. Dismissal/snooze are
  explicit child operations within the approved notification route family.
- Preferences default IN_APP on, EMAIL/WEB_PUSH off; all external delivery additionally
  requires an explicitly configured server adapter. Requested unavailable channels
  fail safely; execution re-checks current preferences/configuration. Quiet hours
  are optional local start/end, may cross midnight, cannot be an all-day equal
  interval, and defer nonurgent sends to the first valid quiet-end instant. Earlier
  fold/first-valid gap-end behavior is explicit; urgent reminders bypass quiet hours.
  Original intended time remains visible. No priority inference from private text.
- Missed active occurrences deliver late once within seven days of intended time;
  older ones become EXPIRED/MISSED history without an external send. Catch-up is
  bounded to 100 occurrences per reminder pass, 100 reminders/deliveries per sweep,
  with persisted cursors and repeated repair. No silent completion of source Tasks.
  Cap per-owner active reminders at 1000 and active push subscriptions at 20.
- Delivery states distinguish pending, processing, retry, delivered, skipped,
  canceled, expired, failed and ambiguous. Use database time and expiring leases;
  five total attempts with bounded exponential backoff (60s, 300s, 900s, 3600s).
  A stale pre-send lease is recoverable. A network-started external lease without
  durable acknowledgement is AMBIGUOUS and not automatically resent; this avoids
  pretending exactly-once SMTP/push delivery. Definite transient failures may retry;
  permanent failures stop. No duplicate in-app row from retries/repeated processing.
  SMTP Message-ID and push topic/tag remain deterministic, but are not claimed to
  guarantee external exactly-once acceptance/display after a crash.
- Cancellation/rescheduling is serialized with the final send authorization gate.
  If it commits first, no transport call occurs. A send already authorized/in flight
  cannot be recalled; retain the cancellation request and actual result, and do
  not retry it after cancellation. Provider calls never hold business locks open.
  Tests must cover both sides of this race and stale lease tokens.
- Web Push is explicit opt-in, bound to Personal Space rather than a login session;
  logout revokes API access but not an opted-in background subscription. Unsubscribe
  stops pending endpoint work. Reject non-HTTPS/private/unsupported endpoints and
  invalid keys, enforce a fixed browser push-provider host allowlist and bounded
  request time, and never follow redirects. 404/410 revokes the stale subscription.
  Revocation clears endpoint/key secrets while retaining safe identity metadata.
- Email/push contain generic application text and opaque stable IDs only, never
  reminder titles, Task titles, narratives, Finance/Journal/Mood text or amounts.
  API/in-app owner reads may show the private reminder label. Local/test sinks are
  explicit nonproduction adapters; no SMTP/push is activated just by installing it.
  No SMS. Audit/log/job payloads use safe IDs/codes, never endpoints, keys or content.
- Outbox dispatch is now active only for current Notification consumers: supported
  Task state/date events, account.timezone_changed and reminder.changed v1. Add
  notification-specific consumer progress/attempt metadata to existing OutboxEvent,
  retaining immutable events for future approved consumers. Commit consumer effects
  and progress together; duplicate/out-of-order events read current owner state.
  Optional delivery failure never rolls back an earlier Task/Finance transaction.
- pg-boss is durable dispatch, not the schedule authority. A separate worker process
  sweeps on startup and periodically through durable jobs, repairs missed dispatch,
  and revalidates owner/account/Task/preferences before effects. Jobs contain IDs
  only. Stored source/progress and unique effects bridge an enqueue/ack crash gap.
  Retry exhaustion is visible in owned delivery history and safe operator diagnostics.
  Production schema installation is separate, reviewed and never API startup work.

## Verification

Test all owner/filter/endpoint swaps; quiet midnight/DST/folds/gaps; Task date,
terminal/reopen/master behavior; recurrence gaps/exclusions/count and bounded late
catch-up; read/unread/dismiss/snooze; duplicate claims, retries, both cancellation
races, expired pre-send leases and ambiguous network recovery; multi-device fanout,
push endpoint revocation, logout/session behavior, outbox atomicity, worker/API
real restarts, no source mutation and every earlier contract/regression.

Infrastructure/schema/dependency details are separately proposed in ADR 0019.

Owner approval: Explicit approval of this proposal in the P1-10 session.
