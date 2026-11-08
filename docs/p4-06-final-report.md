# P4-06 local stabilization acceptance

Batch: **P4-06**. Status: **COMPLETE for the approved LOCAL scope**, 2026-11-08.
Approved scope: [ADR 0043](adr/0043-company-transfer-deferral-and-stabilization.md).
Actual Company-child custody transfer is deferred and unreachable. This report
supersedes status statements in the preserved [development checkpoint](p4-06-report.md).
P4-06 remains unstaged, uncommitted and unpushed.

Company lifecycle and independent affiliation are accepted locally under ADR 0043.
The initial M031 baseline blocker was resolved for this acceptance by the owner's
explicit approval of a separate, newly created verified test database. The legacy
database remains unchanged, with its drift recorded in the
[preserved incident and resolution](p4-06-migration-ledger-blocker.md). No historical
SQL, existing ledger row or pre-existing source data was repaired, rewritten or
deleted. Actual custody transfer remains deferred and unreachable.

## Implemented behavior

- Company Owner/eligible Org Admin archive and restore; Owner-only verified
  handover, accepted succession, sole-custodian closure, generation-bound recovery
  and policy/hold/deadline-governed disposal. Parent restore preserves separately
  archived child state. Stale admissions, grants, relationships and receipts fail.
- Bilateral independent Project/Team association, separately bilateral attachment,
  detach and revocation, with one active Company association per source and an
  explicit valid Department/Unit. Both approving Owners require current Company
  and context admissions. Other source members need no Company membership.
- Current source/resource authorization remains mandatory for listing and every
  source operation. Association/attachment never transfers custody, enrolls source
  members, grants Company members source access or exposes confidential history.
- Company cleanup is registered in the worker and delegates through owner facades;
  exact FK catalog, current leases, signed recovery controls and approved retention
  remain mandatory. Independent Project/Team data, Personal data, cross-Team
  references, original history and files remain independently owned.
- Preserved preparation: strict scope-aware authority, source-owner graph ports,
  admission/provenance schema, bounded hashed snapshots, scoped cleanup contracts,
  restrictive retirement replay and ADR 0041/0042 compatibility expansions.
  These are not acceptance of executable transfers or transferred-child lifecycle.
  No source graph or historical actor/admission has been migrated.
- Stabilization preserves the unresolved-transfer-evidence disposal fence before
  any file pass. Forged historical actors and child cleanup jobs fail closed.
  No new dependency, retention period or production policy was introduced.

## Files, APIs, schema and migrations

The [exact changed-file manifest](p4-06-change-manifest.json) excludes the 12
pre-existing unrelated documents and ignored local runtime/evidence files.
Affected modules: Companies, Spaces, Projects, Teams, Tasks, Goals, Calendar,
Notifications, shared lifecycle/storage/database, API contracts and verification.
ADRs 0039–0042 remain preserved; ADR 0043 and additive roadmap/spec notes record
the approved execution deferral.

**20 additive HTTP APIs; 686 total OpenAPI operations, 6,096 references.**
Twelve lifecycle routes and eight association/attachment routes are enumerated in
the checkpoint and generated [OpenAPI](api/openapi.json), with source contracts
[lifecycle](../packages/api-contracts/src/company-lifecycle.ts) and
[affiliation](../packages/api-contracts/src/company-associations.ts).
There are no Company custody preview/consent/apply routes or transfer executor.
Existing Project/Team association responses remain INDEPENDENT after affiliation.
ADR 0041/0042 Company variants are preserved preparatory contracts, unavailable
through these independent workflows. Frozen baseline files are unchanged.

New entities: `ProjectCompanyAssociation`, `TeamCompanyAssociation`,
`CompanyCustodyTransfer`, `CompanyCustodyConsent`, `DomainScopeCustody`,
`DomainScopeActorAlias`, `DomainScopeAdmissionAlias`. The last five are dormant
protocol preparation, not an activated transfer feature. Existing durable
lifecycle jobs, audit/outbox, receipts and usage are reused. No new transfer job.

