# 0037: Company reimbursement and controlled financial approvals

Status: **APPROVED by the owner for local P4-04 implementation, 2026-11-07**.
Scope: local P4-04 only. The owner explicitly approved this proposal in the implementation session.
Shared activation, deployment and later batches remain unauthorized.

## Binding scope and decision gap

The [V3 roadmap](../../MEHRAN_BACKEND_PRODUCTION_V3_2026-10-30/05_BATCH_ROADMAP_AND_QUALITY.md)
assigns P4-04 **reimbursement/payment acknowledgement and controlled workflow
approval versions**. The [Phase 4 specification](../../MEHRAN_BACKEND_PRODUCTION_V3_2026-10-30/03_PHASE_2_TO_7_BACKEND_SPEC.md)
requires member reimbursement requests, separately acknowledged settlement,
versioned transitions, assigned reviewers, escalation, rejection and history.
[Engineering contract §6](../../MEHRAN_BACKEND_PRODUCTION_V3_2026-10-30/11_PRODUCTION_ENGINEERING_CONTRACT.md)
and [G4](../../MEHRAN_BACKEND_PRODUCTION_V3_2026-10-30/12_COVERAGE_AND_GATES.md)
require partial acknowledgements, exact sums, immutable settled corrections and
concurrency/idempotency coverage. No acknowledgement executes a payment.

ADR 0036 establishes expense/budget rules and explicitly excludes reimbursement
and configurable approval steps. ADR 0032 establishes Project task approval only.
Neither decides Company reimbursement eligibility, acknowledgement parties,
multi-step authority or corrections after acknowledgement. Audit PG-12 expressly
identifies these gaps. AGENTS.md §§1 and 5 require an owner-approved decision;
authorizing a batch does not supply these otherwise unspecified product rules.

## Recommended fixed permission boundary

Retain ADRs 0034–0036: verified current identity, active Company root admission,
explicit child admission bound to the root generation, current scoped roles and
lifecycle fences. Existing financial managers are Owner/Org Admin with explicit
context admission, or Dept Manager in that admitted child context. No new role,
generic permission language, staff-case entitlement or financial directory grant.

| Operation                                                     | Proposed authority                                                                                                                                                                                                                                        |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create/submit reimbursement request                           | Current named member-payer of the effective approved expense; the payer claim must bind that person's current context admission/generation. Company-paid claims are ineligible. An unrelated proxy requester cannot claim another member's reimbursement. |
| Read reimbursement and its acknowledgements/history           | Its currently admitted generation-bound claimant/beneficiary, designated current reviewers and scoped financial managers. Unrelated members/viewers get no directory, amounts or counts.                                                                  |
| Publish/archive a financial workflow version                  | Scoped financial manager; publication grants only its specifically designated approval steps.                                                                                                                                                             |
| Discover published workflow choices                           | Current eligible expense/reimbursement applicants in the admitted context, plus financial managers; configuration exposes opaque reviewer bindings, never private staff information. Draft definitions remain managerial.                                 |
| Decide a workflow step                                        | Its named current eligible financial-manager reviewer, distinct from the request author and expense member-payer/beneficiary. Owner has no bypass.                                                                                                        |
| Record a proposed Company payment acknowledgement             | Scoped financial manager distinct from the reimbursement beneficiary; this is an assertion about an external payment, never payment execution.                                                                                                            |
| Accept/dispute that proposed acknowledgement                  | Named beneficiary only, with the original current admission/generation. A manager cannot confirm on the beneficiary's behalf.                                                                                                                             |
| Propose/accept a correction to an acknowledged payment record | A current scoped financial manager proposes a bounded compensating entry; the original beneficiary independently accepts or declines it. No unilateral rewrite, payment reversal or refund execution.                                                     |

Managerial status alone never changes who may approve or confirm their own claim.
Revocation, demotion, Personal account closure and stale admission generations
invalidate pending authority. Rejoin does not revive previous bindings. Departure
does not delete acknowledged financial history or block independent identity erasure.

## Reimbursement amounts and approval

Each request references a concrete approved Company expense revision, context,
beneficiary admission and immutable currency/scale. Its positive exact requested
amount may be partial. Drafts may be edited/canceled by their claimant; submission
freezes their amount, source revision, beneficiary and selected workflow version.
States are DRAFT → SUBMITTED → APPROVED or REJECTED. Claimant cancellation is
allowed before approval. Rejected/canceled decisions remain historical.

Use the effective approved expense amount as the entitlement for its claimed
member-payer. Across requests for that expense, beneficiary actor and currency:

`available to approve = current entitlement - net acknowledged amount - outstanding approved request reservations`.

Submitted requests reserve nothing. Approval atomically reserves only the requested
unreimbursed amount. Acknowledgement consumes that request's reservation and adds
the exact same amount to acknowledged totals. It does not spend the expense budget
again. Multiple partial requests are allowed; concurrent approvals cannot exceed
the entitlement. Pending payment assertions reserve within their approved request,
preventing competing assertions from exceeding its remaining balance.

