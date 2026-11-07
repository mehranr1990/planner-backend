# P4-05 completion report

Batch: **P4-05**. Status: **COMPLETE for the approved local implementation scope**.
Authority: V3 batch roadmap and owner-approved ADR 0038. Next eligible batch:
**P4-06 — NOT STARTED; requires separate authorization**.

- **Prior publication:** reviewed and committed only the accepted 36 P4-04 files;
  pushed to origin/main and independently verified remote SHA
  `ed9dc2f7697d220808867a6eec65f11b4b8385db`. Fresh publication checks passed
  14 tests. Unrelated documentation, secrets, environments, runtime artifacts and
  historical migrations were preserved.
- **Scope implemented:** Company private knowledge folders/documents, immutable
  published file versions and authorized metadata search; operations/capacity,
  exact financial and independently authorized Project portfolio reports; bounded
  inline JSON/CSV exports and scoped redacted audit views.
- **Files/modules:** Companies knowledge/file/report services and controller;
  Zod/OpenAPI contracts; narrow Projects-owned report/financial-reference facade;
  Spaces authorization/audit/export-limit coordination; existing SharedFiles
  cleanup filtering. Reused StoragePort, exact money, signed pages, generation
  fences, revisions, receipts, audit/outbox and usage. No new dependency/provider.
- **Entities/migration/constraints:** three entities — CompanyKnowledgeFolder,
  CompanyKnowledgeDocument, CompanyKnowledgeVersion. One additive M033 migration;
  compound ownership/admission/file FKs, publication/hash pinning, immutable
  published history/bytes, bounded cycle-free folder hierarchy. Thirteen new FKs,
  **584 total**. All **56 historical SQL artifacts** retain their accepted bytes.
  Details: [migration review](p4-05-migration-review.md).
- **APIs/events/jobs:** **20 additive APIs**, **666 total operations**, preserving
  every accepted P4-04 and earlier API signature. Knowledge writes use existing
  opaque audit/outbox and free-mode usage; export publication and sensitive file/
  report reads use existing access audit. No new job, export artifact or payment
  execution. Details: [API contract](p4-05-contract.md) and [OpenAPI](api/openapi.json).
- **Security:** explicit current root/child admission and manager ceilings;
  current-generation upload finalization; ordinary readers cannot enumerate draft
  metadata/history; archived subtree and stream-open revocation checks; pinned
  immutable bytes; independent Project access under shared sorted fences; exact
  currency buckets; scoped CSV/JSON limits and formula-safe cells; staff cases,
  contacts and confidential payloads excluded from general audit/exports.
  Publisher erasure preserves pseudonymous Company knowledge without blocking
  independent Personal erasure. Company role never grants Project/Team custody.

Verification commands/results:

- `pnpm.cmd quality`: mandatory **13-stage run executed once**. Configuration,
  generation/auth schema, schema validation, build, formatting, lint, architecture,
  unit/contract/architecture/compatibility, OpenAPI, integration and migration
  stages passed. **591 tests in 122 files + 770 integration tests in 38 files =
  1,361 passing tests**, including 26 new tests. Typecheck initially found a
  possibly absent smoke response header; the strict assertion was corrected.
  The aggregate command retained exit 1 for that initial failure.
- `pnpm.cmd typecheck`: affected rerun **PASS, exit 0**. No second full gate.
- `pnpm.cmd test packages/api-contracts/src/company-knowledge.spec.ts apps/api/src/modules/companies/domain/company-export.spec.ts apps/api/test/contract/company-knowledge-routes.spec.ts tooling/architecture-tests/company-knowledge-migration.spec.ts tooling/compatibility/openapi.spec.ts`:
  focused **15/15 PASS** before the gate; all included in the final full run.
- `pnpm.cmd test:integration apps/api/test/integration/company-knowledge.spec.ts`:
  targeted development coverage; final full gate includes **19/19 PASS**, including
  observed revocation before export, publication concurrency, private history,
  scoped managers, idempotency, exact reports and publisher erasure.
- `pnpm.cmd db:migrations:check`: **PASS in the full gate**. M033 preserves all
  179 predecessor table datasets, including populated financial/approval history,
  56 checksums and previous constraints except the additive usage CHECK. Interrupted
  rollback, repeated deployment, populated new tables, immutable file/version
  guards and the exact 584-FK catalog passed in guarded local test schemas.
- `pnpm.cmd smoke:p4-05`: **PASS against the final compiled build**, with a fresh
  child process and durable knowledge bytes/versions, exact budget variance,
  planning, independent Project portfolio, export and audit. Existing durable
  request limits were retained across restart.
- Scoped formatting/lint and `git diff --check`: **PASS**. Final preservation
  checks retain unrelated file hashes and historical migration bytes; index empty.

Tests not run: Docker, hosted CI, deployment and release-only operational/legal
acceptance remain **DEFERRED** as instructed. Only local PostgreSQL was used;
no production database was modified or reset.

Deviations from binding specifications: **none**. Outstanding blockers/ADRs:
**none for this accepted local scope**.

Limitations: metadata search only; no extraction/OCR or new search service.
Reports are live, explicitly scoped views. Reimbursement columns are current
source-bucket balances rather than historical cash flow. No implicit cross-context
aggregation, Team attachment/portfolio, retained export archive or Company lifecycle
activation. Company restoration/disposal remains quarantined for P4-06. No
attachment/transfer, ownership handover, integrations, payroll, billing or payments.
Shared activation remains disabled.

Git: **P4-05 remains unstaged, uncommitted and unpushed**. Only P4-04 was committed
and pushed. No deployment. Stop before P4-06.
