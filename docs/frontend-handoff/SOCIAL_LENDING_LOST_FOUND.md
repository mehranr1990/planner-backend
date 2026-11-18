# Social lending and Lost & Found (P6-04) — frontend handoff

Date: 2026-11-18. Published on `main`, not deployed. Migrations `202611180079` and
`202611180080` have **not** been applied to `mehran_dev`. Shared stays disabled until
the operator activates it, as for P6-01–P6-03.
Canonical contract: [`docs/api/openapi.json`](../api/openapi.json) (27 operations,
operationIds prefixed `socialLending…`, tag `social`; 17 new notice kinds on
`/social-notices`). Zod source: `packages/api-contracts/src/social-lending.ts`.
Decision record: [ADR 0064](../adr/0064-social-lending-and-lost-found.md) (owner-approved A–D).

## Transport rules (same as P6-02/P6-03)

- Session cookie, verified account. Every mutation needs `Origin` and `Idempotency-Key`
  (1–128 visible ASCII). Same key + same body replays the stored result; same key +
  different body → `409 IDEMPOTENCY_CONFLICT`. Receipts last 24 h. Authority is
  re-checked before a replay.
- `…/actions/{action}` and `PATCH` need `If-Match: "<revision>"` (stale →
  `409 REVISION_CONFLICT`; re-read and retry). Responses with `revision` set `ETag`.
  `Cache-Control: no-store` everywhere.
- Strict bodies and queries: unknown fields → `400`. Lists: `limit` 1–100 and the
  opaque `after` cursor (`nextCursor`), ordered by `id`; sort client-side.
- Rate limits (ADR 0058, Social family): reads 600, writes 120 per user/min.
  **Sensitive (20/min):** every `…/actions/{action}` and every `POST` under
  `…/claims`. On 429 honor `Retry-After`.
- Unknown or unauthorized resources → `404` (indistinguishable). A known resource where
  the caller lacks the role → `403` with a code.
- No money moves and no penalties apply. Nothing proves legal ownership. File content is
  unavailable (`evidence.content` is always `null`).

## Assets — `/api/v1/social-assets`

