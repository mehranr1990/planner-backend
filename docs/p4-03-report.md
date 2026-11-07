# P4-03 local implementation report

Batch: **P4-03 — Corporate expenses, receipts, budgets, commitments and monetary allocations**.
Status: **COMPLETE for local implementation**, 2026-11-07.

Approved predecessor publication: reviewed and published only the 43 accepted P4-02
files as `02b44675d50f69eea16c1ca81656e676e448788c`; verified origin/main with
`git ls-remote origin refs/heads/main`. Fresh publication checks: 11 passed.

Scope implemented: owner-approved ADR 0036. Thirty additive APIs; 612 total operations
and 5,356 resolved OpenAPI references. Fixed draft/submitted/approved/rejected/canceled
revisions, independent named reviewers, requester/member-payer claims, immutable
corrections and reviewed reversals. Exact ISO money, optional unbudgeted expenses,
hard selected-budget ceilings, commitments and exact allocation plans. Expense-bound
private PDF/PNG/JPEG receipts, upload/finalization fencing, pinned evidence, audited
downloads and bounded cleanup. See [contract](p4-03-contract.md).

Files/modules changed: Companies finance/receipt services and controller; existing
Company authorization, signing, usage and storage infrastructure reused. Finance
exports its existing pure arithmetic. Projects exposes its independently authorized
financial-reference owner contract and disposes source bridges before its content.
Contracts, compatibility baseline, migration rehearsal, security tests and compiled
restart smoke are included. No dependency added or unrelated refactoring.

Entities, migrations and constraints: twelve new tables; additive atomic M031,
`202611070031_company_finance`, SHA-256 `2ee6190668e6f964fbcf933aad9039141f2226f67c4b08b4fccab8f2f287ad72`.
All 54 historical SQL artifacts remain byte-identical. Compound ownership/admission,
revision/file FKs; immutable history and currency-scale/state constraints; budget row
locks and nonnegative balances; seven lookup indexes. The 510-FK cleanup catalog is
reviewed. The rehearsal preserves all 157 populated predecessor datasets, 54 prior
checksums and prior constraints except the approved additive usage CHECK; rollback,
repeat deploy and all twelve populated new tables pass. See
[migration review](p4-03-migration-review.md).

Security and compatibility: explicit current root/child admissions and generations;
scoped financial readers; no requester/member-payer self-approval or Owner bypass;
reviewer reassignment, demotion, revocation and rejoin checks. Root finance roles
require explicit child admission. ADR 0035 cases stay confidential. Personal identity
erasure pseudonymizes attribution without deleting Company financial facts. Project
custody/membership stays independent; source metadata is hidden without source rights,
and Project disposal retains Company facts. All 582 predecessor APIs remain compatible.
Generic audit/outbox/control evidence excludes financial bodies and receipt metadata.
No new jobs or Personal ledger effects.

Tests and exact commands/results:

- `pnpm.cmd quality`: executed the complete 13-stage gate **once**. Raw exit 1:
  577 unit/contract/architecture/compatibility tests passed; 728/729 integration
  tests passed. The child-context finance case and migration trigger were fixed.
  The migration retry also identified a fixture timestamp omission, now corrected.
- `pnpm.cmd test:integration apps/api/test/integration/company-finance.spec.ts`:
  final **20/20 passed**, covering positive adjustments, concurrent ceilings,
  reservations, immutable corrections/reversals, receipts, authorization, erasure
  and independent Project disposal. Together with the 710 predecessor integration
  tests and 577 other tests, **1,307 distinct tests pass**; reruns are not double-counted.
- `pnpm.cmd db:migrations:check`: final **PASS**, including the complete populated
  upgrade chain and M031 preservation/recovery rehearsal.
- `pnpm.cmd test tooling/architecture-tests/company-finance-migration.spec.ts apps/api/src/platform/database/foundation.spec.ts`:
  **10/10 passed** after the SQL fix.
- `pnpm.cmd build`, `pnpm.cmd typecheck`, `pnpm.cmd db:generate`,
  `pnpm.cmd db:validate`: final affected checks **PASS**. Changed-file formatting/lint
  and `git diff --check` pass. The original full gate passed remaining checks,
  including architecture and OpenAPI; no full-suite repetition was used.
- `pnpm.cmd test apps/api/test/contract/company-finance-routes.spec.ts tooling/compatibility/openapi.spec.ts`: final **8/8 passed**; `pnpm.cmd openapi:check` **PASS**, including binary download headers and all common error schemas.
- `pnpm.cmd smoke:p4-03`: **PASS** on final SQL. A fresh compiled Node process
  preserves approved spending, reservation balances and private receipt bytes,
  enforcing financial-directory and immutable-receipt restrictions.

Tests not run: Docker, hosted CI, deployment and release-only operational/restore
acceptance are **DEFERRED**, as instructed. All database mutation was confined to
guarded local test targets and owned disposable schemas.

Deviations/blockers: no unresolved implementation deviations or owner decisions.
Remaining limits: Shared activation stays disabled. Reimbursement/payment acknowledgement
and configurable approval workflows remain P4-04; general Company files/reports and
actual Company attachment/full lifecycle reconciliation remain later batches. This
is not an accounting ledger, payment rail or production release.

Git: P4-03 is **unstaged, uncommitted and unpushed**. HEAD/origin/main remain the
P4-02 SHA above. Unrelated architecture/frontend documents, 17 protected environment,
secret/runtime artifacts and all historical migrations are preserved.

Next eligible batch: **P4-04 — NOT STARTED; separate owner authorization required**.
