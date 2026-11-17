# Messages & Meetings gap closure — frontend contract

Authority: [ADR 0056](../adr/0056-messages-meetings-gap-closure.md), ADRs 0044–0049
and the owner's P5-GAP-CLOSURE request. Backend-only implementation. All paths
below are relative to `/api/v1`. Import schemas from `@mehran/api-contracts`.
The canonical [OpenAPI](../api/openapi.json) is authoritative for wire shapes.

**P5-04 WebSocket/Presence/Typing is DEFERRED BY OWNER.** Use authenticated REST
polling. Do not build these deferred features from this handoff. Shared activation,
production deployment, retention-policy provisioning and external delivery are
separate operational gates.

## Common request and UI rules

Every operation requires a current verified Better Auth session cookie. Mutations
require the configured trusted `Origin` and JSON `Content-Type`, except existing
binary upload operations. All results are private, `Cache-Control: no-store`.
UUIDs are opaque and typed by their owning resource. Never substitute a user ID,
actor ID, context access ID, conversation member ID or meeting member ID.

In the operation tables, **R** means `If-Match: "<revision>"`, using the exact
resource revision identified below; **K** means `Idempotency-Key`, 1–128 printable
ASCII characters. Keep the same key/body/expected revision on a network retry;
use a new key for a new intent. A replay still rechecks current authority.
**E** means a strong ETag is returned (schedule GET returns none when null).
Other existing Meetings operations use JSON `revision`; construct a quoted
If-Match from it. No conditional GET/304 flow is introduced.

**P** means the existing `ConversationPageQuerySchema` / `MeetingPageQuerySchema`:
`limit` 1–100, default 50, opaque `cursor`, maximum 10,000 characters. New page
responses contain `items`, `nextCursor`, `hasMore`. Existing Conversation directory
pages have `items`/`nextCursor` only. Null cursor means stop. Preserve opaque cursors;
do not decode or share them across users/scopes. Refresh after cursor invalidation.

Render text as text, never trusted HTML. On 401 stop polling and sign in; on
inaccessible 404 discard resource caches; 403 means insufficient current authority.
400 covers invalid JSON/headers/UUIDs, `IF_MATCH_REQUIRED`,
`IDEMPOTENCY_KEY_REQUIRED` and `SCHEDULE_MUST_BE_FUTURE`. 409 covers
`REVISION_CONFLICT`, `IDEMPOTENCY_CONFLICT` and lifecycle conflicts. Some existing
endpoints return a generic conflict. Use the existing error envelope, never SQL
or guessed resource-existence messages. Honor 429/Retry-After; back off with jitter
and avoid overlapping requests. Unknown query fields fail validation.

## A. Channels: reuse Conversations

MB-1 needs no parallel channel API. `Conversation.id` is the channel ID when
`kind` is PROJECT, TEAM or COMPANY; `sourceId` identifies its exact source.
DM and PRIVATE_GROUP remain independent, not organizational channels.
`ConversationMember.id` is the channel membership reference; `actorId` is scoped
attribution. `generation`, `historyAfter`, `joinedAt`, `revision` describe current
admission. Scope `ContextAccess.id` is a separate source-membership reference.
Use `/access/me` for the current member reference/capabilities; never infer role
authority from UI names or `createdBy` fields.

