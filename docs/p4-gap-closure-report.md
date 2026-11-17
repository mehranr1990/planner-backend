# P4-GAP-CLOSURE report

Batch: P4-GAP-CLOSURE. Status: COMPLETE for the authorized development scope.
All independently implementable requirements are implemented and verified;
emergency recovery and legal/operator retention activation remain POLICY-GATED.
Development authorization is the owner's 32-capability request dated 2026-11-16.
Policy activation, Shared activation and production use are separate gates.

## Baseline and preservation

Started from clean `main` at `3273b054fc64796366bf814f87bdd83dcae0d96d`.
Both loopback databases had 97 successful migrations, matching checksums and no
unresolved entries. Canonical OpenAPI had 1,117 operations. Development database
was inspected read-only; new migrations target only isolated `mehran_test`.

Reused Company hierarchy/admissions, invitations, fixed roles, work profiles,
resource allocations/rooms, expense/category/budget/commitment accounting,
sequential approvals, reimbursements, beneficiary acknowledgements, payment runs,
goals, reports, handovers, lifecycle, retention and legal holds. Personal, Project,
Team and Messages/Meetings engines remain in place. No dependency was added.

## All 32 capabilities

“IMPLEMENTED” describes development functionality under existing admission and
configured-policy requirements. It does not assert production activation.

