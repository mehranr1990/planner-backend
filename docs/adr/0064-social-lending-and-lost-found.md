# 0064: Social lending and Lost & Found (P6-04)

Status: **APPROVED by the owner for decisions A–D** (2026-11-18). Product rules come from
approved sources (V3 01/02/03/10 FR-12, 07 AUD-07, 12 G6). The engineering design was
accepted with them. Social retention durations are **not** approved by this record.
Companion contracts: ADR 0044 (polling, no realtime), 0057 (local file blocking),
0058 (rate limits), 0060 (Social retention classes), 0063 (media contract only).

## Classification key

- **APPROVED POLICY**: an owner decision.
- **ENGINEERING**: accepted engineering design.
- **VERIFIED**: implemented and covered by isolated PostgreSQL tests.
- **POLICY-GATED**: blocked on a missing owner policy.
- **DEFERRED**: intentionally not built.
- **OPEN**: an open technical issue.

## Product rules (approved sources)

| Rule                                                                                                       | Source               | Class    |
| ---------------------------------------------------------------------------------------------------------- | -------------------- | -------- |
| Personal or Group assets; request/accept/handover/return with timestamps; overdue, disputed, lost, damaged | V3 01, 02, 03        | VERIFIED |
| The owner may say "the item is with X"; custody needs the borrower's confirmation                          | V3 01, 02            | VERIFIED |
| Lost & Found is separate from lending: missing/found posts and claims without a loan                       | V3 01, FR-12, AUD-07 | VERIFIED |
| Matches and claims never prove ownership; resolution needs confirmation; conflicts have a state            | V3 02, 03            | VERIFIED |
| No automatic financial fines or penalties                                                                  | V3 03, FR-12         | VERIFIED |

## Decision A — asset ownership

