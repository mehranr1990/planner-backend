# Social Activities and shared expenses (P6-02/P6-03) — frontend handoff

Date: 2026-11-17. Local, **uncommitted** backend work; not published or deployed.
Shared remains disabled until the operator activates it, exactly like P6-01.
Canonical contract: [`docs/api/openapi.json`](../api/openapi.json) (operationIds
prefixed `socialActivity…`, tag `social`). Zod sources:
`packages/api-contracts/src/social-activities.ts`. Engineering record:
[ADR 0060](../adr/0060-social-activity-participation-and-ledger.md) (pending ratification).

## Transport rules (same as P6-01)

- Session cookie; every mutation needs `Origin` and `Idempotency-Key`
  (1–128 visible ASCII). Same key + same body replays the stored result;
  same key + different body → `409 IDEMPOTENCY_CONFLICT`. Receipts last 24 h.
- Edits/decisions need `If-Match: "<revision>"` (stale → `409 REVISION_CONFLICT`).
  Responses carrying `revision` also set `ETag`. All responses `Cache-Control: no-store`.
- Strict bodies: unknown fields → `400`. Lists: `limit` 1–100, opaque signed `after`
  cursor (`nextCursor`), ordered by `id`; sort client-side by the time fields.
- Rate limits (ADR 0058): all routes here use the Social family — reads 600/user/min, writes 120, sensitive 20 (invitations, participants/roles, join/leave, lifecycle, expense and settlement decisions). On 429 honor `Retry-After` (seconds to the next minute) and the `RateLimit-*` headers.
- Group Activity creation: any active, verified current Group member (owner-confirmed 2026-11-18).
- Errors are `ApiError`; codes below appear in `error.code`. Unauthorized or
  unknown resources are `404` (indistinguishable); a known context where the caller
  lacks a role is `403`.

## Activities (`/api/v1/social-activities`)

