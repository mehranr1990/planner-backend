# P4-01 local implementation report

Batch: **P4-01 — Company custody, Department/Unit contexts, corporate admission and
bounded policy inheritance**. Status: **COMPLETE for local implementation**,
with one mandatory quality run and affected reruns. Completion report finalized
2026-11-07; Shared activation and production acceptance remain gated.

Approved P3-05 publication: reviewed the exact accepted 42-file manifest and its
quality/affected-rerun evidence, committed and pushed to origin/main as
`50631a0b3a2c3b0768212f0441b223d6e47c709f`; remote SHA matched local HEAD.
Unrelated documentation, environment files and runtime artifacts were excluded.

Scope implemented: one Shared custody per independent Company; Department/Unit
contexts and metadata; corporate roles and verified explicit root/child invitations,
directory, membership state/role changes and departure; immutable bounded policy
inheritance with explicit default overrides. Approved ADR 0034 records the owner's
permission matrix. No Company attachment, employee cases, finance or integration.

Files/modules changed: new Companies module/domain/application/controllers and
strict schemas/OpenAPI; Spaces-owned CompanyAccess facade, corporate role guards,
root-generation binding, authoritative child usage, root-only closure counting and
restrictive restore evidence. Existing Shared custody, fencing, invitation maintenance,
audit/outbox/receipts, identity and source modules are reused. No new dependency.
See [operation/security contract](p4-01-contract.md) and
[migration review](p4-01-migration-review.md).

Entities, migrations and constraints: Company, CompanyDepartment, CompanyUnit,
CompanyScopePolicy and CompanyContextAdmission; migrations M028/M029 as reviewed
above. Typed same-Company/parent/actor/admission FKs, immutable policy/binding/
identity and optimistic revision checks. All 51 previously committed SQL artifacts
remain unchanged. No existing recipient/proof data is rewritten or deleted.

API contracts, domain events and jobs: **23 additive operations, 557 total /
4,806 resolved references**. P3-05 and every earlier published signature frozen.
Opaque Company/context/policy/admission effects use Shared audit/outbox and free
usage seams. Existing Shared invitation expiry/revocation maintenance is reused;
no new queue, consumer, provider or worker entrypoint.

Security and edge cases: current identity, session, root and explicit child authority;
independent corporate/Project/Team role catalogs; no self-promotion or Owner editing;
non-enumerating child IDs and nested lists; canonical named-recipient proofs;
generation/revision-bound offers; no revival after root rejoin/removal; mandatory/
default/optional precedence, fixed security floors and stale cursor denial. Observed
PostgreSQL lock waits cover both invitation/revocation orders and policy/read order.
Root-only closure counts, frozen owner exit, retained pseudonymous attribution and
independent Personal erasure are tested. Restored Company authorization is quarantined
before serving data; Company automatic purge and attachment remain inactive.

Tests and exact commands/results:

| Command / retained evidence                                                                                                                                                                                                                                                                                            | Observed result                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd quality`; `.tools/p4-01-quality.log`, `p4-01-quality-result.json`                                                                                                                                                                                                                                            | All 13 stages executed **once**. Config, Prisma generation/auth schema/schema validation, build, typecheck, formatting, lint and OpenAPI passed. Initial run: **559 non-integration passed / 5 failed; 682 integration passed / 1 failed**, one contract-barrel import cycle and one migration-fixture parameter-type ambiguity. Raw full-run exit **1** remains recorded; affected results below resolve these failures. |
| `pnpm.cmd exec vitest run --project contract apps/api/test/contract/focus-openapi.spec.ts apps/api/test/contract/goals-openapi.spec.ts apps/api/test/contract/insights-openapi.spec.ts apps/api/test/contract/lifecycle-openapi.spec.ts apps/api/test/contract/writing-openapi.spec.ts`; `p4-01-contract-affected.log` | **13 passed**. Five obsolete Company-absence assertions now require the authorized Company routes and continue excluding Company employee/expense/attachment features and unsupported sync. All previous signature assertions retained.                                                                                                                                                                                   |
| `pnpm.cmd test:integration apps/api/test/integration/project-core.spec.ts -t 'creates a complete independent Project'`; `p4-01-project-affected.log`                                                                                                                                                                   | **1 passed**. Authorized Company table presence is checked alongside zero Company/Department/Unit rows for the new Project, unchanged independent association and PROJECT custody.                                                                                                                                                                                                                                        |
| `pnpm.cmd architecture`; `p4-01-architecture-affected.log`                                                                                                                                                                                                                                                             | **PASS**, zero violations, **460 modules / 2,869 dependencies**. Removed an unnecessary builder barrel export; no architecture rule changed.                                                                                                                                                                                                                                                                              |
| `pnpm.cmd --filter @mehran/api-contracts build`; `pnpm.cmd exec vitest run --project contract --project compatibility apps/api/test/contract/company-routes.spec.ts tooling/compatibility/openapi.spec.ts`; `pnpm.cmd openapi:check`; `p4-01-final-contract.log`                                                       | **PASS**, **6 tests** for the affected controller/contract/compatibility paths; generated OpenAPI matches. All 23 actual Company handlers and every prior published baseline retained.                                                                                                                                                                                                                                    |
| `pnpm.cmd db:migrations:check`; `p4-01-migration-affected.log`                                                                                                                                                                                                                                                         | Every predecessor, M028 and M029 assertion reports **PASS** after an explicit text cast fixed the fixture's PostgreSQL parameter inference. Empty replay, populated preservation, rollback/repeat deploy, immutable checksums and final FK catalog succeeded. Outer PowerShell status is explained below.                                                                                                                 |
| Targeted `companies.spec.ts` development runs and `-t` affected selections; policy/schema/route/migration tests                                                                                                                                                                                                        | Current root/child generations, stale offers, both observed invitation/revocation orders, policy/read race, actor/IP abuse, suspended departure, source isolation, Personal erasure, restore quarantine and authoritative child usage covered. **All 24 Company integration scenarios passed in the full run.**                                                                                                           |
| `pnpm.cmd smoke:p4-01`; `p4-01-smoke.log`                                                                                                                                                                                                                                                                              | **PASS**, fresh compiled API and existing Shared maintenance after restart, inherited override/mandatory denial, explicit child admission, cross-Company isolation and independent Project/Team custody. No redundant old smoke.                                                                                                                                                                                          |
| Affected TypeScript/ESLint/Prettier checks; `git diff --check`; `.tools/p401-final-prepare.cjs`                                                                                                                                                                                                                        | **PASS**, final submission checks and preservation evidence; no staged or committed P4-01 work.                                                                                                                                                                                                                                                                                                                           |

Final local acceptance evidence: **1,247 distinct passing tests — all 564
non-integration and 683 integration scenarios across the single gate and affected
reruns**. The full suite was not repeated. No mandatory coverage, authorization,
signature, privacy, architecture or migration check was removed or bypassed.

The migration rerun's outer PowerShell wrapper reported **1** because `*>` treated
pg's informational deprecation stderr as NativeCommandError. Its retained log reaches
every final PASS, including M029's populated Company/legacy-offer preservation, with
no assertion exception or pnpm lifecycle failure. This wrapper status is distinct
from the successful migration assertions; the migration chain was not repeated
merely to change shell status. Original logs and the initial full-run failure remain.

Tests not run and why: Docker/WSL, deployment, production databases and release-only
backup/restore/operational/activation checks **NOT RUN / DEFERRED** per owner. Local
PostgreSQL test targets only; no configured database reset. Shared remains disabled.

Deviations: none. Remaining P4-01 local blockers: **none**.
Later Company lifecycle/domain restore reconciliation, disposal, attachment and
Company-related integrations remain separately gated. Unsupported prototype offers
are preserved and denied until normal expiry or explicit authorized revocation.

Automatic approval review rejected a proposed bulk migration update that would
revoke prototype Company offers and clear recipient/proof fields. It was replaced
with the preservation-only M029 and version validation; the rejected bulk mutation
was not executed. No additional approval is needed for the preserved-data approach.

Git: P4-01's **55 changed/new files** remain unstaged, uncommitted and unpushed.
Preservation verification retains **17 protected unrelated/environment files** and
all **51 previously committed SQL artifacts**, with HEAD still at the published
P3-05 SHA above. Runtime artifacts remain excluded; only new isolated test evidence
was created. No production/deployment work or Shared activation.
Next eligible batch: **P4-02 — NOT STARTED; separate authorization required**.