| Item                                                                                                                                                                                                                                                                                              | Class                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Assets remain personally owned. Social Groups only control authorized visibility and lending requests. There is no Group ownership or custody transfer, and the owner keeps authoritative control.                                                                                                | APPROVED POLICY          |
| `audience`: `PRIVATE` (owner only), `CONNECTIONS` (the owner's current accepted connections), `GROUP` (current members of one Group while the owner is a member). Visibility is evaluated on every request, so losing membership removes Group-derived visibility and new-request rights at once. | ENGINEERING, VERIFIED    |
| Existing loans belong to their two parties and survive Group membership changes. A Group Owner/Admin has a read-only view of loans on currently Group-associated assets. Unrelated Personal assets and owner details are never listed.                                                            | ENGINEERING, VERIFIED    |
| Collectively Group-owned property.                                                                                                                                                                                                                                                                | NOT BUILT (owner policy) |

## Decision B — notifications with polling fallback

| Item                                                                                                                                                                                                                                                                                                                                                                                                     | Class                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Use the existing notification infrastructure for ordinary Lending and Lost & Found notifications; keep polling as a fallback.                                                                                                                                                                                                                                                                            | APPROVED POLICY       |
| The existing Social notice inbox is reused: `SocialNotice`, `GET /social-notices` and `POST /social-notices/{id}/read`, the same channel Activities and expenses use. No second engine is added. The Notifications module's outbox consumer handles Personal reminder types only, and its push channels are Messaging-specific. Push and realtime for Social stay out of scope (ADR 0044).               | ENGINEERING           |
| Notices are written in the same transaction as the transition, to the current counterparty only. The payload is `kind` + `resourceId` (the loan, or the Lost & Found post) with no notes, evidence or claim text. The existing `(userId, dedupeKey)` unique index with `skipDuplicates` makes idempotent replays and retries produce one notice. A rejected transition commits neither state nor notice. | ENGINEERING, VERIFIED |
| Delivery is a poll of the inbox and is separate from loan state: losing or deleting notices never changes a loan. `GET /social-loans?actionRequired=true` stays the authoritative fallback, and every resource read re-checks authority.                                                                                                                                                                 | ENGINEERING, VERIFIED |
| Migration 0080 replaces two `SocialNotice` CHECKs (reviewed, hash-pinned): the context is still exactly one context, now with typed `loanId` / `lostFoundReportId` FKs (CASCADE), and 17 new kinds, each tied to its context column. The widened kind enum is a reviewed compatibility extension for the two `/social-notices` responses.                                                                | ENGINEERING, VERIFIED |
| Kinds: `LOAN_REQUESTED`, `LOAN_OFFERED`, `LOAN_DECIDED`, `LOAN_HANDOVER` (awaiting acknowledgement), `LOAN_RECEIVED` (custody confirmed), `LOAN_RETURN_REQUESTED`, `LOAN_RETURNED`, `LOAN_DISPUTED`, `LOAN_OUTCOME_PROPOSED`, `LOAN_OUTCOME_CONFIRMED`, `LOAN_DUE_PROPOSED`, `LOAN_DUE_DECIDED`, `CLAIM_SUBMITTED`, `CLAIM_DECIDED`, `CLAIM_HANDOVER`, `CLAIM_RESOLVED`, `CLAIM_DISPUTED`.               | ENGINEERING, VERIFIED |
| Web Push for Social notices.                                                                                                                                                                                                                                                                                                                                                                             | DEFERRED              |

## Decision C — erasure and shared history

| Item                                                                                                                                                                                                                                                                                                                                                                                                        | Class                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Keep only the minimum asset title needed for another participant's legitimate shared loan history. Remove private text and unnecessary evidence of the erased owner.                                                                                                                                                                                                                                        | APPROVED POLICY       |
| Erasure is never blocked. Undecided loans become `CANCELED`. Agreed and custody loans keep state, timestamps and history, are marked `orphaned`, and all identity references are detached (SET NULL). The remaining lender can still confirm a return.                                                                                                                                                      | ENGINEERING, VERIFIED |
| What is removed: the erased person's loan request/offer note; their dispute text (a `DISPUTED` loan keeps the fixed marker `[erased]`, because the state CHECK requires a note); the notes on their history events; all evidence they added (loan and Lost & Found); pending due-date proposals on their loans; their notices; their assets' descriptions; the text of their Lost & Found posts and claims. | ENGINEERING, VERIFIED |
| What is kept: the asset title (minimal item identity), loan states and timestamps, history actions, and the other party's own notes and evidence. Archived assets and erased posts do not appear in search, lists or matches.                                                                                                                                                                               | ENGINEERING, VERIFIED |
| Retention durations for loan history, audit, claims and evidence, and the final treatment of orphaned custody loans. No disposal operation exists (fail closed). The 30-day Social recovery window (ADR 0060) does not apply to these records.                                                                                                                                                              | POLICY-GATED (P6-06)  |

## Decision D — due dates and asset audience

| Item                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Class                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Due dates change by mutual agreement; the owner can change an asset's audience among the existing scopes.                                                                                                                                                                                                                                                                                                                                             | APPROVED POLICY       |
| `POST /social-loans/{id}/due-date` (either party, `If-Match`, idempotent) records a proposal in `ACCEPTED`/`HANDED_OVER`/`RETURN_REQUESTED`. `dueAt` stays authoritative until the other party sends `accept-due`; `decline-due` (the other party) and `withdraw-due` (the proposer) end it. One proposal at a time. A past or unchanged date is rejected, and the date is checked again on acceptance. Closing transitions clear a pending proposal. | ENGINEERING, VERIFIED |
| `PATCH /social-assets/{id}` with `audience`/`groupId` is owner-only and requires current membership of a target Group. The change commits with the asset revision, and visibility has no caches or grants to go stale. Undecided requests from people outside the new audience are canceled with a notice. Offers, agreed loans and history are kept.                                                                                                 | ENGINEERING, VERIFIED |

## Other engineering decisions (accepted)

| Decision                                                                                                                                                                                                                                        | Class                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Loan states and transitions; custody requires both handover and receipt (DB CHECK); `LOST`/`DAMAGED` confirmed by the counterparty; disputes need a note; overdue is derived (no worker or penalty).                                            | ENGINEERING, VERIFIED |
| At most one agreed or custody loan per asset (partial unique index plus asset lock). The asset is locked before the loan (the same order as archiving). Every transition takes the row lock and requires `If-Match` and an idempotency receipt. | ENGINEERING, VERIFIED |
| Lost & Found audiences `CONNECTIONS`/`GROUP`. Claims are private to claimant and reporter; one agreed claim at a time; two-party resolution; `ownershipVerified` is always `false`; Group Owner/Admin may hide or unhide.                       | ENGINEERING, VERIFIED |
| Evidence is descriptive metadata only (`content: null`), with exact contextual access. File upload, download and scanning stay blocked (ADR 0057/0063).                                                                                         | ENGINEERING, VERIFIED |

## Open technical issues

- Under full parallel test load, a whole-repository architecture probe can exceed its time limit. It passes alone. The same behavior was seen in P6-02/P6-03.