| Operation                                                                      | Notes                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /social-activities?groupId=`                                              | Without `groupId`: my `INVITED`/`ACTIVE` participations (summaries). With `groupId`: Group Activity summaries for current Group members.                                                                                                                                  |
| `POST /social-activities`                                                      | `{id, groupId\|null, template, title, description?, location?, timezone, startsAt, endsAt, capacity?}`. Creator becomes `ORGANIZER`, `GOING`. Group Activities require current Group membership. Schedule ≤ 90 days.                                                      |
| `GET /social-activities/calendar?from&to`                                      | My accepted Activities and itinerary legs (≤ 93 days, ≤ 1000 items). Overlay only; nothing is copied into Calendar.                                                                                                                                                       |
| `GET/PATCH /social-activities/{id}`                                            | Content: accepted participant or Group Owner/Admin. Edit: organizers / Group Owner/Admin, `PLANNED` only.                                                                                                                                                                 |
| `POST /social-activities/{id}/lifecycle/{cancel\|close}`                       | `PLANNED` → `CANCELED`/`CLOSED`. Cancel clears places and notifies.                                                                                                                                                                                                       |
| `POST …/join`                                                                  | Group Activity self-join by a current Group member (explicit acceptance). Removed participants need a new invitation.                                                                                                                                                     |
| `POST …/invitations` `{userId}`                                                | Organizers/Group admins. Target must be a verified, unblocked contact. Non-members of the Group become `guest: true`.                                                                                                                                                     |
| `POST …/rsvp` `{rsvp: GOING\|MAYBE\|DECLINED}`                                 | Invitees and participants. Declining an invitation grants no content.                                                                                                                                                                                                     |
| `POST …/leave`                                                                 | The last active organizer of a `PLANNED` Activity cannot leave (`LAST_ORGANIZER`).                                                                                                                                                                                        |
| `GET …/participants`                                                           | Display names only; managers also see pending invitees.                                                                                                                                                                                                                   |
| `POST …/participants/{pid}/remove`, `PUT …/participants/{pid}/role`            | Managers; `If-Match` = participant revision.                                                                                                                                                                                                                              |
| `GET/POST …/items`, `PATCH/DELETE …/items/{itemId}`                            | `ITINERARY` (start required), `AGENDA` (managers, inside the schedule), `CHECKLIST` (any participant; creator/assignee edit; anyone toggles `done`). Items expose `localDate`/`dayIndex` in the Activity time zone.                                                       |
| `POST …/items/{itemId}/task`                                                   | Creates (once) a **Personal** Task for the caller from a checklist item; `{created:false}` on repeat.                                                                                                                                                                     |
| `GET/POST …/polls`, `PUT …/polls/{pollId}/vote`, `POST …/polls/{pollId}/close` | Results are aggregate counts plus `myOptionIds`; voter identities are never returned. Closing a `SCHEDULE` poll with `chosenOptionId` moves the Activity schedule.                                                                                                        |
| `GET/PUT/DELETE …/free-busy`                                                   | `PUT` is explicit consent: stores busy-only intervals from the caller's own Calendar inside the Activity window. `DELETE` revokes. Titles never leave Calendar. Leaving/removal deletes it.                                                                               |
| `PUT …/conversation` `{conversationId\|null}`                                  | Links an existing Phase 5 private conversation the organizer belongs to. It grants no chat access; invite people through Messaging.                                                                                                                                       |
| `PUT …/reminder` `{minutesBefore: 5–10080\|null}`                              | Per-participant reminder.                                                                                                                                                                                                                                                 |
| `GET /social-notices`, `POST /social-notices/{id}/read`                        | Polling inbox (newest 1000): `ACTIVITY_INVITED`, `ACTIVITY_UPDATED`, `ACTIVITY_CANCELED`, `ACTIVITY_REMOVED`, `SEAT_OFFERED`, `ACTIVITY_REMINDER`, `EXPENSE_PROPOSED`, `EXPENSE_DECIDED`, `SETTLEMENT_RECORDED`, `SETTLEMENT_DECIDED`. Fetch the resource after a notice. |

### Participation, RSVP and waitlist states

- `state`: `INVITED → ACTIVE | DECLINED`; `ACTIVE → LEFT | REMOVED`. Only `ACTIVE`
  sees content. `rsvp`: `PENDING | GOING | MAYBE | DECLINED`.
- `seat`: `HELD` (only with `GOING`), `WAITLISTED` (FIFO by `waitlistedAt`),
  `OFFERED` (a released place reserved until `offerExpiresAt`, **12 hours**; send
  `rsvp: GOING` to claim), `NONE`. An unclaimed offer lapses and moves to the next
  person. `GOING` with no place returns `seat: WAITLISTED, rsvp: PENDING`.
- Summary counts: `seatsTaken`, `waitlistCount`. Capacity cannot drop below held
  places (`CAPACITY_BELOW_HELD`). Offer expiry is reconciled on the next Activity
  read or write (no push).

Error codes: `ACTIVITY_NOT_OPEN`, `ACTIVITY_PERMISSION_REQUIRED`,
`ACTIVITY_PARTICIPATION_REQUIRED`, `ALREADY_PARTICIPATING`, `INVITATION_REQUIRED`,
`PARTICIPANT_NOT_CURRENT`, `LAST_ORGANIZER`, `CAPACITY_BELOW_HELD`,
`SCHEDULE_INVALID`, `SCHEDULE_EXCLUDES_ITEMS`, `OUTSIDE_ACTIVITY_SCHEDULE`,
`ITINERARY_TIME_REQUIRED`, `ASSIGNEE_INVALID`, `POLL_CLOSED`, `POLL_OPTION_INVALID`,
`ACTIVITY_CHANGED_RETRY`, `BUSY_RANGE_UNAVAILABLE`, `CONTACT_UNAVAILABLE`.

## Shared expenses (Group and Activity ledgers)

Same operations under `/api/v1/social-groups/{id}` and `/api/v1/social-activities/{id}`:

| Operation                                                                                 | Rules                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET/POST …/expenses`                                                                     | Any current Group member / accepted Activity participant proposes. Starts `PENDING`; no balance effect. List: approvers see all; others see expenses they proposed, paid or share in. |
| `GET …/expenses/{eid}`, `GET …/history`                                                   | Non-approvers see only their own share (`sharesRestricted: true`).                                                                                                                    |
| `POST …/expenses/{eid}/revisions`                                                         | Proposer or approver. Creates a **pending** correction; the approved revision stays effective. Replaces an earlier pending revision.                                                  |
| `POST …/expenses/{eid}/decisions/{approve\|reject\|withdraw}`                             | Approvers: Group Owner/Admin; Activity organizers plus the parent Group's Owner/Admin. `withdraw`: the pending revision's proposer.                                                   |
| `GET …/balances/me`, `GET …/balances`                                                     | Own balance for any member; whole-scope balances only for approvers (`403 BALANCE_PERMISSION_REQUIRED`). Per currency, never converted.                                               |
| `GET/POST …/settlements`, `POST …/settlements/{sid}/decisions/{confirm\|dispute\|cancel}` | Payer records; only the payee confirms or disputes (dispute requires `note`); only the payer cancels. Only `CONFIRMED` affects balances.                                              |

Money: `amountMinor` and all balance fields are **decimal strings of integer
minor units** (`"1999"` = 19.99 USD); `scale` gives the currency exponent. Never use
floating point. Supported currencies come from the Finance currency table.
Split input: `shares: [{userId, value?}]` in recorded order — `EQUAL` (no values),
`PERCENT` (basis points summing to 10000), `WEIGHTED` (non-negative integers),
`FIXED` (minor units summing exactly). Remainders go one unit at a time to the
payer first, then the recorded order. Balance fields: `paidMinor`, `shareMinor`,
`settledOutMinor`, `settledInMinor`, `netMinor` (positive = others owe you),
`owedMinor`, `receivableMinor`.

States: expense `PENDING → APPROVED | REJECTED | WITHDRAWN` (an `APPROVED` expense
stays approved while corrections are pending/rejected); revision `PENDING →
APPROVED | REJECTED | WITHDRAWN`, previous approved → `SUPERSEDED`; settlement
`RECORDED → CONFIRMED | DISPUTED | CANCELED`, `DISPUTED → CONFIRMED | CANCELED`.
Confirmed settlements are never edited; record a reverse settlement to correct.