An approved claimant may explicitly close an unused remainder when it has no
pending payment assertion. This releases only unused reimbursement reservation;
original approvals and acknowledged amounts remain immutable. Fully acknowledged,
partially acknowledged and unacknowledged are derived financial summaries,
separate from the immutable approval outcome. Request/approval alone never means paid.

## Partial acknowledgements and settled corrections

A payment assertion contains a positive partial amount, original request/currency,
named beneficiary and bounded external-reference metadata. States are PROPOSED →
ACKNOWLEDGED or DISPUTED; its author may cancel an unconfirmed assertion. A dispute
does not count as payment. Every acceptance/retry rechecks source, parties, role,
generation, request balance and idempotency under the existing Company fence.

An acknowledged record cannot be edited or deleted. A compensating record correction
references that exact acknowledgement and currency, cannot exceed its remaining
uncorrected amount, and becomes effective only after the beneficiary accepts it.
It corrects this application's acknowledgement evidence; it does not assert that
money was refunded or transferred. Disagreement retains the original evidence.

Approving an expense correction/reversal appends a traceable reimbursement-entitlement
adjustment in the same transaction. It invalidates unused approvals and unconfirmed
payment assertions pinned to the superseded expense revision, retaining their
decisions/history. New requests must bind the new effective approved revision.
Existing acknowledgements remain unchanged and count across revisions for the same
expense, beneficiary actor and currency, preventing duplicate reimbursement.

If the new entitlement is below net acknowledged amounts, expose the exact excess
as reconciliation required and permit no further reimbursement for that bucket.
Currency/payer changes retain separate historical buckets and adjustments; never
perform FX or add currencies together. A reversal sets current entitlement to zero.
Record corrections may reconcile acknowledged evidence only through the two-party
process above. No automatic refund, cash settlement, debt collection or Personal posting.

## Controlled financial approval versions

Use a bounded Company-owned financial workflow, not a generic automation engine.
Definitions apply explicitly to EXPENSE or REIMBURSEMENT in one admitted context.
Draft publication creates an immutable version with one to five sequential steps,
each with a named eligible primary reviewer and optional named alternate for manual
escalation. Reviewer identities are distinct across the version's steps/alternates.
At binding, all reviewers must also differ from the request author and member-payer.
No configurable permission expression, script, money action, quorum bypass or role
that can override separation of duties.

Reimbursement submission requires a published version. An expense may explicitly
opt into a controlled workflow through an additive submission contract; existing
P4-03 fixed-reviewer submissions keep their approved behavior. This introduces no
Company-wide mandatory-workflow policy or implicit default that overrides ADR 0036.
Once a revision opts in, legacy fixed-review decision/reassignment cannot bypass it.

Pin the source facts/revision, exact workflow version, ordered steps and admission
generations at submission. Only the active step can decide. All required steps
must approve before the source becomes approved; rejection terminates that instance.
Final approval atomically performs the existing source-domain transition, exact
budget/reimbursement checks and audit/outbox effects once. Intermediate approval
does not spend money or reserve reimbursement. Canceling the source cancels its
pending instance without erasing decisions.

The requester or scoped manager may explicitly escalate an undecided active step
to its predesignated eligible alternate. This invalidates the previous pending
reviewer authority and records who escalated it. No automatic timers, inferred
deadline, scheduler or external escalation service. Changed membership can block
approval but never grant fallback authority. An explicit requester restart may bind
a newly published version to unchanged submitted facts, invalidate the old instance
and restart all steps; prior decisions remain visible as historical evidence.
Published versions and existing decisions cannot be edited in place. Archiving a
version blocks new bindings/restarts but preserves already pinned eligible instances.

## Engineering preservation and acceptance

Reuse existing exact-money functions, frozen ISO scales, Company authorization,
sorted account/custody fences, generation-bound members, optimistic revisions,
mutation receipts, free-mode feature policy, private receipt owner contract and
opaque audit/outbox/control evidence. Company owns the reimbursement/workflow rows;
typed source/version/admission FKs retain independent Personal/Project/Team custody.
Retained attribution is pseudonymous, not a User FK or a new erasure hold.

All 612 published APIs and all 55 historical SQL artifacts remain compatible and
unchanged unless an explicitly documented additive source hook is required above.
Add new reviewed migrations; do not alter historical migration SQL. Test amounts,
partial and competing approvals/acknowledgements, self-approval, stale steps/versions,
escalation/restart, revocation/rejoin, cross-company privacy, settled corrections,
source budget effects, identity erasure and compiled restart. Run focused tests,
one complete 13-stage gate and sufficient affected reruns.

No real payment rail/provider, payroll, billing, Personal posting, new financial
retention period, staff-case grant, general attachment/export/report feature or
P4-05 functionality. Shared activation, Docker, hosted CI, deployment, production
database mutation and release-only operational acceptance remain deferred.

Owner decision: approved for local P4-04 implementation.
