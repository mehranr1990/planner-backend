# 0075: Approved Client integration completion

Status: owner-authorized implementation, 2026-11-25, by the explicit request to
complete the remaining original Client requirements sequentially. This decision
does not authorize frontend changes, Platform Admin P4, deployment, server
configuration, commit or push. Baseline is Platform Admin P3 `29aed23`.

Reuse existing offers, verified recipient proofs, admission fences, SMTP, pg-boss
workers and recipient module/channel preferences. An offer remains an offer; no
delivery, feed read or automatic email claim grants membership. Recipient-only
metadata may include target/inviter display names and role. Resolution removes
the item from the pending feed, while read state is monotonic and independent of
the offer revision. Root email creation does not look up accounts. Mandatory
Company root-admission preconditions for child scopes remain unchanged; inviting
an email address to a child scope does not create Company membership.

Persist encrypted delivery proofs in the offer transaction and dispatch outside
the request. Recheck state, expiry, current issuer authority and recipient channel
settings. Missing/unverified accounts receive transactional email. Verified
accounts default to in-app delivery, with optional email and push subject to
existing global settings, server availability, quiet hours and separate messaging
push consent. No recipient preference or lookup result enters inviter responses.
Automatic Conversation/Meeting materialization preserves the original offer's
public state, revision, proof and expiry; explicit claims and revocations still
work. Push intents have typed offer/subscription/recipient references, bounded
retry, consent rechecks and conservative handling of uncertain network acceptance.

Company staff drafts use the existing staff-management authority and root member
identifiers. Capture a supervisor's exact membership generation, revalidate it at
acceptance and apply the profile in the admission transaction through the Company
owner's narrow callback. Use the existing batch audit/usage contract for the two
effects. Invalid/foreign/stale supervisors cannot create membership or a profile.

Habit category, icon, timeOfDay, preferredTime, unitLabel and reminder settings are
additive metadata. Canonical type/unit/purpose and historical schedule semantics
remain unchanged. The fixed icon identifiers and field bounds are documented in
the generated contracts. Labels accept user-language text. preferredTime and
timeOfDay describe the habit; the explicit reminder time drives delivery.

Habit reminders use the existing durable Personal notification scheduler and its
DST/quiet-hour/recovery rules. Use the effective habit schedule's timezone for
each attributed date. Rest, skipped, paused and archived dates do not notify;
ifNotDone additionally suppresses completed dates using canonical exact quantities.
Recheck at dispatch, preserve idempotency and manage these reminders through the
Habit resource. Account timezone edits do not rewrite habit history or schedules.

Choose the originally requested Asia/Tehran default for newly provisioned accounts.
Preserve existing UserSettings rows, including UTC, and existing signup bodies.
Users continue to change settings through the established account endpoint.

M113–M115 are additive; no existing migration bytes change. The eight new FK
edges cascade from Personal habits, typed offers, subscriptions or recipients,
or retain a same-Company supervisor snapshot only with its invitation. Existing
invitation cleanup precedes membership/interval deletion. Reconcile the retention
document against the confirmed 2026-11-20 owner records without changing policies.
