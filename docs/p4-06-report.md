# P4-06 implementation checkpoint and Phase 4 local status

**Historical checkpoint:** the original progress evidence below is preserved.
The owner subsequently approved scope deferral in [ADR 0043](adr/0043-company-transfer-deferral-and-stabilization.md).
Current scope, verification and acceptance are recorded in the
[final stabilization report](p4-06-final-report.md); old partial-status, manifest
counts and unfinished-transfer acceptance statements below describe earlier work.

Batch: **P4-06**. Status: **PARTIAL; transfer execution remains unfinished**.
Checkpoint: 2026-11-08. ADRs 0039, 0040, 0041 and 0042 are approved for local implementation. Their original product
and architecture questions are resolved. This is a progress checkpoint, not final
P4-06 acceptance. P4-06 remains unstaged, uncommitted and unpushed.

## P4-05 publication

- Reviewed exactly the 43 files in `.tools/p4-05-change-manifest.json` against
  the affected source/contracts, ADR 0038 and completion evidence. Every file
  matched `.tools/p4-05-final-evidence.json`; all 56 predecessor SQL artifacts
  and 17 protected artifacts matched their recorded SHA-256 values.
- Commit on main: `a33aa9c8e1d705521923fbe1653ecbca1f0af076`.
  `git push origin main` succeeded. A separate subsequent
  `git ls-remote --heads origin refs/heads/main` returned the same complete SHA
  as `git rev-parse HEAD`. Parent:
  `ed9dc2f7697d220808867a6eec65f11b4b8385db`.
- Retained evidence confirms all 13 quality stages executed once: 591 tests in
  122 non-integration files and 770 tests in 38 integration files, **1,361 passing**.
  The original aggregate exit 1 is retained. Its sole typecheck error was the
  smoke header assertion; the corrected final file hash matches, and the saved
  `pnpm.cmd typecheck` rerun exited 0. No second full gate was run.
- Saved `pnpm.cmd db:migrations:check` evidence includes 179 populated predecessor
  datasets, 56 checksums, interrupted rollback/redeploy and immutable knowledge
  evidence/584-FK checks. Saved final `pnpm.cmd smoke:p4-05` exited 0, exercising
  a fresh compiled child process and durable bytes/history/reports/export/audit.
- Fresh publication check:
  `pnpm.cmd test packages/api-contracts/src/company-knowledge.spec.ts apps/api/src/modules/companies/domain/company-export.spec.ts apps/api/test/contract/company-knowledge-routes.spec.ts tooling/architecture-tests/company-knowledge-migration.spec.ts tooling/compatibility/openapi.spec.ts`
  **PASS: 15 tests / 5 files, exit 0**. The first sandboxed attempt stalled and
  was interrupted without a result; the successful run used the unrestricted
  execution context. `git diff --check` and `git diff --cached --check` passed.
  The index was verified against all 43 exact paths and evidence hashes before
  committing; no unrelated file was included.
- P4-05 adds 20 APIs (666 total), three knowledge entities and M033, checksum
  `dd0578829944930aab32b124b40315c500b9ba5f05ba8e8130cb00fe486f627a`.
  Its [accepted contract](p4-05-contract.md), [migration review](p4-05-migration-review.md)
  and [completion report](p4-05-report.md) describe its local acceptance. Their
  original uncommitted status records describe the earlier completion checkpoint;
  this publication record supersedes that Git status only.

## Implemented scope and exact manifest

The [exact manifest](p4-06-change-manifest.json) lists all 117 current P4-06 paths.
It excludes the 12 unrelated pre-existing untracked documents and ignored local
logs/scripts/runtime artifacts. No dependency was added.

- Company archive/restore, Owner-only handover and sole-custodian closure through
  existing verified lifecycle, succession, recovery, retention and signed fences.
  Archived Company data remains readable under current authorization; writes are
  denied. Restore advances context epochs and invalidates stale relationships.
- Company disposal consumer, registered in the worker, using current lease,
  deadline, hold, approved policy and exact FK-catalog safeguards. It delegates to
  source owners, purges Company-owned files across its contexts, and removes
  Company-owned relationships without deleting independently owned sources.
