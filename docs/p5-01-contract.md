# P5-01 Messaging Foundation contract

Authority: ADRs 0044 and 0045; owner-approved P5-01 only. Plain bounded text,
explicit invitation acceptance, private-group administration and current-join-only
history. Source Viewers read only; grant-only collaborators have no channel access.
Company association/attachment grants no Project/Team content permissions.

## Implementation boundary

Messaging owns conversations, participants, admission intervals, invitations and
messages. Independent DM/private conversations use typed CONVERSATION shared
custody; work channels use their exact existing source custody/scope and typed
Project/Team/Company FK. Custody is administrative and never grants conversation
content access. Private-group administrator departure may leave a read-only group
without transferring custody. Existing account-closure fences, retained opaque
actors and owner-exit freezing remain effective; P5-06 supplies final lifecycle
and recovery acceptance. No copied live profile is stored in messages.

Independent creation requires an explicitly configured retention policy whose
applicableContexts includes CONVERSATION. No default policy or duration is seeded.
Existing approved shared recovery invariants remain unchanged. Message disposal
is unavailable in P5-01. Source disposal must fail closed before destructive work
where conversation records require the later messaging-retention implementation.
No existing source without conversations is affected by that content guard.

All requests use verified sessions and existing account/identity/custody lock
order. Reads also recheck current state inside the fence. Every write records
metadata-only shared audit/outbox atomically. Membership restrictions use signed
control evidence. Restored source scopes invalidate old conversation admissions
through the existing restore generation; no permissive snapshot revival.

## Implemented REST operations

Base `/api/v1`; authenticated, no-store; trusted Origin for mutations. All UUIDs
opaque; strict Zod objects; standard errors. No message bodies in logs/audit/events.

| Method/path                                                | Behavior                                                        | Preconditions                                                          |
| ---------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| POST /conversations                                        | Create DM/private group/work channel with creator admitted      | Idempotency-Key; independent retention reference or source Owner/Admin |
| GET /conversations                                         | Bounded current authorized conversations                        | Signed cursor; current participant/source                              |
| GET /conversations/{id}                                    | Conversation metadata                                           | Current accepted participant/source                                    |
| GET /conversations/{id}/members                            | Bounded participants                                            | Current accepted participant/source                                    |
| POST /conversations/{id}/invitations                       | Offer named verified user admission                             | Administrator; If-Match; Idempotency-Key                               |
| POST /conversations/{id}/invitations/{invitationId}/revoke | Revoke a pending offer                                          | Current administrator; If-Match                                        |
| GET /conversation-invitations                              | Named recipient's bounded pending offers; no history            | Current recipient and eligible issuer/source                           |
| POST /conversation-invitations/{invitationId}/accept       | Explicit acceptance; new admission and history floor            | Named recipient; If-Match; current issuer/source                       |
| POST /conversation-invitations/{invitationId}/decline      | Decline own offer                                               | Named recipient; If-Match                                              |
| PATCH /conversations/{id}/members/{memberId}               | Grant/revoke private-group administrator                        | Current group administrator; If-Match                                  |
| POST /conversations/{id}/members/{memberId}/remove         | Remove accepted participant                                     | Current administrator; If-Match                                        |
| POST /conversations/{id}/leave                             | End own participation; final group admin leaves group read-only | Current participant; If-Match                                          |
| POST /conversations/{id}/messages                          | Persist ordered text                                            | Current sending authority; Idempotency-Key                             |
| GET /conversations/{id}/messages                           | Initial history or incremental ascending catch-up               | Current participant/source; signed cursor; limit <=100                 |

DM pair is fixed. No send before both accept. Private/work invitations expire
within seven days, with no automatic admission; issuer authority is rechecked on
acceptance. Rejoining is explicit and starts a new admission/history floor.
Message idempotency binds sender, conversation, key and normalized request;
message records retain lasting uniqueness. Replays require current admission and
visibility. Mismatched keys or IDs return safe conflict without another effect.

Per-conversation sequence allocation and message insert commit atomically under
the custody fence. Sequence is serialized as a decimal string. Initial retrieval
starts after the current join's history floor; subsequent requests use the last
returned committed sequence. Empty polling retains a usable cursor, hasMore is
explicit, and bounded pages never skip committed messages. Cursor signatures bind
actor, conversation, current admission, source generation and restore generation;
ordinary sends do not invalidate them. Never trust client sequence or timestamp.

Tests must cover the approved role matrix, outsiders/pending/grant-only/Viewer,
wrong nested source IDs, source revocation/rejoin, account/session closure,
concurrent revoke/send, duplicate/reordered retries, transaction rollback, cursor
tampering/cross-user reuse/empty polling and join-history isolation. Migration
evidence must preserve predecessor datasets, old checksums/FKs and prove rollback
and repeat deployment. Final gate: 13 stages plus compiled API/worker smoke.

No advanced messages, media/voice, delivery/read states, Push delivery, sockets,
meetings, social graph or final P5-06 cleanup implementation in this batch.

## Foundation traceability

All 14 operations are generated from `messagingOperations` in the API-contracts
package. `docs/api/openapi.json` is the generated artifact; no Swagger UI or JSON
HTTP route is registered by the existing bootstrap. There are 700 operations and
6,236 resolved local references, an additive delta of 14 operations. The frozen
P4-06 delta is derived from accepted commit `8ab53e6c5d6acb973c64f81ad27ccd4e01e25fe8`;
it adds 280 signatures without duplicating earlier frozen baselines.

| Requirement                               | Implementation                                                                        | Distinct verification                                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| P501-A explicit admission / fixed DM pair | Invitation, Member and Admission records; accept/decline/revoke APIs                  | DM consent/fixed pair, wrong recipient, expired/revoked offer and issuer-departure cases                                  |
| P501-B private/work authority             | Messaging policy plus Spaces-owned MessagingAuthority                                 | Private administrator delegation/departure; Project/Team/Company role matrix, grant-only, outsider and wrong-source cases |
| P501-C durable text/order/idempotency     | Conversation sequence and Message unique send/order keys                              | Concurrent duplicate sends/creation, rollback, changed payload/ID conflicts, current authority before replay              |
| P501-D initial/incremental retrieval      | Signed current-admission cursor and bounded ascending query                           | Empty poll reuse, page catch-up across later commits, join/rejoin floor, tamper/cross-user/cross-conversation rejection   |
| P501-E revocation/privacy                 | Existing account/session/custody fences, opaque actors and metadata-only audit/outbox | Source/conversation revocation winning first, send winning first, closed/session-erased user and attribution cases        |
| P501-F lifecycle preservation             | Existing owner-exit freeze; source disposal blocker before any file pass              | Source BLOCKED_POLICY retains content; restored source epoch rejects old admissions                                       |
| P501-G contracts/compatibility            | Strict Zod, controller pipes and generated operation registry                         | Contract bounds/unit cases, real HTTP Origin/IDOR/no-store/schema cases, frozen compatibility gates                       |
| P501-H additive persistence               | M040; five tables, 18 new FKs, two CHECK expansions                                   | Wrong author/source FK cases; canonical deploy/status/checksums; populated predecessor/rollback/repeat rehearsal          |

Text is plain text, at most 8,000 code units / 32,000 UTF-8 bytes. Pages contain
at most 100 records; initial named invitees at most 49; a conversation has at most
200 historical participant seats and 200 current pending offers. Existing scoped
collaboration request limits apply to HTTP requests. These are technical safety
bounds, independent of future commercial policy. Member commands use the returned
member revision; invite creation uses conversation revision; offer decisions use
invitation revision. Successful POSTs return 201; GET/PATCH return 200.
