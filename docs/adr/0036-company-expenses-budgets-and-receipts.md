# 0036: Approved Company expense, budget and receipt rules

Status: **APPROVED by the owner for local P4-03, 2026-11-07**.
Scope: P4-03 local implementation. The owner explicitly approved this decision in the implementation session.
Shared activation, deployment and later batches remain unauthorized.

## Scope established from the V3 source documents

The [batch roadmap](../../MEHRAN_BACKEND_PRODUCTION_V3_2026-10-30/05_BATCH_ROADMAP_AND_QUALITY.md)
assigns P4-03: **corporate expense, receipt and approval statuses; budgets,
commitments and monetary allocations; exact currency**. The
[Phase 4 specification](../../MEHRAN_BACKEND_PRODUCTION_V3_2026-10-30/03_PHASE_2_TO_7_BACKEND_SPEC.md)
and [feature registry](../../MEHRAN_BACKEND_PRODUCTION_V3_2026-10-30/01_MASTER_FEATURE_REGISTRY.md)
also require expense categorization/payer metadata and Company, Department and
Project financial context. Expense amounts do not count before approval.

P4-04 owns reimbursement/payment acknowledgement and controlled approval-workflow
versions. P4-05 owns knowledge-base files, Company reports/exports and audit views.
P4-06 owns actual Company attachment/transfer of independent Teams/Projects and
full Company lifecycle. This proposal implements no later-batch workflow engine,
reimbursement, paid status, payment rail, attachment/transfer or general export.
An expense receipt is distinct from a knowledge-base or employee-file attachment.

## Why an owner decision is required

[V3 audit PG-12](../../MEHRAN_BACKEND_PRODUCTION_V3_2026-10-30/08_PRODUCTION_GRADE_DEEP_AUDIT.md)
identifies financial state transitions, approval, correction and allocation rules
as prerequisites before P4 finance. The engineering contract requires concrete
state machines, exact sums, immutable adjustments and concurrent reservation safety.

ADR 0034 grants Company metadata authority only. ADR 0035 covers staff/cases and
equipment, not monetary allocations or financial readers. ADR 0032 designates
Project workflow approvers and explicitly creates no Company policy. Personal
Finance ADRs 0016/0017 provide precision techniques; their private-account rights
and advisory overspending rule do not establish Company finance policy.
AGENTS.md sections 1 and 5 require this missing product decision before code/DDL.

## Recommended fixed authority

Every operation requires verified current identity/session, active Company root
admission and, for child content, explicit current child admission bound to the
root generation. Finance authority confers no staff-case, Personal, Project or
Team content access. No new role, generic permission language or policy key.

| Operation                                                                       | Proposed authority                                                                                                                                                                                 |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create expense draft / submit                                                   | Owner, Org Admin, Dept Manager, Team Lead or Member in the explicit expense context; Viewer cannot submit                                                                                          |
| Edit/cancel draft; propose correction or reversal                               | Recorded requester with current eligible admission; financial manager may propose a separately attributed correction/reversal; no mutation of approved facts                                       |
| Read expense, revisions and receipts                                            | Current requester; named claimed member-payer; designated reviewer for that revision; scoped financial managers below. All bindings require current recorded admission generations                 |
| Financial management reads; categories; budget/commitment/allocation management | Owner / Org Admin with explicit admission in the context; Dept Manager only in that explicitly admitted child context. Team Lead/Member/Viewer get no general financial directory or budget totals |
| Assign reviewer at submission                                                   | Requester chooses one current eligible Owner/Org Admin, or Dept Manager in that child context, distinct from the requester                                                                         |
| Approve/reject expense revision or proposed reversal                            | Only that designated reviewer while still eligible; never the revision requester, including Owner. Applicable budget-management authority is additionally required for each allocation target      |
| Receipt upload/replace/remove                                                   | Requester on their mutable draft/correction; reads follow the exact expense audience. Submitted/approved receipt snapshots cannot be silently replaced/deleted                                     |
| Project financial association                                                   | Acting Company financial manager also independently holds current Project Owner/Admin authority; explicit typed reference only, no Project membership or custody changes                           |

A reviewer must also differ from the claimed member-payer, if one is named; a
proxy requester must not permit approval of the reviewer's own claimed payment.
Owner/Org Admin status alone is not an approval bypass. A solo requester needs
another eligible reviewer before submission can complete. A demoted/revoked
reviewer or departed requester cannot exercise stale decision authority. Rejoin
does not restore old-generation designations. Assignment replacement is explicit,
revisioned and audited; old pending authority cannot survive it.

## Expense facts and basic approval statuses

Use fixed DRAFT -> SUBMITTED -> APPROVED or REJECTED transitions. DRAFT/SUBMITTED
may be explicitly CANCELED by their requester. Submission freezes the exact money,
currency, category, occurrence date/timezone, payer claim and ready receipt versions.
Reviewer decisions require that immutable revision and current authority. There is
no configurable approval definition, escalation or reimbursement step in P4-03.

Payer metadata is a claim identifying Company funds or a current explicitly named
Company member/generation. It is never a confirmed payment or personal-ledger entry.
Vendor/receipt labels are bounded metadata, not a vendor CRM or tax invoice system.

