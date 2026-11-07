# P4-04 local implementation report

Batch: **P4-04 — Reimbursement/payment acknowledgements and controlled financial
approval versions**. Status: **COMPLETE for local implementation**, 2026-11-07.

Approved predecessor publication: reviewed and committed exactly 41 accepted P4-03
files, pushed to origin/main and verified remote SHA
`0b5829ea0e5d753e68276f91d4f8672e34c99abf`. Fresh publication checks: **13 passed**.
Unrelated documents, protected artifacts and all historical SQL were excluded.

Scope implemented: owner-approved ADR 0037. **34 additive APIs**, **646 total
operations**, **5,696 resolved references**, with all **612** published APIs preserved.
Current named member-payer reimbursement claims; partial approval reservations;
manager-proposed payment records independently accepted/disputed by beneficiaries;
bounded two-party compensating record corrections; settled expense entitlement
adjustments and excess-acknowledgement reconciliation. No payment execution.
See [operation and state contract](p4-04-contract.md).

Controlled versions: immutable published definitions with one to five sequential,
generation-bound independent financial-manager steps, optional named alternates,
manual escalation, requester restart and immutable decisions. Reimbursement requires
a version; expense control is explicit opt-in. Legacy fixed-reviewer behavior stays
available. Selected workflows cannot be bypassed through legacy decision/reassignment.
Archived pinned definitions remain readable only to their authorized historical
parties/managers. Final approval rechecks all actual prior approving reviewers.

Files/modules: Company reimbursement and financial-approval services/controller,
with narrow transaction-local source hooks in the existing finance service. Reused
Company admission/fences, exact money, idempotency, signed paging, free-mode usage,
audit/outbox and private receipt infrastructure. Spaces owns the narrow historical
actor lookup. No new dependency, generic automation engine or unrelated refactoring.

Entities/migration: ten Company-owned tables for workflow/header/version/step,
instance/history, reimbursement bucket/request, payment assertion, correction and
append-only monetary effects. Atomic additive M032,
`202611070032_company_reimbursements_and_approvals`, SHA-256
`72a7ca37b1d49c825d98b922416385d8d022c15328e1d8d3bff19e642bbb0a96`. Concrete source/context/admission FKs,
immutable published/terminal evidence, active-instance/decision uniqueness,
exact-money/role-binding integrity and locked bucket/request balances. Current
cleanup catalog: **571 FKs**. All **55** historical SQL files are byte-identical;
only the existing usage allowlist constraint is expanded. The populated rehearsal
preserves **169** predecessor datasets and 55 checksums; rollback, repeat deploy,
all ten populated new tables and final FK catalog pass. See
[migration review](p4-04-migration-review.md).

Security/compatibility: current verified root and explicit child admission;
requester/beneficiary separation from approvers/payment authors; no Owner bypass;
current roles, generations, source fingerprints/revisions and step order rechecked.
Private write denials conceal unrelated financial IDs. Scoped managers retain
independent history; ordinary members receive no financial directory. ADR 0035
case confidentiality, Personal identity erasure, independent Project/Team custody,
existing budget effects and private receipt contracts remain intact. Settled source
changes retain acknowledged evidence, invalidate unused old authority and never
revive closed reservations. Currency buckets never combine or perform FX. Generic
evidence excludes external-payment references, amounts and staff payloads. No new jobs.

Tests and exact commands/results:

- `pnpm.cmd quality`: complete mandatory **13-stage gate executed once, exit 0**;
  **584/584** unit/contract/architecture/compatibility tests and **750/750** integration
  tests passed, including full populated migration/constraint preservation.
- Final privacy review added guarded write denials and pinned archived-version reads.
  `pnpm.cmd test:integration apps/api/test/integration/company-settlements.spec.ts apps/api/test/integration/company-finance.spec.ts`:
  **41/41 passed** on final source (21 settlement and 20 existing finance tests),
  including observed revoke-versus-approve locking, competing partial approvals and
  assertions, corrections/reversals, private counts/history, staff-case separation,
  identity erasure, child authorization and published-version immutability.
- **1,335 distinct tests pass** across the complete gate and affected checks;
  overlapping reruns are not double-counted. No full-suite repetition or weakened tests.
- `pnpm.cmd build`, `pnpm.cmd typecheck`: final affected checks **PASS**.
  Changed-file formatting/lint and `git diff --check` pass. Full-gate architecture
  and OpenAPI compatibility pass; no dependency boundary or published schema changed
  during the final privacy fixes.
- `pnpm.cmd smoke:p4-04`: **PASS** after fresh compiled Node-process restart,
  including partial acknowledgements, two-party correction, immutable receipts,
  unchanged expense budgets, stale-confirmation denial and claimant reads of an
  archived pinned version. The smoke respects the existing durable per-minute
  limiter by waiting for its next window; no throttle was disabled or weakened.

Tests not run: Docker, hosted CI, production deployment and release-only operational
acceptance remain **DEFERRED** as instructed. All database mutation used guarded
local test targets/owned disposable schemas; no application database reset.

Deviations/blockers: no unresolved implementation deviations or owner decisions.
Remaining limits: acknowledgement/correction is a record, not money movement;
no provider, payroll, billing, automatic Personal posting, mandatory Company-wide
workflow policy or automatic escalation timers. Shared activation stays disabled;
Company domain restore/reconciliation and release remain separately gated.

Git: P4-04 is **unstaged, uncommitted and unpushed**. HEAD/origin/main remain the
published P4-03 SHA above. Unrelated architecture/frontend documentation and all
17 protected environment/secret/runtime artifacts are preserved.

Next eligible batch: **P4-05 — NOT STARTED; separate owner authorization required**.
