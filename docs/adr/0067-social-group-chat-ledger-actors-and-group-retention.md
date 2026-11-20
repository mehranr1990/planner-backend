# 0067: Social Group chat, Group ledger actor IDs and Social Group retention

Status: **APPROVED owner decisions** D1, D2, D3 and D7 (Phase 6 final integration brief,
2026-11-18); engineering design below **implemented and verified** on isolated PostgreSQL.
Companion records: ADR 0044 (no realtime), 0057/0063 (files blocked), 0062 (sourced
conversations), 0066 (deletion, recovery, protected records).

## D1 — Social Group retention policy `mp-rpc-v1.1-social-group`

- Registered in `tooling/retention/catalog-v1.ts` and seeded only by the existing
  `retention:catalog:seed` tool (dry run, then `--apply`; idempotent, never overwrites).
- Context `SOCIAL_GROUP` only; `sharedRecoverySeconds` 2,592,000 (30 days); every class
  `retainAfterClosureSeconds` 0, `PURGE`, audience OWNER/ADMIN, export OWNER, no holds or
  obligations. Approval reference states development/pre-production use, production operator
  approval pending.
- Meaning: after the 30-day recovery deadline eligible Social content may be disposed
  (existing worker). It is **not** a disposal approval for protected records: the ADR 0066
  content guard still parks Groups with expenses, settlements, Social audit, goals or Lost &
  Found evidence in `BLOCKED_POLICY`. Shared lifecycle evidence disposal still needs the
  existing separate operator approval reference. No legal retention duration is inferred.
- Known limitation: the catalog-wide 2-year operational audit window is deliberately not
  applied, because the shared model disposes a Space at its longest class window and would
  otherwise hold eligible Group content for 2 years, contradicting D1.

## D2 — Conversations

Activity and Group chats use the existing `mp-rpc-v1.0-conversation` policy (supplied by the
client on open and validated by Messaging). The Group policy is never used for conversations.

## D3 — Group ledger actor IDs

- Requests accept `payerActorId`, `shares[].actorId` and `payeeActorId` as alternatives to the
  user-ID fields; exactly one form per reference (Zod 400 otherwise).
- Resolved server-side against `SharedActor` of **that Group's** space. Unknown, erased or
  other-Group actors resolve to a sentinel that fails the existing in-transaction eligibility
  check (`422 PARTICIPANT_INELIGIBLE`) **after** authorization, so non-members cannot probe.
  Duplicates across forms fail `SHARES_DUPLICATE`. Activity ledgers reject actor IDs
  (`422 ACTOR_REFERENCE_UNSUPPORTED`); their semantics are unchanged.
- Responses add nullable `payerActorId`, `shares[].actorId`, `actorId` (balances),
  `payerActorId`/`payeeActorId` (settlements); null on Activity ledgers. Existing user-ID
  fields, authorization, restricted post-departure access and idempotency are unchanged.

## D7 — Social Group chat

- No new engine or transport. One Messaging-owned `PRIVATE_GROUP` conversation per Group,
  bound by `Conversation.sourceKind = 'SOCIAL_GROUP'` (unique source pair) and reserved by a
  Social-owned nullable unique `SocialGroup.conversationId` (migration `202611180083`).
- `GET /social-groups/{id}/conversation` → `{ groupId, conversationId | null, canOpen }`.
  `POST …/conversation/open` (Owner/Admin, `Idempotency-Key`, `If-Match` Group revision when
  first reserving) reserves the ID under the Group row lock, then Messaging creates and binds
  it; concurrent opens converge (`409 CONVERSATION_OPEN_IN_PROGRESS` if another admin is mid-
  creation). `POST …/conversation/join` (any current member) admits through Messaging.
  Messages use the existing `/conversations/{id}/…` endpoints.
- `GroupConversationGuard`: current `ACTIVE` seat in an `ACTIVE` Group custody (`FOR SHARE`
  seat lock); Owner/Admin → ADMIN. It also returns `since`, the start of the current seat
  generation. Messaging (generic, opt-in per guard) treats a membership admitted before
  `since` as stale: the person must re-join and history restarts at the new join point.
- Effects: departure, removal, suspension and deletion revoke every read, send, history,
  search and list entry immediately; re-admission and Owner recovery never revive old chat
  membership; deleted Groups serve no chat. No Social audit row is written on open (a Social
  audit event is a protected record and would block D1 disposal); Messaging audits creation
  and admissions. History stays under the Conversation policy after Group disposal.
- Limits: Messaging's existing 200-member conversation cap applies. No files/media
  (ADR 0057/0063), WebSockets, presence or typing (ADR 0044).

## Amendment: ADR 0069 (2026-11-20)

Every recovery window in this ADR is superseded by [ADR 0069](0069-unified-seven-day-recovery.md):
exactly 7 days for all recoverable user-initiated deletions, applied to new
deletions only (persisted deadlines are never shortened). Retention classes,
holds, obligations and protected-record rules here are unchanged.