| Additive SQL artifact                        | SHA-256                                                            |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `202611070034_company_lifecycle`             | `0a455f5a274e3b199c41326f12857d73f518f5d8a4f542c304588dbb26401828` |
| `202611070035_company_associations`          | `b9a5013c215b65b52e0b139f1d6235deb3a3973ccc9776fffe5c148a3577e154` |
| `202611070036_company_scope_custody`         | `206f57105860e51332de6406529fb20f35fdf5ca03fe124c93bbd560986f721f` |
| `202611080037_domain_scope_keys`             | `9f0b3c678103554086a065a07f0af8347557f2167e866d9bea8db993d317aa74` |
| `202611080038_scoped_lifecycle_jobs`         | `c4058a9c2837a45bf5c0b4d776ec0fc3ed22163dd429cdf7e73c122d46f46aef` |
| `202611080039_company_domain_representation` | `b5f27c948f77767c8c7cd66088eff98c3d80fefb007d0c13e577f77c9500714b` |

All six SQL artifacts are retained unchanged during stabilization; all 57 published
SQL artifacts are unchanged. M035 adds 24 FKs, M036 adds 28, M037 strengthens 13
with the original delete behavior, M039 adds one captured Company-policy FK.
Final catalog: **637 FKs**, digest
`bbf94845b1b140596b78a9de21c5de20dc7b830afd0dc79798089b39992111f1`.
M039 expands historical-actor/domain representation with deferred integrity and
disposal-witness guards; independent root mutation guards remain intact.

## Verification

`pnpm.cmd quality` executed **all 13 stages once**, raw exit **1**, retained in
`.tools/p4-06-quality.log`. No second full gate or successful full-suite repeat
was run. The initial gate had three failing stages; affected reruns resolve only
their failures. All 13 command-level requirements are satisfied by the original
run and affected reruns. The owner's separately approved canonical database now
also satisfies the independent checksum/catalog acceptance requirement below.

| Stage               | Full-run evidence / affected result                                                  |
| ------------------- | ------------------------------------------------------------------------------------ |
| config:check        | PASS                                                                                 |
| db:generate         | PASS                                                                                 |
| auth:schema:check   | PASS                                                                                 |
| db:validate         | PASS                                                                                 |
| build               | PASS                                                                                 |
| typecheck           | PASS; final affected rerun PASS                                                      |
| format:check        | PASS; final affected documentation check recorded separately                         |
| lint                | PASS; final changed compatibility/smoke files PASS                                   |
| architecture        | PASS, 504 modules / 3,246 dependencies                                               |
| test                | 612 passed / 1 timed out, 132 files; affected compatibility 24/24 PASS               |
| openapi:check       | Initial stale snapshot; regenerated, affected check PASS                             |
| test:integration    | **795/795 PASS, 41 files**, including all 20 Company lifecycle/affiliation scenarios |
| db:migrations:check | PASS after the M039 verifier correction; direct native process exit 0                |

The final non-integration suite contains **623 cases**: 599 unchanged cases already
passed in the full run plus 24 current compatibility cases passed in the affected
rerun. Splitting the original negative-mutation loop adds ten case names without
dropping any assertion. Alongside 795 integration cases, this is **1,418 passing
test cases across the full run and affected rerun**, not a sum of overlapping runs.
The subsequent 40 affected integration tests on the approved baseline overlap
these 795 cases and are not added to the distinct total.

Fresh compiled API and actual worker restart smoke passed in a new disposable
local test database. Additional targeted/checkpoint evidence:

- `pnpm.cmd test:integration apps/api/test/integration/company-lifecycle.spec.ts`:
  18 existing tests passed; two new fixtures initially failed for missing
  `kind: MEMBERSHIP`. Corrected fixture; affected rerun **2 passed / 18 filtered**.
- `pnpm.cmd typecheck`: PASS, including the final affected rerun after compatibility
  test partitioning and the final verifier change;
  `.tools/p4-06-final-types-2.log`. Affected ESLint passed with zero warnings,
  `.tools/p4-06-final-affected-lint.log` and
  `.tools/p4-06-final-migration-verifier-lint.log`.