- Bilateral Company association and separate attachment request/acceptance;
  independent source ownership, explicit Department/Unit admission, at most one
  active Company association per source, revocation and attachment-only detach.
  Owner/admission generations and lifecycle epochs fence stale actions and pages.
- Scope-specific authority lookup and preparatory Task/Goal/Calendar/work-metric
  owner ports. Company root or sibling proofs cannot satisfy another scope.
  Goal-to-Task linking validates the Task through its owner facade and revision.
  These changes do not enable Company-child custody by themselves.
- Approved ADR 0041 response union and exact normalization of only nine successful
  Project/Team metadata response locations. Old variants, every baseline file,
  requests and security contracts are preserved. Negative mutation tests cover
  both branches, neighboring fields and unrelated permissions.
- Scoped Company/domain locators and custodian hints; separate retained role
  catalogs and current Company-root admission floors; Team work, capacity,
  case/disclosure and meeting ports use explicit source scopes. Historical
  audience lookup requires the exact current admission generation and an APPLIED
  transfer witness; aliases alone issue no authority. No alias data was migrated.
- Owner graph facades for Projects, Teams, Tasks, Goals, Calendar, notifications
  and files. Private row bodies are hashed inside PostgreSQL; coordination gets
  only keys/hashes. File snapshots reject unresolved uploads. Graph primitives
  preserve independently owned incoming rows and alter only selected locators.
  The bounded graph limit is 2,000 rows; this is not an executable transfer API.
- Assignment commands, personal work/Goal projections, inbox reads and private
  block links resolve the actual custody and exact source scope. Historical
  assignment audiences require the exact consented admission generation. New
  recipients still require current explicit admission IDs; aliases do not admit.
- Grant offers and membership invitations retain source role catalogs, use
  scoped persistence and require an already accepted Company-root admission for
  a Company-child recipient. Explicit acceptance binds the current root generation;
  neither operation creates Company membership. Delegation checks use the scoped
  Owner and current issuer root binding. Root/sibling offer reads are denied.
- Project activity and file metadata use physical custody plus the stable Project
  scope. Current scoped/resource authorization precedes historical comment-author,
  notification-recipient and completed-upload attribution lookup. Personal-to-Project
  conversion explicitly rejects a Company-child destination; its independent
  conversion contract is preserved.

## Entities, migrations, APIs and jobs

Two typed source-owned association entities: `ProjectCompanyAssociation` and
`TeamCompanyAssociation`. Both preserve independent roots and explicit owner,
admission, epoch, revision and relationship-state snapshots. M035 adds 24 FKs,
bringing the catalog from 584 to **608**; partial unique indexes enforce one
active Company association and triggers protect consent identity/revisions.

M036 adds five protocol entities: `CompanyCustodyTransfer`,
`CompanyCustodyConsent`, `DomainScopeCustody`, `DomainScopeActorAlias` and
`DomainScopeAdmissionAlias`, with **28 additional FKs / 636 total**. M037 adds
scope columns to Team plans/work items/case entries/disclosures/meetings, a
source-scope column to work items, and scope/origin metadata to shared audit,
outbox and usage. Thirteen FKs are strengthened with scope keys while retaining
their existing delete behavior. Temporary backfill allowances are replaced in the
same transaction. Consent/apply guards require both current owners, affected
participants, current destination admissions, retained roles, fresh verification,
and a completed atomic migration before an APPLIED receipt can commit.

| Additive migration                   | SHA-256                                                            |
| ------------------------------------ | ------------------------------------------------------------------ |
| `202611070034_company_lifecycle`     | `0a455f5a274e3b199c41326f12857d73f518f5d8a4f542c304588dbb26401828` |
| `202611070035_company_associations`  | `b9a5013c215b65b52e0b139f1d6235deb3a3973ccc9776fffe5c148a3577e154` |
| `202611070036_company_scope_custody` | `206f57105860e51332de6406529fb20f35fdf5ca03fe124c93bbd560986f721f` |
| `202611080037_domain_scope_keys`     | `9f0b3c678103554086a065a07f0af8347557f2167e866d9bea8db993d317aa74` |

