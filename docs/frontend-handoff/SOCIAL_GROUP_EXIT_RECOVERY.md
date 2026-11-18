# Social Group exit, deletion and recovery — Frontend handoff (P6-06)

Backend batch P6-06, ADR [0066](../adr/0066-social-exit-retention-and-recovery.md). Contract:
[`openapi.json`](openapi.json) (1,300 operations; +5). Types: `@mehran/api-contracts`
(`social-lifecycle.ts`). Verified in isolated PostgreSQL only — not Live.

## Leaving a Group

1. `GET /social-groups/{id}/exit-check` (member) →
   `{ membershipRevision, obligations[], departureConfirmation, deletion }`.
   `obligations` are only **your** nonzero balances: `ledgerKind` (`GROUP`/`ACTIVITY`),
   `ledgerId`, `currency`, `netMinor`, `owedMinor`, `receivableMinor`. No names or expense text.
2. If `obligations` is empty: `POST /social-groups/{id}/leave` with `If-Match: "<membershipRevision>"`
   (body optional).
3. Otherwise show a warning, then on explicit second confirmation send
   `{ "outstandingBalanceConfirmation": "<departureConfirmation>" }`.
4. `409` with `error.details[0].code = OUTSTANDING_BALANCE_CONFIRMATION_REQUIRED` means a balance
   or membership changed: call `exit-check` again and re-confirm. Other `409`s: stale revision.

Leaving never moves money, blocks on debt or posts to Personal Finance.

## After leaving or removal

- Group, members, history, Group Activities (unless you were an invited guest), Group goals,
  Lost & Found, ledgers and Group notices are gone immediately (`404`). Clear cached Group views.
- Independent Activities are unaffected.
- **Own obligations only:** while your balance in a Group/Group-Activity ledger is nonzero you may
  call `GET .../balances/me` (own row; `GET .../balances` → 403), `GET .../settlements` (own only),
  `POST .../settlements` and decide your own settlements. Expense lists/details stay `404`.
  When the balance reaches zero this access ends; the `SETTLEMENT_*` notice remains in
  `/social-notices`.
- Disagreements: use existing Messaging where it is still permitted. No dispute workflow exists.

## Deleting a Group (primary Owner)

1. `GET exit-check` → `deletion: { groupRevision, outstandingLedgerCount, outstandingPartyCount,
confirmation }` (null for non-owners).
2. `POST /social-groups/{id}/delete` with `If-Match: "<groupRevision>"` and
   `{ "password": "...", "outstandingBalanceConfirmation"?: "..." }` (required only when
   `outstandingLedgerCount > 0`). Response `{ id, groupId, revision }`.
3. Every member's access ends immediately; the Group is unusable for everyone, including you.

## Own obligations after deletion (all former participants, also after the deadline)

While your balance in the deleted Group's ledger (or one of its Activities' ledgers) is nonzero:

| Call                                                                             | Allowed                                    |
| -------------------------------------------------------------------------------- | ------------------------------------------ |
| `GET /social-groups/{id}/balances/me`, `GET /social-activities/{id}/balances/me` | Own row; `GET .../balances` (all) → 403    |
| `GET .../settlements`                                                            | Own settlements only                       |
| `POST .../settlements`                                                           | Only to a party with an open balance there |
| `POST .../settlements/{settlementId}/decisions/{action}`                         | Existing payer/payee rules                 |

Everything else (Group, members, expenses, Activities, goals, messages) → `404`. People without a
balance in that ledger → `404`. Access for a ledger ends when your balance there reaches zero.
Use the same `Idempotency-Key`/`If-Match` handling as before; retries never duplicate settlements.

## Recovering (30 days, former primary Owner only)

1. `GET /social-groups/{id}/lifecycle-job` → `{ jobId, generation, revision, state,
recoveryDeadline, stage, failureCode }`.
2. `POST .../lifecycle-job/recovery-proof` (`If-Match: "<job revision>"`, `{ password }`) →
   `{ proof, revision, generation }`.
3. `POST .../lifecycle-job/recover` (`If-Match: "<proof revision>"`,
   `X-Deletion-Recovery: <proof>`, `{ generation, password }`) → `state: CANCELED`.
4. Only your Owner seat returns. Members must be invited or approved again.
5. After `recoveryDeadline`: `409`. Show the deadline prominently.

## Lifecycle states shown to the Owner

`CLOSING_GRACE` (recoverable) → `CLEANUP_PENDING` → `PURGING` → `DELETED`, or
`BLOCKED_POLICY` with `failureCode: SOCIAL_PROTECTED_RECORDS_RETAINED`: the Group holds expenses,
settlements, audit, goals or Lost & Found records that have no approved disposal policy. They are
retained; Group content is shown to nobody (see "Own obligations after deletion"). Only the former primary Owner can
read the status; revoked members get `403/404`.

## Account erasure implications

- Erasure is never blocked by Social records or open loans. Before erasure, list open loans with
  the existing `GET /social-loans` and suggest returning or settling items (informational only).
- If you are an Activity's last organizer, it closes (independent and Group Activities); pending
  invitations end; with no approver left, pending expense proposals are withdrawn and pending goal
  reports retracted. No one is promoted.

## Export

Use the existing Account Export. New sections: `socialExpenseShares` and `socialSettlements` (own
amounts/states only, no titles or notes).

## Not available

Albums/media, dispute arbitration, debt collection, payments, Social-specific export, push.
Disposal of retained financial/audit/history records is POLICY-GATED (ADR 0066 G).
