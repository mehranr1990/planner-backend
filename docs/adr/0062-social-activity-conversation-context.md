# 0062: Activity conversations through the Phase 5 Messaging owner

Status: **APPROVED product policy** (ADR 0060 decision D, 2026-11-18);
engineering design **implemented and verified locally**.

## Design

- No new messaging engine, tables or transport. An Activity conversation is an
  ordinary Messaging-owned `PRIVATE_GROUP` conversation (its own `CONVERSATION`
  custody, retention policy supplied when opened) bound by two Messaging-owned
  nullable columns, `Conversation.sourceKind = 'SOCIAL_ACTIVITY'` and `sourceId`
  (unique pair). Existing conversations keep `NULL` and behave exactly as before.
- Messaging owns a source registry (`ConversationSources`). Social registers one
  guard (`ActivityConversationGuard`) that answers only "may this user participate
  now, and as ADMIN or MEMBER". Messaging calls it inside **every** user operation
  on a sourced conversation (`MessagingService.operation`: reads, sends,
  attachments, history, recovery, search, member changes, lists) and fails closed
  if no guard is registered. Background maintenance is unaffected.
- The guard takes a `FOR SHARE` lock on the participant row, so a concurrent
  removal, leave or erasure serializes with the Messaging operation.
- Authority: current accepted participation (`ACTIVE`), not deleted Activity, and
  current Group membership for Group-derived participants. Organizers are ADMIN.
- Opening: an accepted organizer calls `…/conversation/open`; Messaging creates and
  binds the conversation once (idempotent by source). Joining: each participant
  explicitly calls `…/conversation/join`; Messaging admits through its own
  `independentSeat` + `admit` path. History starts at join (OD-10 default); the
  existing admin-controlled newcomer-history setting is unchanged.
- Invited-but-unaccepted, removed, departed and erased users are denied on every
  operation; the conversation disappears from their lists. Membership rows remain
  as Messaging history and are never reused for authority.
- Backward compatibility: the earlier unmanaged link (`PUT …/conversation`) still
  works until a managed conversation is opened; afterwards it returns
  `409 CONVERSATION_MANAGED`.

## Out of scope

WebSocket, presence, typing and calling (ADR 0044). Proactive removal of stale
membership rows is not needed for authorization and is not implemented.