M034 extends existing controlled purge authorization to Company, requires a
current full root admission for its last-custodian check, and permits protected
Company-history deletion only inside authorized disposal. No retention duration
or production policy was introduced. Both migrations were applied only to local
test namespaces/databases. All **57 published SQL artifacts remain unchanged**.
During development an M035 delimiter-generation error rolled back transactionally;
the absence of its effects was checked before resolving only that failed test
attempt as rolled back and deploying the corrected artifact. No reset/schema
push or historical migration rewrite was used.

There are **20 additive APIs, 686 total OpenAPI operations**. All frozen files
remain unchanged. Only ADR 0041's exact nine response unions are normalized for
historical hash comparison; their original branch and all other contract fields
are checked against the original signatures. No ADR 0042 variant is implemented.
Routes use the existing `/api/v1` prefix:

```text
POST /companies/{id}/archive
POST /companies/{id}/restore
POST /companies/{id}/delete
GET  /companies/{id}/status
POST /companies/{id}/ownership-handovers
GET  /companies/{id}/ownership-handovers/{handoverId}
POST /companies/{id}/ownership-handovers/{handoverId}/accept
POST /companies/{id}/ownership-handovers/{handoverId}/decline
POST /companies/{id}/ownership-handovers/{handoverId}/revoke
GET  /companies/{id}/lifecycle-job
POST /companies/{id}/lifecycle-job/recovery-proof
POST /companies/{id}/lifecycle-job/recover
POST /companies/{id}/contexts/{scopeId}/associations
GET  /companies/{id}/contexts/{scopeId}/associations
GET  /companies/{id}/contexts/{scopeId}/attachments
POST /companies/{id}/contexts/{scopeId}/associations/{kind}/{target}/accept
POST /companies/{id}/contexts/{scopeId}/associations/{kind}/{target}/attachment-requests
POST /companies/{id}/contexts/{scopeId}/associations/{kind}/{target}/attachment-requests/accept
POST /companies/{id}/contexts/{scopeId}/associations/{kind}/{target}/revoke
POST /companies/{id}/contexts/{scopeId}/associations/{kind}/{target}/detach
```

The contract sources are [lifecycle](../packages/api-contracts/src/company-lifecycle.ts)
and [associations](../packages/api-contracts/src/company-associations.ts).
Existing durable lifecycle jobs, opaque audit/outbox, receipts and usage are
reused. Transfer protocol entities exist, but no public executable whole-root
transfer workflow or guarded complete graph migration exists yet.

## Latest affected verification (2026-11-08)

These runs overlap the earlier checkpoint evidence below; do not add their test
counts into a purported full-suite total.

- `pnpm.cmd test tooling/compatibility/company-custody-responses.spec.ts tooling/compatibility/openapi.spec.ts`:
  **12 tests / 2 files PASS**, `.tools/p4-06-adr41-tests-2.log`.
  The first run caught a Team schema required-field ordering change; restoring
  the original omit/extend shape fixed it without changing any baseline.
- `pnpm.cmd test tooling/architecture-tests/company-custody-migration.spec.ts tooling/compatibility/company-custody-responses.spec.ts apps/api/src/platform/database/foundation.spec.ts`:
  **12 tests / 3 files PASS**, `.tools/p4-06-custody-foundation-tests.log`,
  before the subsequently added M037-specific architecture assertion.
- `pnpm.cmd test:integration apps/api/test/integration/custody-graph.spec.ts apps/api/test/integration/project-core.spec.ts apps/api/test/integration/team-work.spec.ts`:
  **47 tests / 3 files PASS**, `.tools/p4-06-custody-owner-tests.log`.
- `pnpm.cmd test:integration apps/api/test/integration/team-work.spec.ts apps/api/test/integration/team-interactions.spec.ts apps/api/test/integration/team-analytics.spec.ts`:
  **62 tests / 3 files PASS**, `.tools/p4-06-team-scope-integration.log`.
- `pnpm.cmd test:integration apps/api/test/integration/company-lifecycle.spec.ts`:
  **16 tests / 1 file PASS**, `.tools/p4-06-company-scope-regression.log`.
  Its new disposal-fence test was strengthened to assert the exact missing-owner
  consent error with a correctly hashed preview; the affected filtered rerun
  **1 PASS / 15 filtered** is in `.tools/p4-06-custody-guard-test.log`.
