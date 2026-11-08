# P5-02 advanced messaging contract

Authority: owner-approved ADR 0046, ADRs 0044/0045 and the V3 messaging/delete
policy. Local implementation follows published P5-01 commit
`dd73a901b1ed55d5a44d5fda225b798143003166`.

## HTTP additions

All routes below are under `/api/v1/conversations/{id}` and use verified sessions,
the existing messaging request guard, no-store responses, strict Zod inputs and
current accepted conversation/source authorization. Published P5-01 request and
response schemas are unchanged; 196 additional frozen signatures protect its 14
operations alongside all earlier snapshots.

| Method | Suffix                                   | Behavior                                                 |
| ------ | ---------------------------------------- | -------------------------------------------------------- |
| POST   | `/advanced-actions`                      | One typed command and metadata-only receipt              |
| GET    | `/timeline`                              | Bounded detailed history and initial change cursor       |
| GET    | `/message-changes`                       | Durable ordered incremental changes                      |
| GET    | `/message-details/{messageId}`           | Current authorized message projection                    |
| GET    | `/threads/{messageId}`                   | Root/replies inside the reader's history window          |
| GET    | `/message-search`                        | Literal case-insensitive authorized search; `q` required |
| GET    | `/pins`                                  | Current pin projections                                  |
| GET    | `/mentions`                              | Mentions of this member's current admission generation   |
| GET    | `/message-reports`                       | Own receipts, or authorized scoped moderation cases      |
| GET    | `/message-details/{messageId}/revisions` | Visible current author's previous text revisions         |
| GET    | `/message-policy`                        | Current work author-delete policy; initially disabled    |

Commands are `compose`, `forward`, `edit`, `delete`, `hide`, `reaction`, `pin`,
`report`, `resolve-report`, `moderate`, `policy`. See generated OpenAPI for each
strict input variant. Every command requires an ASCII Idempotency-Key of 1–128
characters. Keys are scoped to conversation/member/admission generation;
different payload reuse returns 409. Receipts store no message body. A replay
returns the original resource ID with a null revision; fetch current details
before a further conditional mutation.

Edit, delete, pin, moderation, report resolution and policy publication require
`If-Match: "<revision>"`. Use the detailed message revision, report revision or
policy revision respectively. Reaction changes advance the message revision;
personal hide does not. Missing revision is 400; stale revision is 409.

## Participation, author actions and moderation

Source authority, accepted participation, source/rejoin generations, current
history floor, account/identity and custody fencing apply to every operation.
Source administrators receive no automatic conversation content membership.
Current grant-only access is insufficient. Viewers may read, hide personally and
report; shared mutations remain forbidden. Private groups without a current
administrator and incomplete DMs remain read-only for ordinary participation.

Authors may edit visible text through the inclusive database-createdAt +48h
boundary. DM/private-group author delete-for-everyone uses the same window.
Work author deletion additionally requires a current policy explicitly published
by an accepted source Owner/Admin (Company Owner/Org Admin). Policies are immutable
versions, initially denied; they never extend 48h. Forward references may be
author-deleted under the same rules but cannot be edited into copied text.
Delete-for-self remains available after the author window and in read-only
conversations. It hides the message for that stable conversation member and does
not remove other readers' content.

Either accepted ordinary DM peer can pin. Private-group pins/moderation require a
current conversation administrator. Work pins/moderation require the exact source
Owner/Admin or Company Owner/Org Admin, also accepted in that conversation and
within their own current history. Administrative removal is a separate audited
logical redaction, with a retained reason, and is not bounded by the author window.
It grants no prejoin, legal-hold, physical-purge or retained-revision exception.

Reports retain a message reference and the reporter's supplied reason; no body is
automatically copied. Private/work moderators can resolve eligible cases with a
reason and optimistic revision. DM reports remain private submissions/receipts;
neither peer reviews the other's reports or moderates the other's content. External
DM triage requires the separately approved case-bound reviewer capability.

## Replies, mentions, reactions and live forwards