| Operation                                                 | Who / rules                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET ?view=MINE\|CONNECTIONS\|GROUP&groupId=&q=`          | `MINE`: own assets (any state). `CONNECTIONS`: active `CONNECTIONS` assets of my accepted connections. `GROUP` (requires `groupId`): active Group assets whose owner is still a member; caller must be a current member (else `404`). `q` = title contains (1–100 chars).                                                                                                   |
| `POST {id, audience, groupId?, title, description?}`      | `groupId` is required exactly when `audience=GROUP`; the caller must be a current member. `409 ASSET_EXISTS`; `413` above 1,000 active assets.                                                                                                                                                                                                                              |
| `GET /{id}`                                               | The owner, or the current audience of an active asset. `available` = no agreed or custody loan.                                                                                                                                                                                                                                                                             |
| `PATCH /{id} {title?, description?, audience?, groupId?}` | Owner only (`404` otherwise), `If-Match`. `groupId` is required exactly with `audience=GROUP`, and the owner must be a current member (`404`). The previous audience loses access in the same commit. Undecided requests from people outside the new audience become `CANCELED` (the borrower gets `LOAN_DECIDED`). Offers and agreed loans are kept. `409 ASSET_ARCHIVED`. |
| `POST /{id}/actions/archive` (empty body)                 | Owner. `409 ASSET_ON_LOAN` while an agreed or custody loan exists. Pending requests and offers become `CANCELED`.                                                                                                                                                                                                                                                           |

## Loans — `/api/v1/social-loans`

`POST {id, assetId, mode, borrowerUserId?, dueAt?, note?, alreadyWithBorrower?}`

- `mode=REQUEST`: the caller asks to borrow a visible `CONNECTIONS`/`GROUP` asset → `REQUESTED`.
- `mode=OFFER` (owner only, `borrowerUserId` required): → `OFFERED`. `alreadyWithBorrower: true`
  records the owner's statement (`lenderHandoverAt`). It is **not** custody:
  `custodyConfirmed` stays `false` until the borrower accepts and confirms receipt.
- Errors: `422 PARTICIPANT_INELIGIBLE` (self), `403 CONTACT_UNAVAILABLE` (block),
  `409 ASSET_UNAVAILABLE`, `409 LOAN_PENDING` (I already have an undecided loan for this asset),
  `422 DUE_IN_PAST`, `409 LOAN_EXISTS`, `413` above 1,000 loans per asset.

`GET ?role=ANY|LENDER|BORROWER&assetId=&actionRequired=true|false&groupId=`. `groupId`
returns the read-only moderation view of a Group Owner/Admin (`myRole: MODERATOR`; `404` for
others). `actionRequired=true` lists loans waiting for me (including a due-date proposal by the
other party). It is the authoritative fallback for notices. `GET /{id}`, `GET /{id}/history` (chronological, newest 1,000, `truncated`) and
`GET /{id}/evidence` are open to both parties and to the Group moderator. `POST /{id}/evidence
{id, kind, label, note?, observedAt?}` is open to the parties only; maximum 50 per loan.

`POST /{id}/actions/{action}` with body `{note?}`. Render `allowedActions`; never infer them.

| Action           | Who                                          | From → to                                                                                      |
| ---------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `accept`         | lender on `REQUESTED`, borrower on `OFFERED` | → `ACCEPTED` (`409 ASSET_UNAVAILABLE`, `409 BORROWER_INELIGIBLE` if no longer in audience)     |
| `reject`         | same deciders                                | → `REJECTED`                                                                                   |
| `cancel`         | requester / offerer; either before receipt   | `REQUESTED`/`OFFERED`/`ACCEPTED` → `CANCELED`                                                  |
| `handover`       | lender                                       | `ACCEPTED`; records `lenderHandoverAt`                                                         |
| `receive`        | borrower                                     | `ACCEPTED`; records `borrowerReceiptAt`; both recorded → `HANDED_OVER`                         |
| `return`         | borrower                                     | `HANDED_OVER` → `RETURN_REQUESTED`                                                             |
| `confirm-return` | lender                                       | custody (incl. disputed custody) → `RETURNED`                                                  |
| `report-lost`    | either party                                 | custody; sets `pendingOutcome=LOST` (`409 OUTCOME_PENDING`)                                    |
| `report-damaged` | either party                                 | custody; sets `pendingOutcome=DAMAGED` (item returned damaged)                                 |
| `accept-outcome` | the other party                              | → `LOST` / `DAMAGED`                                                                           |
| `dispute`        | either party, `note` required                | `ACCEPTED`/`HANDED_OVER`/`RETURN_REQUESTED` → `DISPUTED` (`422 DISPUTE_NOTE_REQUIRED`)         |
| `resume`         | whoever disputed                             | `DISPUTED` → previous state                                                                    |
| `accept-due`     | the party who did not propose                | applies `proposedDueAt` to `dueAt` (`409 NO_DUE_PROPOSAL`, `409 DUE_IN_PAST` if it has passed) |
| `decline-due`    | the party who did not propose                | clears the proposal; `dueAt` unchanged                                                         |
| `withdraw-due`   | the proposer                                 | clears the proposal                                                                            |

**Due-date change**: `POST /{id}/due-date {dueAt, note?}` with `If-Match` and
`Idempotency-Key`. Either party, in `ACCEPTED`/`HANDED_OVER`/`RETURN_REQUESTED`. It records
`proposedDueAt`, `dueProposedByUserId` and `dueProposedAt`; `dueAt` stays authoritative until
`accept-due`. Errors: `422 DUE_IN_PAST`, `409 DUE_CHANGE_PENDING` (one at a time),
`409 DUE_UNCHANGED`, `409 LOAN_STATE_CONFLICT`, `409 REVISION_CONFLICT`. Closing a loan clears
a pending proposal. The other party gets `LOAN_DUE_PROPOSED`, then `LOAN_DUE_DECIDED`.

Other codes: `403 LOAN_COUNTERPARTY_REQUIRED` (wrong party), `409 LOAN_STATE_CONFLICT`,
`409 ALREADY_RECORDED`, `409 COUNTERPARTY_ERASED`. `overdue` is true when a loan in custody is
past `dueAt`. `orphaned: true` means a party's account was erased; only the lender's
`confirm-return` remains, and the final treatment is policy-gated.

**Erasure history (ADR 0064 C)**: after a party's erasure the other party still sees state,
timestamps, history actions and the asset title. The erased person's request/offer `note`,
history notes and evidence are removed. Their dispute text becomes `[erased]`, and their
user id becomes `null`. Their assets are archived without a description. Their Lost & Found
posts become `WITHDRAWN` with `title`/`description` `null`.

## Lost & Found — `/api/v1/social-lost-found`

No loan or asset is required.

| Operation                                                                                                          | Who / rules                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST {id, kind: LOST\|FOUND, audience: CONNECTIONS\|GROUP, groupId?, title, description?, occurredOn?, assetId?}` | `assetId` is allowed only on `LOST` and must be one of my own assets. `422 OCCURRED_IN_FUTURE`; `413` above 200 open posts.                                                                                                                                                                                                                                                           |
| `GET ?view=MINE\|CONNECTIONS\|GROUP\|CLAIMED&groupId=&kind=&q=`                                                    | The audience sees `OPEN`/`RESOLVED` posts; moderators also see `HIDDEN` Group posts. `CLAIMED` = posts I claimed.                                                                                                                                                                                                                                                                     |
| `GET /{id}`                                                                                                        | The reporter, the audience, claimants (even after losing the audience), Group moderators. Reporter-only fields: `assetId`, `contested`, `openClaimCount`. `myClaimId` for claimants.                                                                                                                                                                                                  |
| `POST /{id}/actions/withdraw\|hide\|unhide` (empty body)                                                           | `withdraw`: reporter (`403 REPORTER_REQUIRED`); live claims become `SUPERSEDED`. `hide`/`unhide`: Group Owner/Admin (`403 MODERATOR_REQUIRED`).                                                                                                                                                                                                                                       |
| `GET /{id}/matches?q=`                                                                                             | Reporter only: `OPEN` posts of the opposite kind in the same audience. Suggestions only.                                                                                                                                                                                                                                                                                              |
| `POST /{id}/claims {id, note, linkedReportId?}`                                                                    | A member of the audience, not the reporter (`422 PARTICIPANT_INELIGIBLE`). `linkedReportId` = my own `OPEN` post of the opposite kind (`422 LINKED_REPORT_INVALID`). `409 REPORT_CLOSED`, `409 CLAIM_PENDING` (one live claim per person), `413` above 200.                                                                                                                           |
| `GET /{id}/claims`, `GET /{id}/claims/{claimId}`                                                                   | The reporter sees all claims; a claimant sees only their own.                                                                                                                                                                                                                                                                                                                         |
| `POST /{id}/claims/{claimId}/actions/{action}` `{note?}`                                                           | `acknowledge`/`reject`: reporter (`409 CLAIM_CONFLICT` if another claim is already agreed). `withdraw`: claimant. `handover`: holder (claimant for `LOST`, reporter for `FOUND`; see `holder`). `receive`: the other party. Both recorded → `RESOLVED`, the post becomes `RESOLVED`, and other live claims become `SUPERSEDED`. `dispute` (note required) / `resume` (disputer only). |
| `GET /{id}/history`                                                                                                | Reporter: all events. Claimant: their own claim's events. Moderator: post-level events only.                                                                                                                                                                                                                                                                                          |
| `GET/POST /{id}/evidence`                                                                                          | Add: reporter. Read: reporter, plus the claimant of an acknowledged, disputed or resolved claim (keep identifying details here, not in the public description).                                                                                                                                                                                                                       |
| `GET/POST /{id}/claims/{claimId}/evidence`                                                                         | Claimant and reporter only.                                                                                                                                                                                                                                                                                                                                                           |