- `pnpm.cmd typecheck`: PASS, `.tools/p4-06-team-source-types-2.log`, before the
  latest small historical-member/report binding adjustments.
- `pnpm.cmd architecture`: PASS, **504 modules / 3,244 dependencies**,
  `.tools/p4-06-scope-architecture.log`. Changed-path lint and formatting passed
  at that checkpoint; subsequent edits require affected verification.
- `pnpm.cmd openapi:generate`: PASS, `.tools/p4-06-adr41-openapi.log`.
- M036/M037 deployed successfully into fresh owned local namespaces; M037 also
  deployed during isolated integration setup. Schema/client generation passed.
  The current reviewed 636-FK digest is
  `a928cc446f7f36313cf9a0694ac0a7fe83402cf98e7489491981f096bb0eac9f`.
  Initial M037 development failures were confined to disposable namespaces and
  rolled back; a recorded failed diagnostic namespace was explicitly removed.
  No applied persistent SQL artifact was rewritten. The populated M036/M037
  preservation/rollback rehearsal subsequently passed as recorded below.

### Latest continuation checks, 2026-11-08

These checks supersede the older source checkpoints where they overlap. Counts
are per command and are not added together as a full-suite total.

- `pnpm.cmd test tooling/architecture-tests/company-custody-migration.spec.ts tooling/compatibility/company-custody-responses.spec.ts tooling/compatibility/openapi.spec.ts apps/api/src/modules/spaces/public/shared-authority.spec.ts apps/api/src/platform/database/foundation.spec.ts`:
  **25 tests / 5 files PASS**, `.tools/p4-06-current-foundation-tests.log`.
- `pnpm.cmd test:integration apps/api/test/integration/project-work.spec.ts apps/api/test/integration/project-core.spec.ts`:
  **43 tests / 2 files PASS**, `.tools/p4-06-work-scope-integration.log`.
- `pnpm.cmd test:integration apps/api/test/integration/project-collaboration.spec.ts apps/api/test/integration/shared-collaboration.spec.ts`:
  **59 tests / 2 files PASS**, `.tools/p4-06-scoped-grants-integration.log`.
  This run predates the subsequent invitation changes.
- `pnpm.cmd test:integration apps/api/test/integration/shared-collaboration.spec.ts apps/api/test/integration/company-lifecycle.spec.ts`:
  **49 tests / 2 files PASS**, `.tools/p4-06-invitation-company-regression.log`,
  after the invitation changes and before the delegation query was consolidated.
- `pnpm.cmd test apps/api/src/modules/spaces/application/scoped-attribution.spec.ts apps/api/src/modules/spaces/public/shared-authority.spec.ts`:
  **5 tests / 2 files PASS**, `.tools/p4-06-attribution-tests.log`. These cover
  wrong root/sibling/resource proofs before lookup, expired authority, exact
  current admission generations, cross-custody mappings and incomplete receipts.
- `pnpm.cmd db:migrations:check`: **PASS**, `.tools/p4-06-scope-upgrade-2.log`.
  The empty schema has 189 domain tables plus its migration ledger. The new
  populated rehearsal preserves 184 predecessor datasets and 59 existing SQL
  checksums, including all 57 published artifacts. Both new migrations are
  interrupted before commit, rolled back, applied and redeployed. Original
  columns, confidential case/response bodies and admission pairs remain exact;
  scope backfills, restored immutable guards, 13 strengthened FKs with unchanged
  delete behavior and the exact 636-FK catalog pass. The first run correctly
  failed because the predecessor fixture lacked confidential Team history; the
  fixture was populated before migration and the check rerun. No migration or
  security assertion was weakened. No actual custody transfer was executed.
- `pnpm.cmd test:integration apps/api/test/integration/project-core.spec.ts -t 'never revives issued grants'`:
  **1 PASS / 25 filtered**, `.tools/p4-06-delegation-regression.log`, after
  consolidating the delegation query. The existing demotion/promotion and
  policy-removal/repair assertions remain unchanged.
