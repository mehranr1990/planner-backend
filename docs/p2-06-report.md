# P2-06 implementation report

Batch: **P2-06**. Status: **COMPLETE for local implementation**.

- Publication requested first: reviewed and committed the accepted P2-04/P2-05
  changes as `bd79a860c768a51ba670b99f91258372cb82c2e2`, pushed to `origin/main`
  and verified the same remote SHA. Exactly 86 approved files; twelve unrelated
  architecture/frontend documents and all ignored secrets/runtime artifacts were
  excluded. P2-06 itself remains uncommitted and unpushed.
- Scope implemented: risk/issue register with severity, probability, responsibility,
  mitigation and immutable history; versioned safe Project work-plan templates;
  bounded dry-run/atomic bulk and CSV import; Task-owned estimates and explicit
  shared effort; accepted-assignment allocation, explicit capacity/workload and
  transparent bounded reports/immutable snapshots.
- Files/modules: Projects adds scoped execution context, register, plans, metrics
  services/controller; Tasks exposes `SharedTaskWork` and owns every source write;
  Spaces supplies current member visibility, batch growth checks and one-unit
  audit/usage effects. Zod/OpenAPI, compatibility baseline, SQL review, populated
  rehearsal, compiled restart and CI are updated. See [contract](p2-06-contract.md)
  and [migration review](p2-06-migration-review.md).
- Entities/migrations/constraints: eleven tables in two atomic M08 migrations,
  `202611040013_project_execution` and `202611040014_shared_task_work_log`.
  Total: 126 domain tables, 127 including the ledger, 38 migrations. Populated
  upgrade preserves all 115 prior table data sets, all 36 prior checksums and
  1,795 prior catalog constraints except the additive usage-feature allowlist.
  M07 workflow/approval/default/value/DAG/preview data, empty replay, each exact
  interruption/rollback, resume and repeated deployment pass. The existing one-unit
  delta and unique audit relation are preserved for every retained bulk unit.
- API/events/jobs: 33 new operations, 422 total OpenAPI operations and 3,456 valid
  references; all earlier signature baselines remain compatible. Source updates
  use existing Task/workflow/dependency guards and append-only metadata history;
  audit/outbox/usage commit with the batch. No new worker queue, external service,
  notification channel, Personal source copy or P2-07 view/file/comment API.
- Security/edges: source/manifest revision, hash, expiry, current admission/policy,
  old generations, closed users, nested foreign IDs, Viewer/Member/guest limits,
  author-only time correction, assignment consent and current workload filtering;
  scope-bearing FKs, immutable publications/snapshots, CSV syntax/byte/row limits,
  formula protection, exact minute/second semantics, known-abort rollback and
  fail-closed quarantine for ambiguous outcomes. Independent connections/barriers
  prove revoke-first denial and mutation-first ordering. No Personal Focus,
  Planning, Journal or Finance content is imported into work reports.
- Tests: **1,056 distinct tests PASS**: 526 nonintegration in 82 files and 530
  integration in 27 files. P2-06 adds 56 distinct cases. Development used targeted
  selections; the complete integration suite ran once for final submission.
- Mandatory commands: `pnpm quality` executed all 13 stages once. Its initial
  exit was 1 solely because lint found two unused local bindings. Both were fixed;
  only the affected `pnpm lint` gate was rerun and passed. All final stage results
  are PASS: config, generation, auth schema, Prisma validation, build, typecheck,
  formatting, lint, architecture, 526 tests, OpenAPI, 530 integration tests and
  migrations. No second full suite was run. A strengthened contract assertion
  passed its targeted five-test file; final API build and OpenAPI checks also pass.
  Evidence: `.tools/p2-06-quality.log`, `p2-06-lint-final.log`,
  `p2-06-contract-fixes.log`, `p2-06-api-build-final.log`, `p2-06-openapi-final.log`
  and the owned `p2-06-upgrade-*` report (all under ignored `.tools/`).
- Compiled checks: `pnpm smoke:p2-01`, `pnpm smoke:p2-02`, `pnpm smoke:p2-03`,
  `pnpm smoke:p1-12` and `pnpm smoke:p2-06` PASS against the compiled module graph.
  P2-06 includes the complete P2-04/P2-05 smoke in the same owned runtime, avoiding
  duplicate standalone runs. CSV/template apply, risk history, effort/workload,
  report snapshot, API restart/fresh worker and earlier Personal/Shared contracts
  survive restart. Final evidence: `.tools/p2-06-smoke-final.log` and
  `.tools/p2-06-regression-p{201,202,203,112}.log`.
- Tests NOT RUN: Docker build/start/persistence, hosted CI status, real off-host
  restore, real operator retention/security acceptance, SMTP delivery and
  production-volume load/timing. These are release/operator prerequisites outside
  the accepted local implementation gate, not claimed as passed.
- Deviations/ADRs: none from the approved scope; no new product ADR was needed.
  No P2-07, Team/Company execution, paid enforcement, deployment or production DB
  modification. Shared activation stays gated on real approved retention,
  independent current control/checkpoint, security and operational acceptance.
- Remaining blockers: none for local implementation. Deferred noncritical work:
  the pre-existing integration-harness concurrent `pg` client warning before a
  future pg@9 upgrade; no unrelated harness refactor or dependency change.
- Git: HEAD remains the verified P2-04/P2-05 publication SHA above. P2-06 changes
  are local and uncommitted; unrelated untracked documents remain untouched.
- Next eligible batch: **P2-07 — NOT STARTED; explicit owner approval required**.