`ownershipVerified` is always `false`: `RESOLVED` means both verified accounts confirmed a
handover, not legal ownership. Show "contested" when `contested` is true.

## Notifications (ADR 0064 B)

Lending and Lost & Found notices arrive in the existing Social inbox:
`GET /api/v1/social-notices` (poll) and `POST /api/v1/social-notices/{id}/read`. They have the
same schema as Activity notices, with `activityId` and `groupId` `null`. Route by `kind`:
`LOAN_*` → `GET /social-loans/{resourceId}`; `CLAIM_*` → `GET /social-lost-found/{resourceId}`
(the post), then its claims. Only the counterparty is notified, never the actor. Notices carry
no notes, evidence or claim text. A retried request never creates a second notice. Always
re-read the resource: authority is checked there, and the notice may be stale.

| Kind                                                   | Sent to / when                                                                                                    |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `LOAN_REQUESTED` / `LOAN_OFFERED`                      | owner / borrower on creation                                                                                      |
| `LOAN_DECIDED`                                         | the other party on `accept`/`reject`/`cancel`; borrower when archiving or an audience change cancels a request    |
| `LOAN_HANDOVER` / `LOAN_RECEIVED`                      | the other party when one side recorded handover or receipt (awaiting acknowledgement) / when custody is confirmed |
| `LOAN_RETURN_REQUESTED` / `LOAN_RETURNED`              | lender / borrower                                                                                                 |
| `LOAN_DISPUTED`                                        | the other party on `dispute`/`resume`                                                                             |
| `LOAN_OUTCOME_PROPOSED` / `LOAN_OUTCOME_CONFIRMED`     | the other party                                                                                                   |
| `LOAN_DUE_PROPOSED` / `LOAN_DUE_DECIDED`               | the other party                                                                                                   |
| `CLAIM_SUBMITTED`                                      | reporter                                                                                                          |
| `CLAIM_DECIDED`                                        | claimant on acknowledge/reject/supersede; reporter on withdraw                                                    |
| `CLAIM_HANDOVER` / `CLAIM_RESOLVED` / `CLAIM_DISPUTED` | the other party                                                                                                   |

There is no Web Push, WebSocket, presence or typing. Use `actionRequired=true` and the post/claim
lists as the fallback.

## Not available

File or photo evidence, collectively Group-owned property, and retention or disposal of
lending records (policy-gated). See ADR 0064.