- Final affected `pnpm.cmd typecheck`: **PASS**,
  `.tools/p4-06-checkpoint-types.log`. Changed-path ESLint with
  `--max-warnings 0`: **PASS**, `.tools/p4-06-checkpoint-lint.log`.
  `pnpm.cmd architecture`: **PASS**, **504 modules / 3,245 dependencies**,
  `.tools/p4-06-checkpoint-architecture.log`.

The new transfer tables introduce joint retention dependencies. Root disposal
currently refuses any unresolved transfer evidence **before its first file pass**;
ordinary no-transfer disposal still passes. This is an explicit unfinished safety
fence, not acceptance of scoped disposal or a new retention policy. It must be
replaced by complete captured-policy reconciliation for final P4-06 acceptance.

The following earlier results describe the earlier source checkpoint. Compiled
restart evidence below predates the latest scope/model changes and must be renewed
on the final build; it is not current standalone-worker acceptance.

## Verification and practical limits

All commands below exited 0. Counts refer to these targeted runs, not a full-suite
acceptance count; earlier successful subset runs are not added again.

- `pnpm.cmd test apps/api/src/modules/spaces/public/shared-authority.spec.ts apps/api/test/contract/company-lifecycle-routes.spec.ts apps/api/test/contract/company-association-routes.spec.ts packages/api-contracts/src/company-lifecycle.spec.ts packages/api-contracts/src/company-associations.spec.ts tooling/architecture-tests/company-lifecycle-migration.spec.ts tooling/compatibility/openapi.spec.ts`:
  **18 tests / 7 files PASS**. Evidence: `.tools/p4-06-targeted-final-partial.log`.
- `pnpm.cmd test:integration apps/api/test/integration/project-core.spec.ts apps/api/test/integration/team-work.spec.ts apps/api/test/integration/company-lifecycle.spec.ts`:
  **60 tests / 3 files PASS**, including 15 Company lifecycle/association tests.
  Evidence: `.tools/p4-06-scope-regression.log`. Isolated local PostgreSQL only.
- `pnpm.cmd typecheck`: PASS, `.tools/p4-06-scope-types-final.log`.
- `pnpm.cmd build`: PASS, `.tools/p4-06-build-current.log`.
- `pnpm.cmd architecture`: PASS, 497 modules / 3,197 dependencies;
  `.tools/p4-06-architecture-current.log`.
- ESLint on changed TypeScript paths with `--max-warnings 0`: PASS,
  `.tools/p4-06-lint-current.log`. Prettier on affected paths and
  `git diff --check`: PASS; unrelated documents are excluded.
- `pnpm.cmd db:migrations:check`: PASS, `.tools/p4-06-migrations-3.log`.
  Empty deployment expects 185 tables including the migration ledger. Populated
  P4-06 rehearsal preserves 182 predecessor datasets, all 57 published checksums
  and old constraints except the reviewed additive usage CHECK. It exercises
  interrupted rollback, redeployment, repeat deploy, two populated association
  tables, immutability/uniqueness and the exact 608-FK catalog. Subsequent changes
  to owner ports did not change these migrations or rehearsal inputs.
- `pnpm.cmd smoke:p4-06`: PASS after the latest build,
  `.tools/p4-06-smoke-current.log`. A new process imports the compiled API and
  Company cleanup consumer, verifies retained archive state, stale attachment
  invalidation after restore, metadata revocation, preserved independent Project
  custody and resumption of durable Company disposal. This tests the compiled
  consumer; it does not claim standalone notification-worker startup coverage.
- Final preservation check: published HEAD unchanged, index empty, all **74**
  baseline hashes match (57 SQL plus 17 protected files, including the unrelated
  documents and local environment files). No environment values were published.

Security coverage includes Owner versus Org Admin powers, handover without
implicit child membership, wrong Company/context IDs, inaccessible listing
filters, bilateral authorization, cardinality, departure/replay, lifecycle epochs,
recovery proof generations, independent Team/Project preservation, immutable
knowledge and approved finance disposal, operator holds, unknown-FK fail-closed
behavior, concurrent proposals and an independently observed PostgreSQL
revoke-before-approval race with no late effect. Current historical response
compatibility remains exact. Preparatory scope tests prove root/sibling denial,
physical-space versus logical-source resolution and transaction/parent lifetime.