Compose optionally links a currently readable same-conversation reply and its
thread root. Explicit mentions name current accepted members, validated against
their live source/admission; no notification delivery is performed. Reactions
accept exactly one Unicode RGI emoji grapheme, including skin-tone, ZWJ and flag
sequences. Explicit active true/false avoids retry-sensitive toggles; at most 100
distinct emoji values per message bounds aggregates. Pages contain at most 100
records. These are technical safety bounds, not paid plan limits.

Forwarding stores a typed live reference to an existing message entry, including
forward chains up to eight references. The sender must currently read every
source hop and write the target. Every viewer, search, detail and polling
projection rechecks accepted participation, current source permissions and
current-join history at every hop. Target-only readers receive UNAVAILABLE with
null content and no source IDs/body/original source member. Current source edits
appear live; source deletion, personal hide, revoked admission, source account
closure or inaccessible intermediate references suppress content. No copied body
or historical profile is persisted at the destination.

All participating account/custody roots are predeclared and locked in the existing
global order. Discovery bounds a connected forward dependency graph to 32 other
conversations; overflow is 413. Source relocation or a changed dependency set
during lock acquisition returns retryable 409. Preliminary locator admission
checks do not replace the final transaction's authorization.

## Polling, search and compatibility

Detailed states are VISIBLE, DELETED, HIDDEN and UNAVAILABLE. All nonvisible states
have null content and suppress reactions, mentions and pin metadata. Old text
history and old send replays filter hidden/deleted bodies. Legacy APIs contain
only TEXT messages; forward entries may create gaps in their increasing sequence.
Existing clients need the advanced feed to remove previously cached content.

Advanced timeline/pins/mentions/thread/search APIs scan bounded creation-order
windows and advance a signed cursor over the scanned window. Filtering can return
an empty page with hasMore true; continue until hasMore false. Search compares
current authorized literal text without a separately retained search index.

Timeline returns a changeCursor sampled under the same transaction fence. Poll
message-changes from that cursor. The separate monotonic change sequence retains
metadata for CREATE, EDIT, DELETE, HIDE, REACTION and PIN. HIDE is delivered only to
that member. Every event projects the current state: a delayed CREATE/EDIT cannot
replay a subsequently deleted body. Advance to nextCursor, including empty polls.

Cursors bind user, endpoint/filter, current member/source/history/restore epochs
and an opaque external-source dependency digest. A source content/access change
invalidates dependent forward cursors with 409 CURSOR_AUTHORITY_CHANGED: clear
cached projections and resnapshot. Same-conversation source changes arrive in its
own feed; clients must refresh dependent forwards (including chains) when source
IDs change. Reauthorize/resnapshot before displaying cached content after any
403/404 or integrity failure. Cursors confer no authority and store no text.
Ordinary target/sibling-channel writes do not invalidate unchanged source epochs.

## Persistence, retention and operational boundary

M041 adds eleven typed tables: MessageEntry, MessageRevision, MessageHidden,
MessageReaction, MessageMention, MessagePin, MessageReport, MessagePolicy,
MessageMutation, MessageChange and MessageModeration; two Conversation counters
and one additive legacy identity unique key. Metadata-only TEXT headers/change
records are backfilled. A trigger maintains them atomically for existing writers.
Text bodies and all published constraints remain unchanged. SQL FKs enforce
same-conversation replies/threads/members and typed source/admission references.
Revision/policy/receipt/change/moderation histories reject update/delete.

Message text stays out of shared audit/outbox envelopes and receipts. Retained
previous text is exposed only to its current authorized author while the message
is ordinarily visible; deletion/hide/source loss closes that API. No purge duration
or retention default is seeded. Existing conversation/source disposal blockers
remain before destructive cleanup, including all new dependent history. Account
closure/erasure remains fail closed; final messaging lifecycle work is P5-06.

No new dependency, hosted service, WebSocket, typing/presence, Push delivery,
media/voice, meeting or production activation is introduced. P5-04 is deferred.
