# Client backend completion contract

All paths include `/api/v1`. Existing request bodies and routes remain supported.
Regenerate Client types from `docs/api/openapi.json` (also mirrored in
`docs/frontend-handoff/openapi.json`). No frontend code is changed by this work.

## Invitations

- `GET /invitation-notifications?kind=PROJECT|TEAM|COMPANY|CONVERSATION|MEETING|SOCIAL_GROUP&limit=25&after=<opaque cursor>`
  returns `{items,nextCursor}`. Each item has `invitationId`, `kind`, `targetId`,
  `targetDisplayName`, nullable `inviterDisplayName`, nullable `role`, `createdAt`,
  nullable `readAt`, `revision` and `expiresAt`. `kind` selects one feed; cursors
  remain bound to the recipient and that feed. Only current, authorized pending
  offers appear. Resolving, revoking, expiring or losing authority removes them.
- `POST /invitation-notifications/{kind}/{id}/read`, body `{}`, returns
  `{invitationId,readAt}`. This is recipient-only and does not change offer revision.
- `GET /social-group-invitations?limit=25&after=<cursor>` supplies the verified
  invitee's pending offers, with the same additive nested `notification` metadata
  as the other pending lists.
- `POST /social-group-invitations/{id}/proof`, body `{}`, requires `If-Match` and
  returns the existing `RecipientInvitationProofSchema`. It rotates earlier
  proofs and marks the notification read. Use its new revision and proof with the
  existing Social accept/decline routes (`X-Invitation-Proof`, `If-Match`).

Session verification, Origin checks and existing Shared rate limits apply. Feed
read operations do not grant admission. Social contact rules and Company/source
membership preconditions still apply. The ordinary pending lists remain available
even when IN_APP notifications are disabled; the notification feed honors IN_APP.

Existing `GET/PATCH /notifications/preferences` serves `moduleChannels`. Each
module contains IN_APP, EMAIL and WEB_PUSH. Global settings, server availability,
quiet hours and messaging push consent further restrict delivery. No preference
matrix replacement or directory endpoint is introduced. Missing settings keep
the prior defaults: in-app on; email and push off for new recipients.

Known verified recipients receive pending in-app offers without mandatory email.
Optional email follows preferences; unknown/unverified addresses receive the
transactional link. SMTP runs in the worker with bounded retries. Proofs remain
limited to the existing authorized delivery/proof boundaries and never enter logs
or unencrypted durable queue payloads. Private email links retain their existing
fragment proof. Stored delivery proofs are encrypted. Automatic
Conversation/Meeting claims never join the recipient and preserve the inviter's
public offer state/revision and existing explicit-claim/revoke behavior.

Existing Team/Company sent-invitation and resend APIs, Conversation email offers
and reviewed Shared/recovery error details are reused, not duplicated.

## Company staff fields

`POST /companies/{id}/contexts/{scopeId}/invitations` additionally accepts optional
`position` (trimmed text, 1–300 characters, or null) and `supervisorMemberId`
(root Company membership access UUID, or null). These require the existing staff
management authority. The server snapshots the supervisor generation and rechecks
it on acceptance. Acceptance creates the staff profile atomically with membership;
stale/foreign supervisors reject acceptance without partial admission. Existing
invitations without these fields keep their prior behavior.

## Habits

Existing `POST /habits`, `PATCH /habits/{id}`, `GET /habits` and
`GET /habits/{id}` support:

| Field           | Contract                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------- |
| `category`      | Optional trimmed Unicode text, 1–100 characters; null clears                                  |
| `unitLabel`     | Optional trimmed Unicode text, 1–100 characters; null clears                                  |
| `timeOfDay`     | ANYTIME (stored default), MORNING, AFTERNOON, EVENING                                         |
| `preferredTime` | Optional `HH:mm`; null clears; descriptive metadata                                           |
| `icon`          | DEFAULT (stored default), WATER, BOOK, EXERCISE, SLEEP, FOOD, MEDITATION, STUDY, WORK, HEALTH |
| `reminder`      | Optional `{time:"HH:mm",ifNotDone:true}`; null disables; ifNotDone defaults true              |

**Canonical `unit` is preserved.** COUNT/SECOND/ML and other existing Latin unit
codes still control exact calculations. A label such as `صفحه` or `لیوان` affects
display only. Type/unit/purpose remain immutable. Metadata edits use the normal
Habit revision check and do not rewrite schedule history.

Reminders use the effective stored habit timezone, due-date schedule and existing
notification delivery infrastructure. They honor Personal channel preferences and
quiet hours, suppress rest/skip/paused/archived dates, and additionally suppress a
completed date when ifNotDone is true. They recheck current state before delivery.
Manage the reminder through the Habit endpoint; its internal Reminder record is
not separately editable. The existing DST-gap/fold and missed-delivery behavior
applies. preferredTime does not implicitly create a reminder.

## Signup and retention

`POST /auth/sign-up/email` keeps its existing body. Newly provisioned accounts
start in `Asia/Tehran`; the existing `PATCH /me/settings` accepts another IANA
timezone. Existing UTC settings and all saved habit schedules are unchanged.

Retention documentation now reflects the confirmed records in
`docs/approvals/2026-11-20-owner-approval-records.md`: v2 Social and Company rules
exist; Company has seven-day recovery, zero additional class retention and PURGE,
subject to existing holds, obligations and ownership protections. This change
does not seed, activate, configure or deploy anything.

## Environment and delivery

No new environment flags. Reuse `INVITATION_ACCEPT_URL`, existing `MAIL_MODE`/SMTP
settings, `NOTIFICATION_EMAIL_ENABLED`, `PUSH_MODE` and VAPID/sink configuration.
The worker must be running for asynchronous email/materialization/push/reminders.
Apply reviewed M113–M115 only through the normal separately authorized deployment
workflow. Local tests use isolated PostgreSQL; no server configuration is changed.