- Initial stabilization migration rehearsal failed a nondeterministic negative
  fixture: its hard-coded lifecycle generation collided with an existing job,
  masking the intended domain-proof rejection. Selecting the next unused generation
  preserves the exact security-error assertion; the full gate subsequently passed
  M038. Its M039 verifier then encountered PostgreSQL's explicit NOT NULL catalog
  entries for the two approved cleanup-pointer nullability changes. The verifier
  now checks precisely those two removals, the retained live-provenance CHECK and
  exact column nullability while keeping every other old constraint/FK check.
  No migration SQL or runtime safeguard changed. The affected rerun completed all
  assertions, but PowerShell stderr redirection returned 1 without retaining the
  native exit code after a pg deprecation warning. A direct native capture of the
  migration stage was therefore necessary: **exit 0**,
  `.tools/p4-06-final-migrations-native.log` and
  `.tools/p4-06-final-migrations-result.json`. No full quality rerun occurred.
  M034/M035 preserve 182 predecessor datasets and 57 published checksums;
  M036/M037 preserve 184 datasets and 59 prior checksums; M038 and M039 each
  preserve 189 datasets with 61 and 62 predecessor checksums respectively.
  Forced interrupted rollback restores data, constraints and functions; repeat
  deployment, scope backfills, immutable confidential history and all 637 FKs pass.
  These rehearsals use pristine owned schemas and do not reconcile old M031 drift.
- P4-05 remote SHA independently rechecked with `git ls-remote --heads origin
refs/heads/main`: `a33aa9c8e1d705521923fbe1653ecbca1f0af076`, equal to local HEAD.
  Initial restricted-network read failed; unrestricted read-only retry succeeded.
- `pnpm.cmd test tooling/compatibility/company-custody-responses.spec.ts tooling/compatibility/openapi.spec.ts`:
  **24 tests / 2 files PASS** after partitioning the original 27 negative response
  mutations into per-operation tests. All mutation, baseline and unrelated-security
  assertions remain; no timeout was increased.
- `pnpm.cmd openapi:generate` and affected `pnpm.cmd openapi:check`: PASS after
  refreshing the stale generated document; all old frozen signatures are retained.
- `node --env-file=.env.test.local tooling/scripts/p4-06-worker-smoke.ts`: PASS,
  `.tools/p4-06-stabilization-worker-smoke.log`. Two real compiled `worker.js`
  processes start/stop/restart around a durable closure; the restarted registered
  queue consumer completes Company disposal. Fresh compiled API preserves archive,
  restore fencing, revocation and independent Project custody. The smoke owns a
  newly created disposable database; configured databases remain intact.

**NOT RUN / DEFERRED:** real transfer preview/consent/apply, participant/history
migration and transferred-child lifecycle execution tests under ADR 0040, because
those features are explicitly deferred and unreachable. Docker, production and
release-only activation/backup gates were not run; local completion is not release
authorization. No required active-scope test was skipped to obtain a pass.

No historical SQL was changed, tests weakened, existing database reset or source
record deleted. Migration rehearsals own disposable local namespaces. The real
worker smoke owns a freshly created random `_test` database and disposes only that
new fixture; configured development/test databases are not reset.

## Approved canonical test baseline

The owner explicitly approved a separate verified local test baseline while
preserving the existing database. Selected acceptance database:
`p406_acceptance_2209a0f5e14a451a8da09015f4b4c9cd_test` on local PostgreSQL.
It is retained for local acceptance, not deployed or activated.

- `node --env-file=.env.test.local .tools/p406-accept-baseline.mjs --create`:
  **PASS, exit 0**. Created a new database after confirming its name did not exist;
  deployed all 63 canonical migrations, repeated deploy and checked status.
  Every successful ledger checksum matches the SQL artifact, including M031
  `2ee6190668e6f964fbcf933aad9039141f2226f67c4b08b4fccab8f2f287ad72`.
- Exact **637-FK catalog/digest** matches; all six financial identity triggers and
  the allocation-shape trigger are present and enabled. No APPLYING/APPLIED custody
  transfer or domain-child custody exists.
- `node --env-file=.env.test.local .tools/p406-accept-baseline.mjs --run`:
  **40 tests / 2 files PASS, native exit 0**: `company-lifecycle.spec.ts` and
  `company-finance.spec.ts`. Only the child process's test connection selects the
  new baseline; no protected environment file changes. No second full gate.