| Method/path (existing)                                               | Request → response schema                                        | Headers/query        |
| -------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------- |
| POST `/conversations`                                                | ConversationCreateSchema → ConversationSchema                    | K, E                 |
| GET `/conversations`                                                 | — → ConversationSummaryPageSchema                                | P                    |
| GET `/conversations/{id}`                                            | — → ConversationSchema                                           | E                    |
| PATCH `/conversations/{id}`                                          | ConversationRenameSchema → ConversationSchema                    | R conversation, E    |
| GET `/conversations/{id}/access/me`                                  | — → ScopeAccessMeSchema                                          | —                    |
| GET `/conversations/{id}/members`                                    | — → ConversationMemberPageSchema                                 | P                    |
| GET `/conversations/{id}/invitations`                                | — → ConversationInvitationPageSchema                             | P; manager           |
| POST `/conversations/{id}/invitations`                               | ConversationInvitationInputSchema → ConversationInvitationSchema | R conversation, K, E |
| POST `/conversations/{id}/invitations/{invitationId}/revoke`         | ConversationEmptySchema → ConversationInvitationSchema           | R invitation, E      |
| GET `/conversation-invitations`                                      | — → ConversationInvitationPageSchema                             | P; own inbox         |
| POST `/conversation-invitations/{invitationId}/accept` or `/decline` | ConversationEmptySchema → ConversationInvitationSchema           | R invitation, E      |
| PATCH `/conversations/{id}/members/{memberId}`                       | ConversationRoleInputSchema → ConversationMemberSchema           | R target member, E   |
| POST `/conversations/{id}/members/{memberId}/remove`                 | ConversationEmptySchema → ConversationMemberSchema               | R target member, E   |
| POST `/conversations/{id}/leave`                                     | ConversationEmptySchema → ConversationMemberSchema               | R own member, E      |
| POST `/conversations/{id}/messages`                                  | ConversationMessageInputSchema → ConversationMessageSchema       | K                    |
| GET `/conversations/{id}/messages`                                   | — → ConversationMessagePageSchema                                | P                    |

Channel create/invite/remove requires exact-source Owner/Admin (Company
Owner/Org Admin). Source managers must explicitly join each channel to read it.
Private-group admins manage their group; the last admin's departure leaves it
read-only, without automatic promotion. Eligible users must explicitly accept.
Pending recipients see their invitation, not history. Source Viewers cannot send.
No new membership is granted in Project, Team or Company by accepting chat.

Admission/re-admission starts a join-only history floor and a new generation.
Source or conversation revocation immediately denies reads, polling, replay and
downloads. Evict caches on denial; do not treat an old cursor as durable access.
Empty accessible channel lists are valid. Removed channels may disappear without
an existence-revealing explanation. Existing independent custody closure/recovery
applies; this batch adds no archive endpoint.

Reuse rich-history `/conversations/{id}/history`, `/media-changes` and `/recovery`
contracts for full text/media/live-forward projections and restart catch-up, as
specified in [P5-06](../p5-06-contract.md). Preserve the initial recovery change
cursor through snapshot pages. Upsert stable message IDs/revisions and apply
tombstones. Existing media uploads, threads, revisions, reactions, pins, search,
author edit/delete windows and private downloads remain in their existing API
families. Never create a second message list, unread counter or receipt engine.

## B. Announcements

Reuse exact PROJECT/TEAM/COMPANY-root authority and publication-time audiences.
Source managers create drafts/publish/pin; recipients require the captured current
full source admission and restore generation. ALL captures all eligible full
members at publication, including Viewers. NAMED takes exact `accessId` and
`generation` pairs. No role audience, automatic child-scope access or new approval
workflow exists. Newly joined/rejoined members receive no old publication.

| Method/path                                                                | Request → response schema                                    | Headers/query                            |
| -------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------- |
| POST `/announcements` (existing)                                           | AnnouncementCreateSchema → AnnouncementSchema                | K                                        |
| GET `/announcements/{id}` (existing)                                       | — → AnnouncementSchema                                       | —                                        |
| GET `/announcements/scopes/{kind}/{scopeId}` (extended)                    | AnnouncementListQuerySchema → AnnouncementVersionPageSchema  | P; optional `order=ID` or `PINNED_FIRST` |
| POST `/announcements/{id}/versions` (existing)                             | AnnouncementVersionInputSchema → AnnouncementVersionSchema   | K                                        |
| GET `/announcements/{id}/versions` (existing)                              | — → AnnouncementVersionPageSchema                            | P                                        |
| GET `/announcements/{id}/versions/{versionId}` (extended)                  | — → AnnouncementVersionSchema                                | —                                        |
| POST `/announcements/{id}/versions/{versionId}/publish` (existing)         | AnnouncementPublishSchema → AnnouncementVersionSchema        | R version, K                             |
| POST `/announcements/{id}/versions/{versionId}/withdraw` (existing)        | MeetingEmptySchema → AnnouncementVersionSchema               | R version, K                             |
| PATCH `/announcements/{id}/versions/{versionId}/pin` (extended)            | AnnouncementPinSchema → AnnouncementVersionSchema            | R version, K                             |
| GET `/announcements/{id}/versions/{versionId}/schedule` (new)              | — → AnnouncementScheduleResultSchema                         | E; manager only                          |
| POST `/announcements/{id}/versions/{versionId}/schedule` (new)             | AnnouncementScheduleInputSchema → AnnouncementScheduleSchema | R version, K, E; manager only            |
| POST `/announcements/{id}/versions/{versionId}/schedule/cancel` (new)      | MeetingEmptySchema → AnnouncementScheduleSchema              | R version, K, E; manager only            |
| POST `/announcements/{id}/versions/{versionId}/acknowledge` (existing)     | MeetingEmptySchema → AnnouncementAcknowledgementSchema       | explicit, idempotent                     |
| GET `/announcements/{id}/versions/{versionId}/acknowledgements` (existing) | — → AnnouncementAcknowledgementSummarySchema                 | manager only                             |