Error codes: `LEDGER_PARTICIPATION_REQUIRED`, `PARTICIPANT_INELIGIBLE`,
`EXPENSE_EXISTS`, `EXPENSE_NOT_PENDING`, `EXPENSE_NOT_REVISABLE`,
`EXPENSE_PERMISSION_REQUIRED`, `EXPENSE_APPROVER_REQUIRED`, `SPLIT_TOTAL_MISMATCH`,
`PERCENT_TOTAL_INVALID`, `WEIGHT_TOTAL_INVALID`, `SHARE_VALUE_INVALID`,
`SHARES_DUPLICATE`, `SETTLEMENT_EXISTS`, `SETTLEMENT_NOT_PENDING`,
`SETTLEMENT_COUNTERPARTY_REQUIRED`, `DISPUTE_NOTE_REQUIRED`, `BALANCE_PERMISSION_REQUIRED`.

## Gap closure additions (2026-11-18; ADRs 0060–0063)

All under `/api/v1`; same transport rules. `SocialActivity` responses now also
carry `conversationManaged`, `successorParticipantId`, `orphanedAt`, `deletedAt`
and `recoverUntil`; `state` may be `DELETED`. Notice kinds add
`ORGANIZER_NOMINATED` and `ACTIVITY_DELETED`.

| Operation                                                                                                               | Rules                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /social-activities/{id}/succession` `{participantId}` + `If-Match`                                                | Managers nominate a current, verified, accepted non-organizer participant (`422 SUCCESSOR_INELIGIBLE`). Sensitive rate class.                                                                                                                                               |
| `POST /social-activities/{id}/succession/{accept\|decline\|cancel}` + `If-Match`                                        | Only the nominee accepts/declines (others: `404`); managers cancel. Accept makes the nominee `ORGANIZER`. `409 NO_SUCCESSION_PENDING`.                                                                                                                                      |
| `DELETE /social-activities/{id}` + `If-Match`                                                                           | Managers. `state → DELETED`, `recoverUntil = deletedAt + 30 days`. Content reads return `404`; ledgers stay readable/settleable for their parties. Sensitive rate class.                                                                                                    |
| `POST /social-activities/{id}/restore` + `If-Match`                                                                     | Managers, inside the window: back to the previous state. After it: `409 RECOVERY_EXPIRED` (content already disposed). Restoration never revives participation.                                                                                                              |
| `DELETE …/items/{itemId}` (now recoverable) and `POST …/items/{itemId}/restore` + `If-Match`                            | Deleted items disappear from lists; managers or the checklist author restore within 30 days; afterwards `404`.                                                                                                                                                              |
| `POST /social-activities/{id}/conversation/open` `{id, retentionPolicyVersion}` + `If-Match`                            | Accepted organizers only. Creates (once) the Activity's private conversation; returns the Activity with `conversationManaged: true`.                                                                                                                                        |
| `POST /social-activities/{id}/conversation/join`                                                                        | Each accepted participant joins explicitly; returns the Messaging `Conversation`. History starts at join. Then use the existing `/conversations/{id}/…` Messaging endpoints. Invitees, removed, departed or erased users get `404` everywhere. `409 CONVERSATION_NOT_OPEN`. |
| `PUT /social-activities/{id}/conversation`                                                                              | Legacy manual link; `409 CONVERSATION_MANAGED` once a managed conversation exists.                                                                                                                                                                                          |
| `POST {ledger}/expenses/{eid}/finance-posting/preview` `{accountId, categoryId\|null}`                                  | No write. Returns `amountMinor`, decimal `amount`, `currency`, `scale`, Finance posting `localDate` (today in the user's Finance time zone), `transactionType: EXPENSE`, `accountName`, source `revisionId`, `alreadyPosted`.                                               |
| `POST {ledger}/expenses/{eid}/finance-posting` `{accountId, categoryId, revisionId, confirm: true}` + `Idempotency-Key` | Posts the caller's own share once into their own Personal Finance. Repeats return `created: false`. `409 EXPENSE_CHANGED_REVIEW` (re-preview), `409 NO_POSTABLE_SHARE`, `422 CURRENCY_MISMATCH \| ACCOUNT_ARCHIVED \| CATEGORY_INVALID`.                                    |

Frontend rules: always show the preview before confirming a posting; never offer
posting for settlements; show orphaned/closed Activities read-only; show the
recovery deadline for deleted items/Activities; when a nominee is pending, show
accept/decline only to that participant.

## Not available — do not build UI that depends on these

- Posting **settlements** to Personal Finance (needs a Finance contract).
- Any **file/media** upload, download or album (ADR 0063: contract only, disabled).
- Push/realtime delivery of notices, WebSocket/presence/typing/calls.
- Retention durations for financial/audit records, departure settlement rules
  (P6-06), lending, albums and challenges (P6-04/05).