**NOT RUN:** final `pnpm.cmd quality` (all 13 mandatory stages), complete P4-06
suite, actual transfer migration/consent/privacy/concurrency/recovery tests and
standalone worker startup smoke. They remain mandatory before final acceptance.
The full gate has not been consumed on an unfinished implementation.

## Unfinished scope and required decision

The approved ADR 0040 guarded graph relocation, executable actor/admission
mappings and historical-actor representation, public participant consent/preview/
apply workflow, remaining lifecycle/handover/source-role ports, scoped
lifecycle/disposal, captured retention aggregation and
restrictive signed retirement/recovery remain unfinished. Actual custody transfer
is not exposed. None of this required work is silently deferred or accepted.

ADRs 0041 and [0042](adr/0042-company-custody-portfolio-source-identifiers.md)
are approved and their narrow amendments are implemented:
Team portfolio/dashboard sources currently contain only kind, Space ID and summary.
Two Projects transferred to one Company would lose their distinct source IDs.
The recommendation adds scopeId only to a Company-custodial source response
variant at those two response locations, retaining every old field/branch and all
request/permission contracts. Fourteen targeted compatibility tests passed,
including branch, summary, surrounding array, status, request and security
mutations; 17 existing Team analytics integration tests also passed. Evidence:
`.tools/p4-06-adr42-tests.log` and `.tools/p4-06-adr42-team-analytics.log`.
OpenAPI generation passed without changing old baseline files. No owner decision
on these recorded contracts remains pending.

## Consolidated Phase 4 local acceptance

The earlier counts below are the existing reports' distinct acceptance counts,
not fresh runs in this session and not additive across batches.

| Batch | Reported local scope/status                                                             | Recorded passing tests                                              | Published commit                           |
| ----- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------ |
| P4-01 | Company foundation/roles/policies: COMPLETE local                                       | 1,247                                                               | `6a217535b848d68adeef916cff3cbe3f02b4faa2` |
| P4-02 | Staff/cases/availability/equipment: COMPLETE local                                      | 1,280                                                               | `02b44675d50f69eea16c1ca81656e676e448788c` |
| P4-03 | Expenses/budgets/receipts: COMPLETE local                                               | 1,307                                                               | `0b5829ea0e5d753e68276f91d4f8672e34c99abf` |
| P4-04 | Reimbursement/controlled approvals: COMPLETE local                                      | 1,335                                                               | `ed9dc2f7697d220808867a6eec65f11b4b8385db` |
| P4-05 | Knowledge/reports/exports: COMPLETE local and published/remote verified in this session | 1,361; fresh publication checks 15                                  | `a33aa9c8e1d705521923fbe1653ecbca1f0af076` |
| P4-06 | Lifecycle/association/attachment, scope ports and protocol foundations: PARTIAL         | Targeted checks recorded above; overlapping runs; full gate NOT RUN | Uncommitted                                |

Source reports: [P4-01](p4-01-report.md), [P4-02](p4-02-report.md),
[P4-03](p4-03-report.md), [P4-04](p4-04-report.md), [P4-05](p4-05-report.md).
**Phase 4 local acceptance is incomplete until P4-06 is implemented and verified.**
No Phase 5 work was started.

Production limitations: Shared activation remains disabled. No Docker, deployment,
production database changes or release-only activation checks. Hosted CI, actual
operational restore/backup, infrastructure and applicable legal/policy acceptance
remain deferred under the existing release gates; local completion is not launch
authorization.

Git: P4-05 alone committed and pushed. P4-06 changed/new paths are listed in the exact
manifest, all unstaged, uncommitted and unpushed. The 12 pre-existing untracked
files under `docs/architecture/` and `docs/frontend-handoff/` remain untouched.
Index empty; HEAD remains `a33aa9c8e1d705521923fbe1653ecbca1f0af076` on main.
Ignored local review scripts/logs are not deliverable source changes.

Next allowed action: continue the already-authorized local
P4-06 implementation and its final acceptance. Phase 5 is **NOT STARTED and NOT
AUTHORIZED**. No P4-06 commit/push, production activation or deployment is authorized.