Flow: create resource → create immutable draft version → publish immediately or
schedule. Schedule body is `{scheduledAt, timezone, audience}`. `scheduledAt` must
be a future UTC instant ending in Z; `timezone` is an IANA identifier, used for
display of that instant. Resolve local DST ambiguity explicitly in the client;
the backend does not silently reinterpret a local wall time. `audience` is the
existing `{audience:"ALL"}` or `{audience:"NAMED",members:[{accessId,generation}]}`.
Invalid/unavailable named members fail without broadening the selection.

Version states stay DRAFT/PUBLISHED/WITHDRAWN for backward compatibility. The
separate schedule returns SCHEDULED/CANCELED/PUBLISHED, its revision, due instant,
zone, audience and publishedAt; GET returns null before scheduling. Scheduling,
rescheduling and cancellation advance the version revision. Use the returned
revision for the next conditional mutation. Never infer scheduled status from
DRAFT alone. Canceled schedules leave an unpublished draft; a later explicit
immediate publication may publish that draft independently of its canceled schedule.

The existing pg-boss maintenance callback sweeps persisted due rows at startup and
on subsequent work. Publishing rechecks the original scheduling manager's exact
admission, current authority/account/custody/restore generation, the captured version
revision and attachments. NAMED also rechecks every selected member generation;
ALL snapshots then-current eligible members. Invalid authority/audience leaves
the draft unpublished and the schedule visible to current managers for correction.
No automatic audience fallback or authority replacement. A new authorized
schedule explicitly replaces the old intent. Publication and existing metadata-only
audit/outbox effects commit atomically; competing workers/retries cannot publish
twice. No new external Push event or delivery metric is introduced.

Pin/unpin changes `pinned` and optional nullable `pinnedAt`. Legacy pins have unknown
time (null); no timestamp is invented. An existing pin retains its original known
time; unpin clears it. Source audit retains actor attribution. Pinned-first ordering
is global across pages with ID tie-breaking, and remains audience-filtered. Refresh
the ordered list after a visible version or pin change invalidates its cursor.
Default ID ordering and old cursor semantics remain unchanged.

Acknowledgement remains optional and explicit. Managers receive eligible/acknowledged
aggregate counts only, recipients their own acknowledgement only. Fetch/download
never acknowledges. Existing reminder inbox APIs are reused; no body, filename,
attendee list or unrecorded delivery/read evidence is fabricated.

## C. Messaging privacy

MB-3 reuses the approved settings; no new default or organization override model.
Receipt sharing starts off per conversation admission. Both message author and
recipient must opt in for author-only aggregate counts; never show reader lists,
timestamps, presence or last-seen. Internal personal progress remains monotonic.
Rejoining starts fresh sharing-off consent. The most restrictive current source,
conversation, contact block, mute, consent and subscription rule wins.

| Method/path (existing)                                  | Request → response schema                                      | Headers/query                   |
| ------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------- |
| GET `/conversations/{id}/progress`                      | — → MessageProgressSchema                                      | —                               |
| PATCH `/conversations/{id}/receipt-settings`            | MessageReceiptSettingsInputSchema → MessageProgressSchema      | R progress, K                   |
| POST `/conversations/{id}/acknowledgements`             | MessageAcknowledgeSchema → MessageProgressSchema               | K                               |
| GET `/conversations/{id}/messages/{messageId}/receipts` | — → MessageReceiptSummarySchema                                | authorized author only          |
| GET `/conversations/{id}/notification-settings`         | — → MessageNoticeSettingsSchema                                | —                               |
| PATCH `/conversations/{id}/notification-settings`       | MessageNoticeSettingsInputSchema → MessageNoticeSettingsSchema | R preference, K                 |
| GET `/messaging-notifications/settings`                 | — → MessagingPushSettingsSchema                                | own account                     |
| PATCH `/messaging-notifications/settings`               | MessagingPushConsentSchema → MessagingPushSettingsSchema       | R settings, K                   |
| GET `/conversations/{id}/contact-block`                 | — → DmContactBlockSchema                                       | E; known DM/pending invitee     |
| GET `/messaging/blocks`                                 | — → DmContactPageSchema                                        | P; own list                     |
| POST `/messaging/blocks`                                | DmContactInputSchema → DmContactBlockSchema                    | R, K, E; owned known pair/block |

