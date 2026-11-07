# P4-03 Company expense and budget contract

Authority: approved V3 batch roadmap P4-03 and owner-approved ADR 0036.
P4-04 reimbursement, payment acknowledgement and configurable approval workflows
are excluded. Shared activation and Company attachment remain disabled.

## HTTP surface

All routes are under `/api/v1/companies/:id/contexts/:scopeId` and require a
verified session, current Company/root admission and explicit current context
admission. Mutations require Origin. Creation requires Idempotency-Key; changes
require If-Match. Responses expose ETag where revisioned. Collections use signed,
authorization-bound cursors, default/maximum limits from Company paging.

| Resource                                            | Operations                                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `finance/categories`                                | POST, GET; PATCH `/:target`                                                                             |
| `finance/project-references`                        | POST, GET                                                                                               |
| `finance/budgets`                                   | POST, GET; GET `/:target`; POST `/:target/adjustments`; PATCH `/:target/archive`                        |
| `finance/budgets/:budgetId/commitments`             | POST, GET                                                                                               |
| `finance/commitments/:target/release`               | POST                                                                                                    |
| `expenses`                                          | POST, GET; GET/PATCH `/:target`                                                                         |
| `expenses/:target`                                  | POST `/submit`, `/decision`, `/cancel`, `/corrections`, `/reversals`; PUT `/reviewer`; GET `/revisions` |
| `expenses/:expenseId/revisions/:versionId/receipts` | POST, GET; POST `/:receiptId/complete`, `/:receiptId/remove`; GET `/:receiptId/download`                |
| `finance/receipts/reconcile`                        | POST                                                                                                    |

Thirty additive operations. The generated OpenAPI and strict Zod schemas define
the exact inputs, responses, error contracts and binary receipt media types.
Draft editing replaces the complete facts/allocation plan. A correction or
reversal creates a new draft and increments the expense revision; it needs
submission and independent approval. Reviewer replacement uses the expense
revision and invalidates the former reviewer.

## Ownership and financial behavior

Companies owns category, budget, immutable limit adjustment, commitment, expense,
expense revision, allocation plan, immutable budget effect, review event, receipt
binding and Project-reference anchor. Projects owns the typed source bridge and
detaches it before disposing its sources. Financial rows contain no User FK.
Admission intervals retain pseudonymous attribution after identity detachment.

Requester and payer are separate generation-bound references. Only the requester
edits a draft; an eligible financial manager may propose an attributed correction
or reversal. Only the named current eligible reviewer decides. The reviewer must
differ from requester and member-payer. Viewer cannot submit. Scoped managers
read financial collections; expense/revision/receipt readers follow ADR 0036.
Finance rights confer no staff-case or independent Project content rights.

Money is a positive plain string with at most eighteen integral digits and the
frozen currency scale. Responses are canonical; calculations reuse exact scaled
BigInt arithmetic. No float, FX, cash movement or Personal posting. Allocations
are optional; a supplied plan covers the exact expense in one currency. Budget
dates are start-inclusive/end-exclusive and the expense uses that budget's zone.
Every allocation target requires explicit admission and reviewer management.

Only effective approved revisions spend money. Pending correction leaves the
old approval effective. Approval appends inverse and replacement ledger entries;
reversal appends an inverse and sets REVERSED without modifying the original.
Hard availability is adjusted limit minus effective spending and active reserved
money. Consumption moves reserved to spent. Release affects only unused reserves.
Reversal restores reserve only for an ACTIVE commitment. Archive blocks new
growth while retaining historical reversal. Company custody serializes operations;
database checks/locks also enforce nonnegative monetary balances.

## Files and lifecycle

Receipts are expense-revision-bound PDF/PNG/JPEG, maximum 10 MiB. Existing
SharedFiles/StoragePort owns private IO, content validation and cleanup. Claim and
finalization reauthorize the current mutable requester; download reauthorizes the
exact audience after opening bytes. Submission pins ready file revisions/hashes.
Private IO runs outside the transaction; failed/revoked uploads retain durable
private cleanup markers. Scoped manager reconciliation is bounded and retryable.
There is no generic Company upload, public URL or staff-case file binding.

All sources retain independent custody and membership. Project source metadata
requires current independent source authority; an opaque Company anchor remains
when source access disappears or the Project is disposed. Company restore stays
quarantined under existing lifecycle controls. No new background job is needed.
Generic signed control, audit, outbox and idempotency evidence contains only
opaque identifiers or hashes, never financial bodies or receipt bytes/names.
