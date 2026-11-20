# 0066: Social exit, deletion recovery and retention hardening (P6-06)

Status: **APPROVED owner policies** (P6-06 brief, 2026-11-18) with the engineering design below
accepted with this batch. This record does **not** approve any retention or disposal period
other than the 30-day recovery window for eligible Social content.
Companion records: ADR 0044 (polling), 0050/0051 (Group roles, organizers), 0057/0063 (files
blocked), 0058 (rate limits), 0060 (Activity authority, decision A/B), 0064 (lending), 0065 (goals).

Classes: **APPROVED OWNER POLICY**, **ACCEPTED ENGINEERING DESIGN**, **IMPLEMENTED AND
VERIFIED** (isolated PostgreSQL, not Live), **POLICY-GATED**, **DEFERRED**.

## A. Social Group deletion and 30-day recovery

| Item                                                                                                                                                                             | Class                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Deletion moves the Group to a recoverable state for 30 days; only the former primary Owner (including an accepted handover successor) may restore; no automatic promotion.       | APPROVED OWNER POLICY       |
| Reuses the shared custody lifecycle (`CLOSING_GRACE`, 720-hour CHECK, proof + password recovery) used by Projects/Teams; no new tables or migration.                             | ACCEPTED ENGINEERING DESIGN |
| `POST /social-groups/{id}/delete` (primary Owner, password, `If-Match` Group revision) revokes every other seat (`REVOKED`) in the same transaction; the Owner seat ends `LEFT`. | IMPLEMENTED AND VERIFIED    |
| Recovery (`lifecycle-job`, `recovery-proof`, `recover`) restores only the Owner seat; revoked members need a new invitation or join approval. No privilege resurrection.         | IMPLEMENTED AND VERIFIED    |
| A deleted Group serves no reads or writes (custody not `ACTIVE`), including Group Activities for guests, discovery and join requests.                                            | IMPLEMENTED AND VERIFIED    |
| After the deadline, recovery is refused (`RECOVERY_UNAVAILABLE`).                                                                                                                | IMPLEMENTED AND VERIFIED    |
| Deleting with open balances in the Group or its Activities requires `outstandingBalanceConfirmation` from `GET exit-check` (counts only, re-derived under the custody lock).     | ACCEPTED ENGINEERING DESIGN |

## B. Scheduled cleanup (pg-boss worker, fail closed)

| Item                                                                                                                                                                                                                                                                                                                                                                                                        | Class                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| The existing worker loop (`SocialLifecycle.consume`, already run by the pg-boss notification worker) is extended, not duplicated. Bounded batches, leases, retries, restart safety and the recovery/cleanup race are the shared lifecycle's existing guarantees.                                                                                                                                            | ACCEPTED ENGINEERING DESIGN |
| **Fixed defect:** the pre-P6-06 purge cascaded `SocialExpense`, `SocialSettlement`, `SocialAuditEvent`, goals and Lost & Found evidence from the Group. A content guard now re-checks at execution time and holds the job in `BLOCKED_POLICY` (`SOCIAL_PROTECTED_RECORDS_RETAINED`; the job is then parked, see H) when any exist for the Group or its Activities. Nothing is deleted; nobody holds a seat. | IMPLEMENTED AND VERIFIED    |
| Groups without protected records (memberships, join requests, notices, Activities without ledgers, audit or goals) are disposed of after the window.                                                                                                                                                                                                                                                        | IMPLEMENTED AND VERIFIED    |
| No physical media deletion: Albums/media remain deferred; ADR 0057/0063 unchanged. Job logs carry state codes only.                                                                                                                                                                                                                                                                                         | ACCEPTED ENGINEERING DESIGN |

## C. Member departure and access revocation

| Item                                                                                                                                                                                                                                                          | Class                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Leaving or removal revokes Group-derived access immediately (Group, directory, history, Group Activities for non-guests, Group ledgers, goals, Lost & Found).                                                                                                 | APPROVED OWNER POLICY    |
| Independent Activities and guest participation are unaffected.                                                                                                                                                                                                | IMPLEMENTED AND VERIFIED |
| Group-derived Social notices (`groupId`, or a non-guest Group Activity) are filtered on every list/read by current membership; only notices about the person's own settlements remain.                                                                        | IMPLEMENTED AND VERIFIED |
| No blanket historical read: a departed person with a **nonzero balance** in a Group or Group Activity ledger may only read their own balance and settlements, record a settlement and confirm/dispute/cancel their own. Access ends when the balance is zero. | IMPLEMENTED AND VERIFIED |
| Remaining members may record and confirm settlements with a departed party who still has an open balance (counterparty rights).                                                                                                                               | IMPLEMENTED AND VERIFIED |
| P5 Messaging history and join-time rules are unchanged; disputes use existing Messaging only. No arbitration, mediator or case workflow.                                                                                                                      | APPROVED OWNER POLICY    |