Settings screen: use a receipt toggle; ALL/MENTIONS_ONLY/MUTED selector; optional
paired HH:mm quietStart/quietEnd (both null inherits global quiet hours);
mentionQuiet toggle initially off; separate account messaging Push toggle initially
off. Global Web Push opt-in, a current owned subscription and a configured adapter
are additionally required; serverAvailable/globalWebPush report those effective
conditions. Do not present a toggle that promises provider readiness.

Explicit invitation consent and private pair blocking already control initiation;
there is no newly approved "everybody/contacts/nobody" or group auto-admission
setting. A block prevents new DM contact in either direction, preserves authorized
old history and common-group messages, and suppresses direct pair mentions/Push.
Unblocking revives no canceled delivery, old invitation or receipt consent.
Notification previews are always generic; no content-preview opt-in is supported.
Users cannot weaken source authorization through personal settings. Only own
settings are readable; do not build another person's privacy inspector.

## D. Personal meeting invitees

An independent Meeting is the Personal/shared meeting model. It has separate
MEETING custody and a single Calendar event; it grants no Personal Space access.
Invite a verified active user whose explicit account UUID is already known, or
an existing authorized roster actor through the established actor-ID alternative.
No public user search, arbitrary email-to-account lookup or new contact service.

| Method/path                                                        | Request → response schema                           | Headers/query                    |
| ------------------------------------------------------------------ | --------------------------------------------------- | -------------------------------- |
| POST `/meetings` (existing)                                        | MeetingCreateSchema → MeetingSchema                 | K                                |
| GET `/meetings` (existing)                                         | — → MeetingPageSchema                               | P; admitted caller               |
| GET `/meetings/invitations` (existing)                             | — → MeetingInvitationPageSchema                     | P; own invitation inbox          |
| GET `/meetings/{id}` (existing)                                    | — → MeetingSchema                                   | admitted caller                  |
| PATCH `/meetings/{id}` (existing)                                  | MeetingPatchSchema → MeetingSchema                  | R meeting, K; organizer          |
| POST `/meetings/{id}/invitations` (existing)                       | MeetingInviteInputSchema → MeetingInvitationSchema  | R meeting, K; organizer          |
| GET `/meetings/{id}/invitations` (new)                             | — → OrganizerInvitationPageSchema                   | P; current organizer only        |
| POST `/meetings/invitations/{invitationId}/respond` (existing)     | MeetingRsvpSchema → MeetingInvitationSchema         | R invitation, K; named recipient |
| POST `/meetings/{id}/invitations/{invitationId}/revoke` (existing) | MeetingEmptySchema → MeetingInvitationRevokedSchema | R invitation, K; organizer       |
| GET `/meetings/{id}/members` (existing)                            | — → MeetingMemberPageSchema                         | P; admitted caller               |
| POST `/meetings/{id}/members/{memberId}/remove` (existing)         | MeetingEmptySchema → MeetingRemovedSchema           | R member, K; organizer           |
| POST `/meetings/{id}/leave` (existing)                             | MeetingEmptySchema → MeetingLeftSchema              | R own member, K                  |

Create INDEPENDENT with an approved retentionPolicyVersion and participant account
IDs, or add explicit invitations later. Recipient inbox is the existing invitation
notification/discovery channel. Pending invitees see title, schedule/timezone and
their invitation only. They do not see external URL, other attendee identities,
agenda, private notes, minutes/files or unrelated Personal Calendar content.
ACCEPTED and TENTATIVE admit; DECLINED does not. The shared RSVP spelling is
TENTATIVE, not MAYBE. Current accepted invitees may change to TENTATIVE/DECLINED.
After departure/revocation, fresh admission requires a new valid invitation.