| Requirement    | Development result and operational boundary                                                                                                                                                                                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-EMP-HIST     | IMPLEMENTED: authorized bounded transfer history with recorded Department/Unit placements, employee/actor and effective timestamp; legacy missing snapshots remain null. Update-immutable history; no invented backfill.                                                                                  |
| C-ORG          | IMPLEMENTED: bounded Company→Department→Unit chart, stable IDs/parents, admitted manager identities and counts; structure-only admin nodes have restricted/null personnel evidence.                                                                                                                       |
| C-EMP-LIFE     | ALREADY SUPPORTED, EXTENDED: generation-bound admission/role/suspension/departure/reinstatement remain existing APIs; transfers additionally respect physical custody obligations. Work status remains distinct from identity/employment rights.                                                          |
| C-DEPT         | IMPLEMENTED: exact-context bounded analytics, explicit window/current snapshot distinction, transfer and review/approval aggregates; separate authorized Finance/portfolio/operations sources and UNKNOWN work evidence.                                                                                  |
| CB-1           | IMPLEMENTED: existing ordered approval engine extended to typed budget-change requests; no direct-decision bypass of a bound chain, idempotent decision route, current action state and terminal history. No payment execution.                                                                           |
| CB-2           | IMPLEMENTED: explicit immutable published tier-policy versions, exact ranges/category/currency/context, effective dates, overlap rejection, deterministic fail-closed selection and pinned requests. No thresholds or policies seeded.                                                                    |
| C-DELEGATE     | IMPLEMENTED: explicit workflow-version scope and validity, original/delegate current authority, revocation and immutable basis in decisions. No chaining, self-approval or collapsing distinct stages into one actor.                                                                                     |
| C-ESCALATE     | IMPLEMENTED: existing manual alternate escalation plus existing-worker policy timeout sweep, current publisher/source/admission checks, immutable event and opaque notification. Active explicit policy required; never auto-approves.                                                                    |
| C-APP-HIST     | IMPLEMENTED: bounded request/workflow/policy/stage/actor/delegation/decision/reason/status timeline; missing legacy transition facts stay null.                                                                                                                                                           |
| C-BUDGET-ALERT | IMPLEMENTED: explicit exact-money SPENT/COMMITTED rules, source-transaction evaluation, deduplicated persisted in-app notices and existing transactional outbox effects. No implicit rejection/approval.                                                                                                  |
| CB-3           | IMPLEMENTED: authorized recipient/role/status/timestamp/expiry details and proof-rotating resend; existing revoke/accept reused. HTTP inviter response contains no proof; recipient-only proof endpoint remains.                                                                                          |
| C-ROLES        | IMPLEMENTED: named custom read roles, update/list/archive/assignment/removal and real effective-permission evaluation for the two existing configurable Company keys. Fixed system/administrative/financial authority remains membership-only.                                                            |
| C-TEMP         | IMPLEMENTED: exact-scope admitted-principal grants, explicit capabilities/validity/revocation/reason/actor; authorization checks expiry synchronously. No guest admission or cross-scope rights.                                                                                                          |
| C-ACCESS       | IMPLEMENTED: bounded access inventory identifies membership, custom roles, temporary/delegated sources; reviewed retain/revoke decisions persist. Review revokes additional grants atomically; membership changes use existing protected APIs.                                                            |
| CB-4           | IMPLEMENTED: optional trimmed/NFC asset tags, Company-scoped uniqueness, read/update with existing resource revision and safe conflicts. Existing tagless records remain valid; no identifier backfill.                                                                                                   |
| C-ASSET        | IMPLEMENTED: physical custody separate from reservations, current employee/generation, issuing actor/time, optional expected return, explicit return/history, atomic unique active custody and departure/retirement obligations.                                                                          |
| C-MAINT        | IMPLEMENTED: explicit maintenance reason/type/responsible person/date/state/completion; historical facts retained. Scheduled/in-progress maintenance blocks new bookings/custody until an explicit terminal transition.                                                                                   |
| C-UTIL         | IMPLEMENTED: source-labeled reservation/custody reporting, clipped interval unions and UNKNOWN occupancy without booking evidence. Existing room grids/heat retained; possession never asserts occupancy.                                                                                                 |
| CB-6           | ALREADY SUPPORTED: expense-bound reimbursement amount/status/reservation/history, partial beneficiary-confirmed external acknowledgements and corrections. Approved/processing/run membership never means externally paid.                                                                                |
| C-EXPENSE      | ALREADY SUPPORTED: scoped category create/edit/archive, immutable historical expense version/category association and financial reporting. No tax categories invented.                                                                                                                                    |
| C-BUDGET       | ALREADY SUPPORTED: approved limits/adjustments, exact spent/reserved/available reporting, immutable effects and hard budget constraints; no currency combination or duplicate expense effects.                                                                                                            |
| C-PAYRUN       | ALREADY SUPPORTED: internal run lifecycle and item references to existing reimbursement/payment assertions; beneficiary acknowledgement remains settlement evidence. No bank execution or fabricated settlement.                                                                                          |
| C-FIN-AUDIT    | ALREADY SUPPORTED, EXTENDED: existing authorized financial versions/decision/reimbursement/audit history plus pinned-policy/delegation/status timeline. Opaque security audit exposes no receipts, bank data or private body.                                                                             |
| CB-7           | IMPLEMENTED: immutable persisted KPI observations with explicit period/source/unit/value/time and bounded history; existing actual goal/checkin history retained. No historical snapshot reconstruction.                                                                                                  |
| C-REVIEW       | IMPLEMENTED: explicit draft/open/closed cycles and generation-bound assignments; private reviewer submission, subject completion, immutable private revisions and count-only analytics. No scores/compensation rules.                                                                                     |
| C-1ON1         | IMPLEMENTED: bound manager/employee records, meeting instant, private note revisions and separate revisioned follow-up actions/status. Existing sealed/receipt files are not authorized one-on-one attachments and cannot be rebound.                                                                     |
| C-ANALYTICS    | IMPLEMENTED: organization, goals/observations, resources, lifecycle and review/approval aggregate read models composed with existing authorized operations/portfolio/finance/KPI endpoints. Private source bodies and Personal availability are excluded.                                                 |
| CB-8           | ALREADY SUPPORTED, EXTENDED: original handover lifecycle/proofs/expiry/fencing/history and source-owner checks retained; bounded owner/recipient list added. No independent Team/Project right is granted.                                                                                                |
| C-REAUTH       | ALREADY SUPPORTED, EXTENDED: Better Auth password verification is inside final acceptance, bound to the exact current request/recipient/revision/expiry. Terminal idempotence prevents re-execution. Former-owner and other recipient sessions are revoked. No reusable custom proof/lifetime introduced. |
| C-SAUDIT       | IMPLEMENTED: existing transaction-backed immutable audit/outbox for new governance, policies, grants, delegation and financial actions; restricted security-audit retrieval is separate from ordinary activity. No secrets/private note payloads recorded.                                                |
| C-RECOVERY     | POLICY-GATED: case/evidence-reference/status and immutable governance drafts persist and are audited; explicit approver/quorum/timing/proof/reference fields may be incomplete. No executable takeover endpoint. Independent verification/activation governance remains unapproved.                       |
| C-RETENTION    | POLICY-GATED: existing versioned operator catalog/admission/holds/disposal preserved; safe readiness and legal/operator draft checklist added. No periods, obligations or approval values invented, seeded or activated.                                                                                  |

