# 0060: Social Activity participation contexts and recordkeeping ledger

Status: **APPROVED by the owner** for decisions A–E below (2026-11-18), with the
Group Activity creation rule confirmed the same day. Recorded classifications
separate owner policy, accepted engineering design, verified implementation and
items that remain gated. Companion records: [0061](0061-social-personal-finance-posting.md)
(Finance posting), [0062](0062-social-activity-conversation-context.md) (Activity
chat) and [0063](0063-social-file-media-contract.md) (files/media contract only).

Product sources: V3 documents 01/03/10/11/12; ADRs 0050 and 0051. Rate limits:
ADR 0058. Local media restrictions: ADR 0057. This record does not change any
historical approved ADR.

## Classification key

- **OWNER POLICY** — owner-approved product rule.
- **ENGINEERING** — accepted engineering design implementing that rule.
- **VERIFIED** — implemented and covered by isolated PostgreSQL tests.
- **POLICY-GATED** — cannot proceed until the owner approves a value or policy.
- **DEFERRED** — intentionally not built now.
- **NEEDS APPROVAL** — a further owner decision is required.

## Decision A — independent Activity ownership

| Item                                                                                                                                                                                                                                                                                                                                                | Class                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Keep the Social-owned participation context; no new `SharedCustody` kind for independent Activities. Group Activities stay associated with their Group custody.                                                                                                                                                                                     | OWNER POLICY                                                                    |
| Content authority is explicit accepted participation (`state=ACTIVE`); a Group-derived participant loses it with Group membership; a guest keeps only that Activity. Group Activity writes run in the Group custody fence (`participate`), independent ones in the verified account fence (`contactOperation`); every write locks the Activity row. | ENGINEERING, VERIFIED                                                           |
| Any active, verified Social Group member may create a Group Activity (owner-confirmed 2026-11-18).                                                                                                                                                                                                                                                  | OWNER POLICY, VERIFIED                                                          |
| Organizer succession: a manager nominates one current, verified, accepted non-organizer participant; only that nominee may accept or decline; managers may cancel. Nothing is assigned without the nominee's consent. The nomination ends if the nominee leaves or is removed.                                                                      | ENGINEERING, VERIFIED                                                           |
| The last organizer cannot leave a `PLANNED` Activity (`LAST_ORGANIZER`): nominate a successor, or cancel/close first.                                                                                                                                                                                                                               | ENGINEERING, VERIFIED                                                           |
| Account erasure is never blocked. If the erased user was the last organizer of an independent Activity, the Activity is closed (`PLANNED → CLOSED`) and marked `orphanedAt`; any pending nomination is cleared; nobody is promoted. Participants keep content, ledger, balance and settlement rights; settlements still need only payer and payee.  | ENGINEERING, VERIFIED                                                           |
| In an orphaned independent Activity, pending expense proposals cannot be approved (no approver remains); their proposers may withdraw them.                                                                                                                                                                                                         | ENGINEERING; owner may later approve a recovery path — NEEDS APPROVAL if wanted |

## Decision B — Social retention

| Item                                                                                                                                                                                                                                                                                                                                 | Class                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| 30-day recovery window for eligible deleted Social content; it is a recovery window, not a financial, audit, dispute or legal retention duration.                                                                                                                                                                                    | OWNER POLICY          |
| States: `PLANNED`, `CANCELED`, `CLOSED` (closed is not deleted), `DELETED` (recoverable until `recoverUntil` = deletion + 30 days), then content-disposed (`contentDisposedAt`). Managers may restore within the window; restoration revives content only, never participation, removals or revocations.                             | ENGINEERING, VERIFIED |
| Eligible content: checklist/itinerary/agenda items (individually recoverable for 30 days), and for a deleted Activity its items, polls, votes, Free/Busy snapshots, notices, description and location. Disposal runs in its own committed transaction on the next access after the deadline (no scheduled worker).                   | ENGINEERING, VERIFIED |
| Financial records (expenses, revisions, shares), settlements and disputes, participant rows needed for reconciliation, and Social audit evidence are a separate class. They are **never disposed** by the Social recovery window and remain readable to their authorized parties after Activity deletion.                            | ENGINEERING, VERIFIED |
| Exact retention durations for Social financial and audit records. Until approved, no disposal operation exists for them (fail closed against deletion); this is a policy gate, not an approved indefinite retention period.                                                                                                          | POLICY-GATED          |
| Group Activities and their ledgers follow the Social Group's custody lifecycle (cascade on Group purge). Social Group Shared activation still requires an approved retention policy (catalog v1: `SOCIAL_GROUP` has no approved rule); nothing here activates it.                                                                    | POLICY-GATED          |
| Account erasure removes the person's notices and Free/Busy data, detaches `userId` from Activity, ledger and audit rows (SET NULL), and keeps amounts reconcilable for others. Deleted, removed or revoked users regain nothing through restoration, cursors (authority-stamped) or receipts (authority is rechecked before replay). | ENGINEERING, VERIFIED |
| Departure/erasure treatment of unsettled balances.                                                                                                                                                                                                                                                                                   | POLICY-GATED (P6-06)  |

## Decision C — optional Personal Finance posting

See [ADR 0061](0061-social-personal-finance-posting.md).

| Item                                                                                                                                                                                                      | Class                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Explicit, user-initiated posting into the user's own Personal Finance; Finance owns the operation and persistence; no automatic posting or reversal.                                                      | OWNER POLICY                            |
| Implemented for the caller's own share of an expense's current effective approved revision, as a Finance `EXPENSE`, once per expense per user, via a Finance-owned port with a Finance-owned source link. | ENGINEERING, VERIFIED                   |
| Posting settlements. Not implemented: Personal Finance has no receivable/payable or person-to-person transfer contract, and posting a settlement on top of a posted share would double-count.             | NEEDS APPROVAL (Finance-owned contract) |

## Decision D — dedicated Activity chat

See [ADR 0062](0062-social-activity-conversation-context.md). Implemented with the
existing Phase 5 engine; admission is rechecked on every user operation. VERIFIED.
WebSocket, presence, typing and calling remain out of scope (ADR 0044).

## Decision E — files and media

See [ADR 0063](0063-social-file-media-contract.md). Contract/design only; all
content operations stay disabled. DEFERRED.

## Bounds and quotas

No approved Social quota keys exist in the feature-policy seam; bounded per-context
limits apply (1,000 participants, 500 items, 50 polls, 5,000 expenses/settlements
per ledger). Entitlement keys: NEEDS APPROVAL when commercial limits are defined.