Organizer ledger includes pending, declined, revoked and expired invitations,
plus recipientActorId and nullable acceptedMemberId; do not substitute either for
the invitation ID. Pages retain individual invitation rows rather than fabricated
history events. Existing audit/admission history records changes to each invitation.
It is not an attendee directory for recipients. Participant list contains current
eligible admitted members only. Count loaded ledger responses as loaded counts;
do not present them as a complete response summary until all pages are loaded.

Invitations expire after the established seven days. Invalid issuer/source/restore
authority, cancellation, closure and account deletion fail closed. Rescheduling
updates the same Calendar event and authorized invitation summaries; it does not
send duplicate invitations. Independent creation does not support recurring series
(recurrence is omitted by MeetingCreateSchema). Keep existing legacy Team Calendar
recurrence rules; this batch adds no occurrence/series invitation state machine.
Organizer departure never silently promotes another participant.

## E. Advanced agenda

Reuse `POST /meetings/{id}/agenda` (MeetingAgendaCreateSchema → MeetingAgendaSchema,
K) to create the stable entry and `PATCH /meetings/{id}/agenda/{entryId}`
(MeetingAgendaSelectSchema → MeetingAgendaSchema, R entry, K) for organizer
ACCEPTED/REJECTED selection. `GET /meetings/{id}/agenda` returns
MeetingAgendaPageSchema with P. Existing UUID ordering is unchanged; no reorder
endpoint or independent ordering engine is introduced.

| Method/path (new)                               | Request → response schema                    | Headers/query |
| ----------------------------------------------- | -------------------------------------------- | ------------- |
| GET `/meetings/{id}/agenda/{entryId}/details`   | — → AgendaDetailSchema                       | E             |
| PATCH `/meetings/{id}/agenda/{entryId}/details` | AgendaDetailPatchSchema → AgendaDetailSchema | R entry, K, E |
| GET `/meetings/{id}/agenda/{entryId}/history`   | — → AgendaHistorySchema                      | P             |
| GET `/meetings/{id}/agenda-summary`             | — → AgendaSummarySchema                      | —             |

Create the entry, then conditionally set details. Patch accepts any nonempty
subset of `plannedMinutes`, `completed`, `notes`. Minutes are null or a positive
integer up to 2,147,483,647; no extra product duration cap is configured. Null means
unspecified, not zero or inferred duration. Notes are plain text up to 10,000
characters without NUL; empty text clears them. Render safely. No note attachments
or implicit minutes/action-item conversions are added.

Only organizers manage duration/completion. Current admitted non-Viewer writers
contribute notes on accepted items, or their own proposals; organizers can manage
other proposals. Rejected entries return AGENDA_REJECTED. Outsiders/pending/revoked
invitees cannot read details/history. Legacy entries show null duration, pending,
empty notes and null update attribution, without manufactured history.

Details share the entry revision with its existing selection operation. Refresh
both after any mutation; on 409 retain unsaved local text, fetch current state and
let the user reconcile. Completion records server time, while immutable revision
rows record actor membership and timestamp. Unchecking clears current completedAt;
history preserves the previous completion. It never completes a Task, Action Item
or Meeting. History IDs are revision-row IDs; entryId is the stable agenda ID.
History pages use opaque stable cursors; use revision numbers when rendering order.

Summary totals explicitly entered durations on ACCEPTED entries only. Timed events
return elapsed meetingMinutes; all-day events return null. exceedsMeetingLength
is advisory, never rejection or automatic Calendar resizing. Edits to new details
return AGENDA_LOCKED while any IN_REVIEW/APPROVED/FINAL minute version exists;
canceled meetings return MEETING_CANCELED. Do not silently reopen finalized work.
Existing immutable minutes/decisions and Task action-item release rules remain.

Frontend changes: connect the current Channels/member picker to canonical member
IDs; add announcement schedule/timezone and pin controls; wire the existing Messages
privacy controls to the existing preference APIs; add organizer/recipient invitee
states in the meeting editor; add duration, completion, shared-note conflict/history
and advisory controls in the agenda panel. Preserve offline unsaved text locally
only under existing privacy rules. No frontend files were changed by this batch.