## D. Unsettled expenses at departure

| Item                                                                                                                                                                                                                                                      | Class                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `GET /social-groups/{id}/exit-check` returns the caller's own nonzero balances (amounts and ledger ids only) and a confirmation token bound to the membership revision and those balances.                                                                | IMPLEMENTED AND VERIFIED |
| `POST leave` accepts optional `outstandingBalanceConfirmation`; without a matching fresh token it returns 409 `OUTSTANDING_BALANCE_CONFIRMATION_REQUIRED`. The token is recomputed inside the departure transaction, so a stale confirmation cannot pass. | IMPLEMENTED AND VERIFIED |
| No debt blocking, collection, enforcement, money transfer or Personal Finance posting/reversal.                                                                                                                                                           | APPROVED OWNER POLICY    |

## E. Account erasure

| Item                                                                                                                                                                                                                                                                                     | Class                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Last organizer erasure closes and orphans **independent and Group-linked** Activities (ADR 0060 A previously skipped Group Activities); no organizer is appointed.                                                                                                                       | IMPLEMENTED AND VERIFIED    |
| Pending invitations of the orphaned Activity are declined. With no approver left (independent Activity), pending expense revisions are withdrawn and pending goal reports retracted; effective amounts and settlements stay. Group Activities keep ADR 0051 Group Owner/Admin approvers. | IMPLEMENTED AND VERIFIED    |
| Open loans never block erasure; the P6-04 orphaned-loan behavior (orphan marker, own notes/evidence removed, minimal shared history kept) is unchanged.                                                                                                                                  | IMPLEMENTED (P6-04 tests)   |
| The pre-erasure return/settlement suggestion uses the existing `GET /social-loans` list; the Account deletion contract is not extended (module boundary).                                                                                                                                | ACCEPTED ENGINEERING DESIGN |

## F. Account export

Existing Account Export entry points only. Added `socialExpenseShares` (own share amounts, revision
state, currency, date) and `socialSettlements` (own payer/payee rows, no notes). No titles, notes or
other members' shares, so content of a Group the person left cannot reappear.

## G. Policy-gated (no approved disposal period)

Permanent disposal of: Social expenses, revisions, shares and settlements; Social audit events;
goal history and anonymous contributions; Lost & Found reports/claims/evidence; orphaned loans and
lending events; ledgers of deleted Groups (retained; reachable only by their own parties, see H). These are retained with access
restricted. This is **not** a determination that they must be retained forever; an owner/legal
retention decision is required before any disposal.

## H. Deleted-Group financial access (owner decision, P6-06 final fix)

**APPROVED OWNER POLICY (2026-11-18):** after a Social Group is deleted, including after the
30-day recovery deadline, each former participant keeps narrowly scoped access to their own
outstanding shared-expense balances, their own settlement history and the existing settlement
recording/confirmation operations, subject to the separately approved financial retention policy.
General Group access is never restored.

| Item                                                                                                                                                                                                                                                                                                                      | Class                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| When the Group custody is not `ACTIVE`, the existing ledger endpoints `GET .../balances/me` (own row; `GET .../balances` → 403), `GET .../settlements` (own), `POST .../settlements` and `POST .../settlements/{id}/decisions/{action}` run under the verified-account fence instead of the Group fence. No new endpoint. | IMPLEMENTED AND VERIFIED    |
| Applies to the Group ledger and its Group Activities' ledgers. Only a party with a **nonzero balance** in that ledger is admitted; everyone else gets 404. Settlement counterparties are limited to parties with an open balance in the same ledger.                                                                      | IMPLEMENTED AND VERIFIED    |
| Expense lists/details, new expenses, approvals, members, Activities, messages and Group content stay unavailable. Existing counterparty rules, revisions, idempotency receipts and Social audit apply unchanged.                                                                                                          | IMPLEMENTED AND VERIFIED    |
| Erased accounts have no session and cannot use this path; erasure detaches identities from the retained rows (P6-03) without deleting them.                                                                                                                                                                               | IMPLEMENTED AND VERIFIED    |
| A Social job blocked by protected records is **parked** (`nextAt` = 9999-12-31) instead of being re-checked hourly: those records never become disposable by time alone. Only a future approved disposal policy and an operator re-arm can make it eligible. Other contexts keep the hourly re-check.                     | ACCEPTED ENGINEERING DESIGN |
| The recovery deadline only ends recoverability; it never authorizes disposal of protected financial or audit records.                                                                                                                                                                                                     | APPROVED OWNER POLICY       |

## Amendment: ADR 0069 (2026-11-20)

Every recovery window in this ADR is superseded by [ADR 0069](0069-unified-seven-day-recovery.md):
exactly 7 days for all recoverable user-initiated deletions, applied to new
deletions only (persisted deadlines are never shortened). Retention classes,
holds, obligations and protected-record rules here are unchanged.
