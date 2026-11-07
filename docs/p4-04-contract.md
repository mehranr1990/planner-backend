# P4-04 Company reimbursements and controlled approvals

Authority: V3 roadmap P4-04, Phase 4 corporate finance specification, production
engineering contract §6, G4, and owner-approved ADR 0037. Existing ADRs 0034–0036
remain binding. No payment execution, provider, payroll, billing or Personal posting.

## Additive HTTP contracts

All routes are under `/api/v1/companies/:id/contexts/:scopeId`. Verified sessions,
current root/child admission and the existing Origin requirement apply. Creations
require Idempotency-Key; changes require If-Match. Revisioned responses expose
ETag; pages use existing signed Company cursors with limits up to 100. Strict Zod
and generated OpenAPI define every field, error and authorization header.

| Family                                            | Operations                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `finance/approval-workflows`                      | POST/GET; GET `/:target`; POST/GET `/:target/versions`                                     |
| `finance/approval-workflow-versions/:target`      | GET/PATCH; POST `/publish`, `/archive`                                                     |
| `expenses/:target/workflow-submit`                | POST, explicit controlled expense opt-in                                                   |
| `reimbursements/:target/submit`                   | POST, pins a published reimbursement workflow                                              |
| `finance/approvals`                               | GET; GET `/:target`, `/:target/history`; POST `/:target/decision`, `/escalate`, `/restart` |
| `reimbursements`                                  | POST/GET; GET/PATCH `/:target`; POST `/:target/cancel`, `/close`; GET `/:target/history`   |
| `expenses/:target/reimbursement-balances`         | GET, scoped financial manager only                                                         |
| `reimbursements/:target/payment-acknowledgements` | POST/GET                                                                                   |
| `payment-acknowledgements/:target`                | GET; POST `/decision`, `/cancel`; POST/GET `/corrections`                                  |
| `acknowledgement-corrections/:target`             | POST `/decision`, `/cancel`                                                                |

Thirty-four additive operations. All 612 predecessor signatures remain intact.
Legacy P4-03 submissions retain fixed-reviewer behavior. Once an expense revision
explicitly opts into a controlled workflow, its legacy decision/reassignment
cannot bypass that binding. All mandatory workflow steps must finish before the
existing expense transition performs its original budget effects.

## Ownership and states

Companies owns the workflow/header, immutable published version, typed reviewer
steps, source-bound instance, immutable instance history, reimbursement bucket,
request, payment assertion, record correction and append-only reimbursement effect.
Every relationship uses concrete same-Company/context/admission FKs. No live User
FK, generic workflow permission expression or cross-owner repository access.
Existing money, Company fences, receipts, cursor, audit/outbox and feature policy
are reused. Historical attribution is obtained from the Spaces owner contract.

Only the effective approved expense's current named member-payer may request
reimbursement. An unrelated expense author cannot claim it, and Company-paid
expenses are ineligible. DRAFT → SUBMITTED → APPROVED/REJECTED is separate from
acknowledgement. Unapproved requests can be canceled; an approved unused remainder
can be CLOSED without altering its approval or acknowledged evidence. Superseded
unused authority becomes INVALIDATED. Reads follow the claimant's recorded current
generation or scoped financial management; unrelated members get no amounts/counts.

A scoped manager distinct from the beneficiary proposes a payment assertion;
only that beneficiary accepts/disputes it. PROPOSED → ACKNOWLEDGED/DISPUTED, with
author cancellation before confirmation. The manager's current role/generation is
rechecked at acceptance. A beneficiary can dispute a stale assertion. An acknowledged
record is immutable. A separate bounded correction requires a current manager's
proposal and beneficiary acceptance; it corrects evidence, never executes a refund.

Published workflow versions have one to five sequential steps, each with distinct
generation-bound primary and optional alternate financial-manager reviewers.
Request author and member-payer cannot approve themselves. Manual escalation is
limited to the pinned alternate; requester restart binds a published version to
unchanged submitted facts and invalidates all earlier pending authority. Final
approval rechecks source fingerprint/revision and all prior approving reviewers.
Archived versions block new bindings but preserve eligible pinned instances.
Their current generation-bound claimants retain exact historical-version reads;
unrelated applicants do not gain archived-definition access.
There are no automatic deadlines, timers or external escalation jobs.

## Exact balances and source changes

Money uses the frozen ISO scales, Decimal(28,4), positive decimal inputs up to
18 integral digits and exact scaled BigInt calculations. No FX or cross-currency sum.

`available = entitlement - net acknowledged - outstanding approved reservations`.

Approval reserves reimbursement entitlement without spending the expense budget
again. Pending payment assertions reserve within their request. Acceptance moves
that exact amount from reserved/pending to acknowledged. Disputes/cancellation
release only pending assertions. Requests and assertions can be partial; competing
approvals/assertions serialize under the Company fence and database bucket locks.

Approved expense corrections/reversals append entitlement adjustments atomically,
invalidate unused approvals/unconfirmed assertions for the old revision and retain
all acknowledgement history. The same expense/beneficiary actor/currency bucket
counts prior acknowledgements across revisions. Excess acknowledged money is shown
as reconciliation required; it does not authorize another payout. Payer/currency
changes retain independent buckets. Record corrections restore unused request
reservation only while that approved request/source remains current; closed or
superseded authority never revives.

## Preservation and verification

ADRs 0035 staff-case confidentiality and independent Personal erasure remain intact.
Project/Team custody and the P4-03 private receipt owner stay independent. Generic
control/audit/outbox/receipt evidence contains opaque IDs/hashes, never financial,
payment-reference or staff payloads. Company restore remains quarantined until its
separate domain reconciliation. No new worker or external side effect is required.

Acceptance maps the families above to schema/route tests, Company settlement
integration tests, current and historical migration rehearsals, all published API
baselines and a compiled fresh-process restart. Run focused checks, one full
13-stage quality gate and sufficient affected reruns. Shared activation, Docker,
hosted CI, production deployment and release-only operational gates stay deferred.
P4-05 is not started; P4-04 remains uncommitted and unpushed.