## Files, schema and API

Company services/controllers, Companies/Spaces authorization and collaboration,
auth session revocation, worker, shared cleanup catalog, typed contracts/OpenAPI,
compatibility records, migration/rehearsal tooling and focused tests were changed.
The detailed route/schema/authorization handoff is
[`frontend-handoff/COMPANY_GAP_CLOSURE.md`](frontend-handoff/COMPANY_GAP_CLOSURE.md).

Migrations (additive; historical SQL unchanged):

- `202611160073_company_gap_closure`: 19 scoped tables; optional resource tag;
  nullable historical placement snapshots; approval policy/delegation/status/source
  extensions; typed budget-change approval source; DB custody/availability,
  revision, private-history and policy guards.
- `202611170074_company_history_guards`: transfer immutability, asset-retirement
  obligations and irreversible reason/action-text redaction guards. This follow-up
  preserves the already-applied M073 checksum.

New relationships are removed child-first by Company cleanup before existing
members/resources/policies/budgets/actors. The catalog is pinned at 1,067 FKs.
Independent Personal erasure clears new private review/one-on-one payloads and
free-text governance/maintenance reasons; retained attribution remains opaque.

There are 68 new HTTP operations. Existing signatures change only for the explicit
`BUDGET_CHANGE` workflow kind, optional typed approval source and two opaque
notification kinds; exact old/new hashes are in
`tooling/compatibility/company-gap-api-extensions.json`. Historical baselines stay
unchanged. New operations have their own frozen signature record.

## Verification

The complete `pnpm.cmd quality` run executed every configured gate. Its overall
exit was 1: default-heap ESLint exhausted memory; three compatibility assertions
needed the exact approved extensions/current handoff snapshot; the lifecycle
fixture reused sessions correctly revoked by ownership acceptance. These issues
were corrected without disabling assertions, guards or tests. The full gate was
not repeated; affected checks were rerun as required by the testing discipline.

