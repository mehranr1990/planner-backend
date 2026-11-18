# Social Group chat and Group ledger actor IDs (ADR 0067)

## Group ledger actor IDs (D3)

Group expense create/revise: send `payerActorId` and `shares[].actorId` (the `actorId` from
`GET /social-groups/{id}/memberships`) instead of `payerUserId`/`shares[].userId`. Settlements:
`payeeActorId` instead of `payeeUserId`. Exactly one form per reference. Activity ledgers keep
user IDs (actor IDs return `422 ACTOR_REFERENCE_UNSUPPORTED`). Responses add nullable
`payerActorId`, `shares[].actorId`, balance `actorId`, settlement `payerActorId`/`payeeActorId`
(null on Activity ledgers). Ineligible/unknown/other-Group actor → `422 PARTICIPANT_INELIGIBLE`.
Amounts stay exact minor-unit strings.

## Group chat (D7)

1. `GET /api/v1/social-groups/{id}/conversation` → `{ groupId, conversationId, canOpen }`.
2. Owner/Admin with `canOpen`: `POST …/conversation/open` body
   `{ id: <new uuid>, retentionPolicyVersion: "mp-rpc-v1.0-conversation" }`, headers
   `Idempotency-Key` (stable per attempt) and `If-Match: "<group revision>"`. Returns the same
   shape; the Group revision increments, so refetch the Group. `409
CONVERSATION_OPEN_IN_PROGRESS` → retry the GET.
3. Members: `POST …/conversation/join` (`Idempotency-Key`, empty body) → Messaging
   `Conversation`. `409 CONVERSATION_NOT_OPEN` before an admin opens it.
4. Then use the existing Messaging endpoints (`GET/POST /conversations/{id}/messages`, …).
   `404` on a conversation means "not joined or no longer authorized": show Join if the Group is
   still readable, otherwise drop cached Group and chat data.
5. History starts at join. After leaving/removal/deletion, chat access ends immediately; after
   re-admission or recovery the person must join again and sees no earlier messages.

Policies come from `GET /retention-policies?context=SOCIAL_GROUP` (`mp-rpc-v1.1-social-group`)
and `?context=CONVERSATION` (`mp-rpc-v1.0-conversation`). No files, realtime or typing.