- Before and after creation/testing, a read-only snapshot verifies exact hashes
  and row counts of **190 legacy table datasets, including its migration ledger**,
  plus column/constraint/function/trigger/index catalog hashes. All are unchanged.
  Private row bodies stay inside PostgreSQL; evidence stores only counts/digests.
- Evidence: `.tools/p4-06-approved-baseline.json`,
  `p4-06-approved-baseline-deploy.log`, `p4-06-approved-baseline-repeat.log`,
  `p4-06-approved-baseline-status.log`, `p4-06-approved-baseline-integration.log`.
  `node --env-file=.env.test.local .tools/p406-accept-baseline.mjs --verify`
  rechecks this selection and preservation without modifying either database.

The legacy default `.env.test.local` target still has its recorded M031 drift and
is excluded from P4-06 acceptance. Use the explicit approved-baseline runner for
affected local checks; do not silently use the legacy target as a verified baseline.
The development database remains at its 24 original matching migrations and was
not upgraded. This is an explicit owner-approved acceptance selection, not repair,
history rewriting, reset, a checksum exception or production migration.

## Deferred scope and production limits

Future enhancement requires separate authorization and all ADR 0040 safety gates:
complete graph migration, exact participant consent/admissions, historical actor
and confidential audience mapping, captured joint retention, transferred-child
cleanup/recovery and full transfer-specific fixtures. No destructive cleanup or
exclusion of draft preparation was needed or authorized in this stabilization.

Shared activation remains disabled. Docker/release-only checks, production legal
retention configuration, external backup/restore, hosted CI, production deployment
and launch security review remain deferred. Local acceptance does not authorize
activation. No production database was modified. No Phase 5 work was started.

## Consolidated Phase 4 LOCAL acceptance

Historical counts below are the prior reports' distinct acceptance counts,
not fresh runs or additive across batches.

| Batch | Scope                                                               | Local acceptance / tests | Published commit                           |
| ----- | ------------------------------------------------------------------- | ------------------------ | ------------------------------------------ |
| P4-01 | Company foundation, roles, policies                                 | COMPLETE / 1,247         | `6a217535b848d68adeef916cff3cbe3f02b4faa2` |
| P4-02 | Staff, confidential cases, availability, equipment                  | COMPLETE / 1,280         | `02b44675d50f69eea16c1ca81656e676e448788c` |
| P4-03 | Expenses, receipts, budgets, commitments                            | COMPLETE / 1,307         | `0b5829ea0e5d753e68276f91d4f8672e34c99abf` |
| P4-04 | Reimbursement and controlled approvals                              | COMPLETE / 1,335         | `ed9dc2f7697d220808867a6eec65f11b4b8385db` |
| P4-05 | Knowledge, reports, export, audit                                   | COMPLETE / 1,361         | `a33aa9c8e1d705521923fbe1653ecbca1f0af076` |
| P4-06 | Lifecycle and independent association/attachment; transfer deferred | COMPLETE LOCAL / 1,418   | Uncommitted                                |

P4-05 publication review covered its exact 43-file manifest, saved 13-stage gate
and successful affected typecheck after its initial failure; fresh publication
checks passed **15 tests / 5 files**. Local and remote commit are verified above.
Source reports: [P4-01](p4-01-report.md), [P4-02](p4-02-report.md),
[P4-03](p4-03-report.md), [P4-04](p4-04-report.md), [P4-05](p4-05-report.md).
**Consolidated Phase 4 LOCAL acceptance: COMPLETE for P4-01 through P4-06 under
ADR 0043's approved transfer deferral.** This is not production or Shared activation
acceptance. No Phase 5 implementation is authorized or started.

## Git and next action

Branch main, HEAD `a33aa9c8e1d705521923fbe1653ecbca1f0af076`; index empty.
P4-06 is unstaged, uncommitted and unpushed. Pre-existing unrelated documents and
all five protected environment files remain unchanged. **139 P4-06 paths**, plus
12 unrelated pre-existing untracked documents; 151 working-tree paths total.
The owner-approved separate acceptance baseline is verified; no product or local
acceptance decisions remain unresolved. Legacy database drift remains an explicit
environment limitation, with no repair authorized or performed. Stop at P4-06.
Phase 5, transfer execution, commit/push, activation and deployment require separate
owner authorization. None has been started or performed.