| Command / check                                                                                                                                                                                                                                                                            | Observed result                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd quality` — config, Prisma generation, official auth schema, Prisma validation, build, typecheck, formatting, architecture, canonical OpenAPI and migration rehearsals                                                                                                            | PASS for these individual gates; overall command failed as described above.                                                                                                                                                                                                                                                                                                  |
| Full unit/contract/architecture/compatibility stage (`pnpm.cmd test`)                                                                                                                                                                                                                      | Initially 180 files / 788 tests: 785 passed, 3 compatibility assertions failed. All three affected assertions subsequently passed.                                                                                                                                                                                                                                           |
| Full integration stage (`pnpm.cmd test:integration`)                                                                                                                                                                                                                                       | Initially 51 suites / 1,109 tests: 1,092 passed, 17 failures confined to the Company lifecycle fixture.                                                                                                                                                                                                                                                                      |
| `node --max-old-space-size=8192 node_modules/eslint/bin/eslint.js . --max-warnings 0`                                                                                                                                                                                                      | PASS; final policy service/test also passed targeted ESLint after the last security refinement.                                                                                                                                                                                                                                                                              |
| `pnpm.cmd exec vitest run --project compatibility tooling/compatibility/consolidated-api-responses.spec.ts tooling/compatibility/gap-closure-responses.spec.ts tooling/compatibility/project-gap.spec.ts`                                                                                  | PASS: 3 files / 3 tests, historical baselines and mutation rejection retained.                                                                                                                                                                                                                                                                                               |
| `pnpm.cmd test:integration apps/api/test/integration/company-gap.spec.ts apps/api/test/integration/company-lifecycle.spec.ts apps/api/test/integration/company-finance.spec.ts apps/api/test/integration/company-settlements.spec.ts apps/api/test/integration/company-completion.spec.ts` | PASS: 5 suites / 89 tests after fixture repair and disposal/policy additions.                                                                                                                                                                                                                                                                                                |
| `pnpm.cmd test:integration apps/api/test/integration/company-gap.spec.ts`                                                                                                                                                                                                                  | Final policy-archive fail-closed refinement: PASS, 12 tests.                                                                                                                                                                                                                                                                                                                 |
| `pnpm.cmd build`; `pnpm.cmd typecheck`                                                                                                                                                                                                                                                     | Both PASS after the final policy refinement.                                                                                                                                                                                                                                                                                                                                 |
| `pnpm.cmd architecture`; `pnpm.cmd openapi:check`                                                                                                                                                                                                                                          | Final PASS; 664 modules / 4,550 dependencies, zero boundary violations; canonical and handoff OpenAPI synchronized.                                                                                                                                                                                                                                                          |
| `pnpm.cmd db:migrations:check` (inside full gate)                                                                                                                                                                                                                                          | PASS: fresh 99-migration schema, 320 tables including ledger; populated Company 97→99 upgrade preserves 300 predecessor datasets, old checksums and approved constraint exceptions; both interruption rollback/redeploy paths and exact 1,067-FK catalog. The original log labels this upgrade 97→98; its label was corrected to 97→99 without changing the exercised logic. |
| Targeted domain/route tests                                                                                                                                                                                                                                                                | PASS: 3 files / 6 tests; new compatibility and migration-security tests also ran in the full test stage.                                                                                                                                                                                                                                                                     |
| `pnpm.cmd format:check`; `git diff --check`                                                                                                                                                                                                                                                | Final PASS, including completion documentation.                                                                                                                                                                                                                                                                                                                              |

Evidence logs are local ignored files `.tools/p4-gap-quality.log`,
`.tools/p4-gap-lint-final.log`, `.tools/p4-gap-compatibility-final.log`,
`.tools/p4-gap-integration-final.log`, `.tools/p4-gap-policy-final.log`,
`.tools/p4-gap-build-final.log`, `.tools/p4-gap-typecheck-final.log`,
`.tools/p4-gap-architecture-final.log`, `.tools/p4-gap-openapi-final.log` and
`.tools/p4-gap-format-final.log`. These results describe a full run plus successful
affected reruns, not a single green execution of `quality`.

NOT RUN: browser/E2E, Docker, production/staging/live-provider checks and deployment,
as excluded by the owner. Configured databases were never reset; only owned
disposable schemas were used by the migration rehearsal harness. No development
migration, historical checksum rewrite, commit or push was performed.

## Final database and Git state

Read-only final ledger inspection: `mehran_dev` remains at its original 97
successful migrations; isolated `mehran_test` has 99. Both have zero unresolved
entries and zero checksum mismatches. M073/M074 were applied only to isolated
test. Their SQL was not rewritten after application. Canonical OpenAPI now has
1,185 operations (68 added).

Both databases currently have zero Company retention catalog entries and zero
valid Company approval records. Development Shared activation configuration is
absent. Retention readiness does not constitute policy approval or activation.

Git remains on `main` at `3273b054fc64796366bf814f87bdd83dcae0d96d`, with 62
changed/untracked delivery paths and no staged changes. Nothing was committed or
pushed; frontend source, dependency manifests and lockfile were not changed.

## Operational limits and next step

No production/staging access or live-service verification. Shared stays disabled.
Emergency governance and Company legal/operator retention/backup approvals remain
required before activation. No monetary threshold or active policy was seeded.
Existing resource custody means possession; no attendance or bank settlement is
inferred. Docker/release operations remain deferred.

Deviations from binding specifications: none beyond the explicit owner-approved
development scope recorded in ADR 0055. No product thresholds, legal periods or
recovery governance were inferred. No implementation blocker remains; independent
recovery governance/verification and legal/operator retention/backup approval are
required for the corresponding operational activation.

Next step: owner review of this batch and its exact API handoff. Next batch:
NOT STARTED and not authorized. Messages, Social, Admin, commit, push, development
migration, deployment and Shared activation remain outside this authorization.

Published matching tier policies also block legacy fixed-reviewer expense submission and direct budget decisions. Explicit workflow submissions must select the matching policy workflow and pin its version; uncovered requests retain approved legacy behavior. Policy-required budget requests expose `can.decide:false` until handled through the controlled engine. No threshold or policy is activated by default.
