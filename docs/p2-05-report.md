# P2-05 implementation report

Batch: **P2-05**. Status: **COMPLETE for local implementation**.

- Scope implemented: immutable scoped workflow versions/custom states, controlled
  transitions and designated approvals; eight typed/versioned field kinds,
  explicit defaults, indexed bounded filters and secure deprecation; FS/SS/FF/SF
  DAG with signed lag/lead and explicit immutable reschedule preview/apply.
- Files/modules: Tasks owns domain rules, persistence, source status/schedule
  guards and metadata history through `ProjectTaskTools`. Projects adds scoped
  orchestration/controller; Spaces supplies current participant/lock contracts.
  Zod, OpenAPI, compatibility baselines, migration rehearsal and CI are updated.
  See [contract](p2-05-contract.md) and [migration review](p2-05-migration-review.md).
- Entities/migrations/constraints: 17 typed tables in three reviewed atomic M07
  migrations (`202611040010`–`202611040012`); 115 domain tables/36 migrations total.
  All 33 prior artifacts and 98 prior table data sets are preserved. The populated
  upgrade compared 1,536 prior constraints; only the additive usage allowlist
  changes. Empty replay, each interruption/rollback, resume and repeat deploy pass.
- API/events/jobs: 26 new operations; 389 total OpenAPI operations/3,126 valid
  references. All Personal and P2-02/03/04 signatures remain compatible. Existing
  TaskChange contracts are retained; append-only TaskMetadataEvent records new
  source metadata. Existing transactional shared audit/outbox/usage seams are
  used; no new notification channel, worker queue or external service.
- Security/edges: exact approver admission/generation and no self-approval per
  owner-approved [ADR 0032](adr/0032-designated-workflow-approval.md); requester and
  approver reauthorization under predeclared account/custody locks; policy removal,
  old generations, stale source/preview, expiry, narrow grants, nested IDs, cycles,
  immutable publications/defaults, exact decimals and atomic rollback/replay.
- Tests: **1,000 distinct tests PASS**: 496 nonintegration in 76 files, 504
  integration in 26 files. P2-05 adds 76 distinct tests to the accepted baseline.
  Development used targeted domain/route/integration selections, not repeated
  full suites. The final full integration suite ran once.
- Mandatory commands: `pnpm quality` ran once, executing all 13 stages. Config,
  generation, auth schema, Prisma validation, build, architecture, 496 tests,
  OpenAPI, 504 integration tests and migrations passed. Its initial exit was 1
  because typecheck/format/lint found smoke/CI wiring and an unused import. After
  corrections, only `pnpm typecheck`, `pnpm format:check` and `pnpm lint` were rerun:
  all PASS. No second full suite was run. Evidence: `.tools/p2-05-quality.log` and
  `.tools/p2-05-{typecheck,format-check,lint}-final.log`.
- Compiled checks: `pnpm smoke:p2-01`, `pnpm smoke:p2-02`, `pnpm smoke:p2-03`,
  `pnpm smoke:p2-05` and `pnpm smoke:p1-12` PASS. P2-05 reuses the full P2-04
  runtime/restart/worker exercise, so P2-04 is covered without a duplicate run.
  Workflow approvals, typed default/search, reschedule application and version
  persistence also pass through compiled HTTP and process restart.
- Tests NOT RUN: Docker build/start/persistence, real restore/retention/security
  acceptance and production-volume timing: release/operator prerequisites,
  unavailable/unapproved in this local batch. No claim of operational acceptance.
- Deviations: none from approved scope; ADR 0032 resolves the owner-approved
  approval rule. No P2-06 features, dependency additions or unrelated refactors.
- Blockers/ADRs: no local implementation blocker or pending product ADR. Real
  Shared activation remains blocked on approved operator retention, independent
  current control/checkpoint, security acceptance and operational prerequisites.
- Deferred noncritical improvement: the existing integration-harness warning
  about concurrent `pg` client queries before a future pg@9 upgrade; the pinned
  pg@8 register is unchanged. No unrelated harness refactor was included.
- Git: HEAD `d0945368169baf9f97669ba420847d949533715d`, working tree dirty with
  accepted P2-04 and new P2-05 work; unrelated architecture/frontend documents
  preserved. Nothing committed, pushed or deployed; no production DB changes.
- Next eligible batch: **P2-06 — NOT STARTED; explicit owner approval required**.