Only effective APPROVED expense facts contribute to spending. Approved amounts,
currency and evidence are immutable. Corrections create a new pending revision;
the prior approved revision stays effective until independent approval atomically
appends reversing/replacement effects. Reversal requests likewise require a current
independent reviewer and append traceable negating effects once. An approved reversal sets the expense's effective state to REVERSED without
rewriting its original approved revision. Original decisions and allocations remain retained. Draft/rejected/canceled revisions count zero.
Negative expense input, refund/payment settlement and personal posting are outside
this slice; a reversal is not a refund acknowledgement or cash movement.

## Budgets, commitments and monetary allocations

Companies owns these financial records, separately from Personal Finance and the
P4-02 equipment allocation domain. Budgets have explicit Company/context ownership,
immutable currency and explicit start-inclusive/end-exclusive civil dates/timezone.
No automatic period rollover, FX, bank balance or payroll is introduced.

Recommend **hard enforcement for each selected budget**:

`available = limit + approved limit adjustments - effective approved spending - remaining active commitments`.

Commitments reserve a positive amount through an explicit financial-manager action.
Original reservation facts are immutable; consumption/release records are append-only.
Only unconsumed reservation may be released. Terminal commitments cannot reopen.
Concurrent approval/reservation/limit changes cannot make availability negative;
lowering a limit below existing spending plus reservations is rejected.

An expense may be explicitly unbudgeted. If a budget allocation plan is supplied,
its positive same-currency parts must cover the expense exactly, with typed budget
and optional commitment references in the same Company. The reviewer must currently
manage every target. A consumed commitment moves that amount from reserved to spent,
without double counting. For limit 100, reservation 30, consuming 20 leaves spent 20,
reserved 10 and available 70. An unreserved additional spend 20 leaves available 50.
Pending expenses change neither spent totals nor reservations implicitly.

Corrections/reversals append exact budget adjustments. Reversing commitment-funded
spend restores its reservation only while that commitment remains active; released
or terminal reservations never revive. Archive denies new growth but preserves
reads and authorized historical reversal. No Company-wide mandatory-budget rule
is inferred from an individual budget's hard ceiling.

## Project context without Company attachment

Support the Phase 4 Project finance requirement through a concrete typed financial
reference to an existing independent Project, with both authorities above checked
under sorted custody locks. A budget/expense remains Company-owned; the Project,
its sources and membership stay independent. This is not P4-06 attachment/transfer.

Company financial authority never authorizes Project reads. Project IDs, titles,
links, source counts and other source metadata are disclosed only through the
Project owner's currently authorized public contract. Company-owned monetary facts
retain their financial audience. Revocation hides the Project reference, not other
people's Company financial history. Source-owner cleanup must detach the reference
through an explicit owner contract before Project disposal, retaining Company
financial facts and opaque audit evidence; a new foreign FK must not indefinitely
block existing Project lifecycle or authorize deleting Company records.

Alternative: defer Project financial activation until P4-06. This would require an
explicit sequencing amendment, rather than silently omitting the Phase 4 Project
budget requirement. The recommendation above preserves it through narrow references.

## Narrow expense receipts and exact money

Recommend receipt metadata plus **expense-bound private receipt files only**:
PDF, PNG or JPEG, at most 10 MiB each, using existing StoragePort/type/size/hash
validation, uploader/finalization checks, cancellation, cleanup and restore controls.
Use real same-Company expense/receipt/file FKs. No public URLs, generic Company
upload, staff-case document binding, knowledge-base publication, OCR or provider.
Approval pins immutable ready receipt versions/checksums. Download reauthorizes
the exact expense audience, generation and current lifecycle; receipt access is
audited with opaque IDs. No private Personal/Project/Team file may be rebound.

Reuse ADR 0017's frozen ISO code/scale authority and ADR 0016's exact arithmetic:
positive plain decimal strings, at most 18 integral digits and the currency's
0–4 fractional digits, Decimal(28,4) persistence and BigInt scaled calculations.
No numeric money, silent rounding, cross-currency allocation or combined currency
total. Store immutable currency/scale and return canonical fixed-scale strings.
Keep all Personal money contracts and data ownership unchanged.

## Preservation and implementation acceptance

Reuse current fences, verified identity, admission generations, revision/If-Match,
receipts, free-mode usage, opaque audit/outbox and signed restrictive evidence.
Amounts, currencies, vendor/payer labels, receipt filenames/bytes and staff contents
never enter generic audit/outbox/control payloads. Financial access creates no
ADR 0035 reader, staff-data hold or automatic employee-case linkage.

Departure revokes access while retaining Company-owned financial evidence under
its reviewed versioned retention policy. Personal identity erasure remains independent;
pseudonymize retained attribution rather than retaining a login identity. Invent no
legal retention period or HR/financial hold. Restored Company authorization stays
quarantined pending its separate domain reconciliation/release gates.

After approval: write the exact proposed operation/schema contract, additive reviewed
migrations and tests for this fixed matrix/state machine, receipt privacy, exact
allocation sums, reservation/correction/reversal races, both independent custody
boundaries, Project disposal, Personal erasure and immutable history. Preserve all
582 existing operations and every historical migration. Run focused tests, one
complete mandatory quality gate, sufficient affected reruns and compiled restart.
No Docker, deployment, production database change, hosted CI or Shared activation.

Owner decision: approved for local P4-03 implementation. P4-04 is not authorized.
