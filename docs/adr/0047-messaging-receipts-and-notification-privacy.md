# 0047: P5-03 receipt sharing and messaging notification privacy

Status: **APPROVED by the owner**, 2026-11-08.
The owner selected the recommended Decision 2 (separate messaging push opt-in)
and explicitly approved optional receipt sharing, initially off, for Decision 1.
P5-03 local implementation is authorized after verified P5-02 publication at
`5a074703bc402b706916fb44d6360373768033cf`. Both recommended decisions below are
approved. P5-04 remains deferred.

## Existing authority and the missing decisions

V3 feature registry 01 explicitly leaves read-receipt semantics open and requires
context privacy, mute, mention-only behavior and quiet hours. ADRs 0044–0046 fix
REST polling, accepted participation, current-join history, source permissions,
Viewer restrictions and live forwarding. None specifies whether another person
may see a recipient's delivery/read activity or how chat notification consent
relates to reminder consent.

ADRs 0018/0019 already approve private push subscriptions, generic payloads,
session-independent opt-in, provider validation, configured VAPID/web-push,
quiet-hour timing, bounded retries and ambiguous-send handling for notifications.
These mechanisms are reused; no new hosted provider or library is proposed.
Applying reminder opt-in automatically to new conversation events would be an
additional product decision, not merely adapter wiring.

## Decision 1: Personal progress and disclosure to message authors

**Approved:**

- SENT means the message committed to PostgreSQL. DELIVERED means the receiving
  client explicitly acknowledged receipt of the authorized message. READ means
  an explicit client acknowledgement that the user read it; READ implies
  DELIVERED. A push-provider acceptance, API polling request or download alone
  does not mark the message delivered/read. This does not prove human attention
  or successful download of every attachment.
- Current accepted participants, including source Viewers, may update their own
  personal acknowledgement progress. These are personal state updates, not
  shared-content writes. They cannot acknowledge for another participant or
  beyond their current authorized history. Updates are durable, monotonic and
  idempotent within the current conversation admission/source generation.
- Sharing delivery/read receipts is **off by default**, explicitly configurable
  by each participant for each conversation/admission. Personal progress remains
  available to that participant while sharing is off.
- Only the message's current authorized author can see aggregate delivered/read
  counts for that message, and only when both that author and each counted
  recipient enabled sharing. Never expose a reader list, individual receipt
  timestamps, last-seen state or general activity/presence. Other participants
  cannot inspect another author's recipient progress.
- Counts include only current eligible accepted recipients who can currently
  access that message, including every live forwarding source. Removed, closed,
  prejoin or stale-generation participants are excluded. The sender is excluded
  from recipient counts. Turning sharing off immediately removes future access
  to that person's receipt contribution.
- Leaving/rejoining starts new private progress and sharing-off consent; old
  acknowledgements/cursors cannot revive. Account closure/erasure prevents
  further disclosure. Private progress and preference audit stay owner-private;
  shared audit/outbox/feed must not disclose an opted-out user's read activity.

Alternative: retain the same authorization, aggregate-only and generation rules,
but turn receipt sharing on by default. This discloses activity without a new
per-conversation opt-in, including the effectively identifiable count in a DM.

## Decision 2: Messaging notification consent, events and quiet routing

**Approved:**

- Add a separate account-level **messaging Web Push opt-in, initially off**.
  Sending additionally requires the existing global WEB_PUSH preference, an
  active owned subscription and an explicitly configured server adapter. Existing
  reminder consent/subscriptions alone never silently enable chat pushes.
  New opt-in applies to future events, without replaying an old chat backlog.
- Eligible activity is a newly committed incoming text, media/voice or live-forward
  message, and a currently valid invitation addressed to that recipient. Explicit
  mentions select/filter the message notification; they do not create a duplicate
  push for the same message. No automatic push for edits, deletes, reactions,
  receipts, report activity or administrative changes in this batch.
- In-app notices follow the existing in-app preference (initially on). Only
  currently authorized recipients may list/count/read them. Pending invitees may
  receive only their own currently valid invitation notice, never message notices
  or conversation history before acceptance. New-message notices exclude the
  sender and retain the recipient's admission generation/history boundary.
- Each accepted participant may choose personal conversation push mode ALL
  (initial), MENTIONS_ONLY or MUTED. MENTIONS_ONLY means explicit mentions of that
  current admitted member; MUTED suppresses all conversation pushes, including
  mentions. These settings do not broaden permissions or erase authorized in-app
  history. Invitations use the recipient's account-level settings before admission.
- Reuse existing quiet-hour/DST behavior in the recipient's account timezone;
  a personal conversation override may replace the global quiet interval. Quiet
  hours defer nonurgent notices by default. An explicit, initially-off
  mentions-only-during-quiet option allows direct mentions through and defers
  other otherwise eligible notices until quiet-end. MUTED always takes priority.
  Do not infer urgency from message text or treat every mention as urgent.
- Muting, opt-out, unsubscribe, source/conversation revocation, stale admission,
  message deletion/hide or account closure stop pending eligible work at the final
  authorization gate. Re-enabling/unmuting never revives already canceled work.
  Source permission/history and subscription ownership are rechecked immediately
  before dispatch, including all live-forward sources. Reading/dismissing an
  in-app notice does not emit a message read receipt.
- External payloads contain generic application text and opaque stable IDs only:
  no body, caption, filename, voice data, preview, author profile or membership list.
  A click obtains current authenticated API authorization; the push grants none.
- Reuse ADR 0018's seven-day missed-delivery bound, five attempts with
  60/300/900/3600-second backoff, permanent failure stop, 404/410 subscription
  revocation/secret clearing and AMBIGUOUS outcome without automatic resend after
  uncertain network acceptance. A send that passed the final gate and is already
  in flight cannot be recalled; record its actual outcome and do not retry after
  cancellation. Do not claim exactly-once browser display or transport delivery.
- Logout retains an explicitly opted-in background subscription as already
  approved by ADR 0018; unsubscribe and account erasure revoke it. Jobs/audit/logs
  contain IDs/codes only, never subscription secrets or private content.

Alternative: use the existing global Web Push opt-in for messaging as well,
without a new separate messaging opt-in. All event, authorization, routing,
payload, quiet-hour and retry rules above would otherwise remain the same.

## Engineering work already authorized independently of these choices

Reuse private StoragePort/SharedFiles, safe filenames, size/hash/content checks,
two-phase upload with final admission/source recheck, authorized downloads,
revocation fencing and cleanup. Reuse existing PNG/JPEG/PDF/plain-text allowlists
and canonical PCM WAV validation from ADR 0015; add actual-byte-derived voice
duration validation, maximum 120 seconds and 10,000,000 bytes (also respecting any
lower configured limit). Do not trust a client-supplied duration. No transcoder,
public URL, new provider or frontend recorder is required.

Preserve all frozen P5-01/P5-02 shapes through additive media/receipt/notification
contracts; never encode media-only messages as invented placeholder text. Typed
source/file/admission links and the existing global lock order remain mandatory.
Retain linked content under existing disposal safeguards; temporary canceled or
rejected uploads use the established cleanup lifecycle. Exact lawful retention
periods and final P5-06 lifecycle policy are not decided here.

No production, Docker, Shared activation, P5-04 transport, frontend Service Worker,
meetings or later-batch implementation is authorized. P5-03 stays unstaged,
uncommitted and unpushed. Both privacy decisions are now closed; implementation
continues within the existing P5-03 authorization.
