# P5-03 media, personal progress and notification contract

Authority: approved ADRs 0044–0047. Published P5-02 prerequisite:
`5a074703bc402b706916fb44d6360373768033cf`.

## Additive REST API

All operations use verified sessions, current accepted admission/source authority,
strict Zod validation, no-store and opaque IDs. The 711 published operations and
all frozen signatures retain their shapes. The new API contains 25 operations;
generated OpenAPI is authoritative.

Under `/api/v1/conversations/{id}`:

| Method     | Suffix                                                          | Result                                                             |
| ---------- | --------------------------------------------------------------- | ------------------------------------------------------------------ |
| POST       | /attachments                                                    | Initiate private FILE, IMAGE or VOICE upload                       |
| GET        | /attachments/{attachmentId}                                     | Authorized metadata/status                                         |
| POST       | /attachments/{attachmentId}/complete                            | Stream application/octet-stream; empty JSON retries READY metadata |
| POST       | /attachments/{attachmentId}/cancel                              | Conditional unlinked upload cancellation                           |
| POST       | /media-messages                                                 | Create actual media entry from 1–5 ready unlinked own uploads      |
| POST       | /media-forwards                                                 | Live reference with every source reauthorized                      |
| GET, PATCH | /media-messages/{messageId}                                     | Current rich projection; conditional author caption edit           |
| GET        | /media-messages/{messageId}/revisions                           | Authorized author's immutable prior captions                       |
| GET        | /media-messages/{messageId}/attachments/{attachmentId}/download | Authorized attachment stream                                       |
| GET        | /media-timeline, /media-changes, /media-search                  | Bounded signed-cursor polling/search                               |
| GET        | /media-threads/{messageId}                                      | Authorized root and replies                                        |
| GET        | /progress                                                       | Own admission's durable progress and sharing                       |
| POST       | /acknowledgements                                               | Explicit DELIVERED or READ acknowledgement                         |
| PATCH      | /receipt-settings                                               | Own sharing consent, initially off                                 |
| GET        | /messages/{messageId}/receipts                                  | Author-only mutually opted-in aggregate                            |
| GET, PATCH | /notification-settings                                          | Own admission's push routing and quiet override                    |

Under `/api/v1/messaging-notifications`: GET/PATCH `/settings`, GET inbox,
POST `/{noticeId}/read`, GET `/{noticeId}/deliveries`. Subscription create/list/
revoke remains the existing private Push API. Consent does not create subscriptions.

ASCII Idempotency-Key (1–128 characters) is required for new keyed creates,
acknowledgements, preferences and caption edits. Conditional mutations require
If-Match. Message/personal keys are admission-bound. Ordinary send ordering and
change cursors span text, forward and media entries; legacy endpoints retain
their text/forward schema, with no invented placeholder text. Rich projections
include actual attachments and authorized reactions, mentions and pin state.
Existing advanced actions apply the approved permission policy to media.

## File and voice security

Private SharedFiles/StoragePort provide safe names, type allowlists, actual
signature/content/size/hash validation and two-phase publication. Finalization
rechecks current source/admission after streaming. Download rechecks authority
after opening the private object and destroys the stream if access was revoked.
Bytes use attachment disposition, octet-stream, nosniff and no-store. IDs and
forward references grant no authority; every work-channel source additionally
requires file.read. Source-only data, filenames and captions disappear when any
forward hop is unavailable.

Images: PNG/JPEG. General files: existing PNG/JPEG/PDF/plain text. Voice: existing
canonical 16-bit PCM WAV, actual-byte-derived duration ≤120,000 ms and size
≤10,000,000 bytes, also respecting a lower configured limit. One recording per
voice message; no WebM/transcoder or live calls. Linked bytes remain under existing
retention blockers. Canceled/rejected/expired unlinked uploads use durable cleanup
markers, a safe stream deadline and bounded restartable reconciliation. This
validation is not antivirus or content moderation.

## Personal receipts and notifications

SENT means PostgreSQL commit. Polling, downloads and Push acceptance never infer
DELIVERED/READ. READ implies DELIVERED. Personal monotonic progress is generation-
bound, including Viewers. Only the current authorized author may inspect counts,
requiring both parties' sharing consent; no reader lists/times/presence. Current
history/source access is rechecked for each contribution. Closure erases private
progress/settings/keys, cancels notices; personal purge removes subscriptions
without deleting retained shared message bodies.

Chat push consent is separate and initially off. Existing global Web Push,
configured adapter and active owned subscriptions are additionally required.
Only future incoming message/explicit mention and valid own-invitation events
qualify. ALL/MENTIONS_ONLY/MUTED and recipient-timezone quiet intervals apply;
mention bypass is explicit and initially off. Reading a notice does not ack a
message. Re-enabling consent, global Push, routing or a subscription cannot replay
older work. In-app notice projections always recheck present authorization.
Equal timestamp boundaries fail closed; consent/routing cutoffs are rounded
above the persisted millisecond and subscription snapshots require earlier times.

MessageActivity is durable metadata in the same commit as each new message or
invitation. Existing pg-boss outbox startup/periodic maintenance drains bounded
work; PostgreSQL is authoritative. Each event/recipient and notice/subscription
is unique. Claim and final dispatch gates are distinct. Final dispatch rechecks
source/history, preference, own unread notice and subscription revision. External
network calls occur after commit and outside business locks.

Retries: at most five actual sends; 60/300/900/3600-second delays; seven-day missed
bound. 404/410 revoke subscriptions and clear secrets. Expired pre-network claims
recover; expired NETWORK markers and unknown acceptance become AMBIGUOUS with no
automatic resend. An in-flight send cannot be recalled; known actual results are
recorded and cancellation prevents retry. Browser display is not exactly-once.
Payloads contain generic application text and opaque IDs only. Provider failures
are reduced to safe codes. No bodies, captions, filenames, profiles, secrets or
membership lists enter payloads/jobs/audit.

P5-04 remains deferred. No WebSocket, presence, typing, frontend Service Worker,
deployment, Shared activation or later-batch behavior is added.
