# Platform Admin P5 work record

Owner acceptance, 2026-11-26: P5 is accepted for local development based on the
documented final evidence. The current diff, ADR 0077, underlying gate summaries,
M119–M121 frozen SHA256 values and all 145 historical migration files were reviewed
before publication. Both OpenAPI artifacts are identical. Only P5 publication is
authorized; the owner's compose edit and local tooling/configuration are excluded.
After a verified push, the owner authorizes P6 implementation and final acceptance,
without P6 commit/push, P7 or deployment. Earlier authorization statements below
are historical checkpoints.

2026-11-26. Status: **COMPLETE — LOCAL DEVELOPMENT**.

The owner authorized all Plans/Entitlements, Subscriptions and Billing backend
implementation, additive isolated-test migrations and final acceptance. No P5
commit/push, P6, deployment, frontend, E2E or subagents are authorized.

P4 acceptance evidence and diff were verified and published to origin/main as
`13c45246bad4fc817bf96dd8f5023c6cb7e17585`; remote hash matched. All 142 historical
migration files matched their predecessor bytes before publication. M116–M118
match their frozen registry. Owner compose SHA256 remains
`c42657021cd05da9ad7412dd67e675470b8029ffdabccb4b55035a363623cf20`.

Execution plan: add the dynamic commercial catalog and immutable versions, typed
customer scope and subscription terms, transactional monetary documents/ledger,
strict Admin and ordinary APIs, durable expiry/notice reconciliation and runtime
entitlement enforcement. Keep commercial enforcement disabled by default and
automatic charging unavailable. Reuse current Admin MFA/audit/idempotency, Spaces
ownership and runtime growth seams, pg-boss and isolated PostgreSQL harness.

## Implementation and requirement traceability

All three modules are connected through AppModule and the existing pg-boss worker.
All three modules meet the local acceptance gates, with the full checkpoint and
successful affected reruns recorded below. Commercial activation and production
release verification remain separate.

| ID  | Approved requirement / concrete production implementation                                                                                                                             | Acceptance coverage                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PL1 | Dynamic feature/product catalog; Personal/Team/Company eligibility; public/private/targeted listings and pricing visibility; immutable allowance/price versions and negotiated prices | P5 integration: public and negotiated isolation, version propagation, exact pinned prices and immutable history; strict contracts                                                    |
| PL2 | NEW_ONLY/ALL feature/quota propagation; separate notified renewal-price increase policy                                                                                               | P5: unchanged existing price, explicitly notified increase, original price preserved                                                                                                 |
| PL3 | Independent paid/complimentary add-ons; additive capacity; redundant Boolean renewal suppression; lifetime/date/term grants; final Admin caps                                         | P5: retained add-on terms, capacity addition, Boolean suppression, override expiry/revoke and foreign term denial                                                                    |
| SU1 | One active base per scope; explicit financial grants; current ordinary admission; owner-counted seats at actual invitation acceptance                                                 | P5: concurrent grants, real Team membership acceptance, financial grant/revoke, Personal/Company isolation and existing custody dependency rejection                                 |
| SU2 | Immediate/scheduled and fixed/non-expiring activation; manual customer/Admin renewal; cancellation, pause, reactivation, grace and term changes                                       | P5: verified renewal invoices, stale-intent REVIEW, downtime recovery, exact pause/resume, independent add-ons, paid unused credit and term history                                  |
| SU3 | FREEZE/CONTINUE clocks; configurable grace/notification/retry policy; durable pre/post-expiry inbox; no monetary retry or live charge                                                 | CommerceWorker PostgreSQL due-state in pg-boss; concurrent sweeps and UTC domain boundary tests                                                                                      |
| BI1 | Manual/transfer/crypto/future method categories; privileged reference/evidence verification; standalone external receipts; canonical deduplication                                    | P5: replay/concurrent verification, reference uniqueness, partial rejection, same-scope scanned evidence, inactive future method                                                     |
| BI2 | Draft/Issued/Paid/Voided invoices; paid correction creates an immutable new version and paired adjustment; bounded write-off                                                          | P5: paired paid correction, raw DB mutation/unpaired-version denial, write-off versions/adjustment                                                                                   |
| BI3 | Backed same-currency credits; explicit CREDIT/REFUND_PENDING overpayment review; manual bounded refunds; no wallet                                                                    | P5: concurrent credit/refund spending, corrected invoice credit and refund double-spend denial                                                                                       |
| BI4 | Public/private percent/fixed coupons, eligibility/dates/counts/combinations; exact captured tax/fee definitions                                                                       | P5: concurrent use limits, private/currency/combination denial, exact rounding and monetary overflow rollback                                                                        |
| BI5 | Currency-partitioned cash/refund/receivable/billed measures, product attribution, current MRR/ARR and defined conversion                                                              | P5: amounts above Number precision and cross-currency denial; repeatable-read reporting                                                                                              |
| X1  | Independent Admin realm/RBAC, recent persisted MFA, Origin, strict schemas, audit, idempotency/revisions and scope isolation                                                          | P5: role/session/MFA/Origin/unknown-field failures, foreign scope/term/price, replay/conflict and monetary audit redaction                                                           |
| X2  | Existing features free by default; real non-destructive expiry enforcement; portability/erasure; custody/retention preservation                                                       | P5: actual Task/file/offline write denial after activation, retained readable content, owned export and detached financial history; full P0–P4 checkpoint and affected reruns passed |

`admin-commerce` owns catalog, subscriptions, financial ledger, billing, query APIs,
controllers, durable worker and public entitlement/lifecycle contracts. Spaces
retains admission, membership and custody authority. Storage retains scanning and
file authorization. Personal lifecycle orchestrates portability/erasure. The optional
AdminCommand audit projection keeps exact private replay receipts while recording
safe operation/target/state/revision metadata, without financial amounts in shared audit.

The complete routes, bodies, capabilities and financial/runtime semantics are in
[the P5 frontend handoff](frontend-handoff/PLATFORM_ADMIN_P5.md), generated alongside
OpenAPI from the contracts. No frontend source changed. [ADR 0077](adr/0077-platform-admin-p5.md)
records engineering choices; no new library, fixed commercial plan type or live
payment integration was introduced.

## Migrations and immutable history

M119–M121 add 27 tables and 61 FKs. Complete catalog: 424 tables including the Prisma
ledger, 1,310 FKs; SHA256
`8c8c192c87bdd4b471fa1c4f081ccd89b1da41a9fffda74531bfe676a9204047`.
Only isolated local test schemas received migrations. No schema push, existing
database reset, production migration or deployment occurred.

| Migration                  | Frozen SHA256                                                    |
| -------------------------- | ---------------------------------------------------------------- |
| M119 platform_admin_p5     | caa347e41636eba0d822030d58b822f48952619d6ab7387799be9a6fe44f6373 |
| M120 p5_term_clock_history | 399e1a52801417457a7b58f0a52d1b9db6ac5a4a37ee7cef96572aa22725ae64 |
| M121 p5_term_closure       | 83f64b566a541b40e48aadcfd2026f8e3546f2f43bbb73e8804e3cca3895921b |

Database guards preserve versions, prices, purchased terms, clock shifts/closures,
ledger entries, adjustments, refunds and verified payments. Invoice/payment FKs
bind customer and currency. Customer/subscription transfer or history deletion is
prohibited. Live scope/evidence/identity references detach without deleting financial
documents. Existing custody eligibility rejects a scope containing commercial data,
preserving the no-subscription-transfer rule and ordinary consent requirements.

The affected P5 populated upgrade PASS preserves 396 predecessor datasets, 144
historical migration checksums and earlier constraints, with three interruption
rollbacks, resume/repeat deployment and the exact FK catalog. It also inserts an
issued document and verified receipt above Number precision after M119 and verifies
their history across the clock/closure upgrades.

## Verification evidence

The full mandatory gates ran after all three modules were implemented. Confirmed
failures were corrected and affected checks passed, following AGENTS section 16.
All 1,338 runnable PostgreSQL cases are covered by the full checkpoint and these
successful reruns; the single conditional live-scanner case remains skipped.

| Gate / exact command                                                                   | Result and evidence                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd test --maxWorkers=1`                                                         | PASS: 1,008 tests / 232 files; `.tools/p5-final-static-test.log`                                                                                                                                                                          |
| `pnpm.cmd test:integration`                                                            | Full checkpoint: 1,329 passed, nine failed, one conditional live-ClamAV skip / 66 files. All nine failures resolved by the successful affected reruns below. `.tools/p5-final-database-integration.log`                                   |
| `pnpm.cmd db:migrations:check`                                                         | PASS, exit 0: all historical rehearsals and populated P4→P5 upgrade; `.tools/p5-final-database-migrations.log`                                                                                                                            |
| `pnpm.cmd config:check`; `pnpm.cmd db:validate`                                        | PASS, exit 0; `.tools/p5-final-static.tsv`                                                                                                                                                                                                |
| `pnpm.cmd auth:schema:check`                                                           | PASS after exact application inverse-relation whitelist correction; `.tools/p5-final-affected.tsv`                                                                                                                                        |
| `pnpm.cmd build`; `pnpm.cmd --filter @mehran/api build`                                | Contracts build PASS in full gate; API argument-count error corrected, affected API build PASS, including latest authorization/scope fixes; `.tools/p5-closure-static.tsv`                                                                |
| `pnpm.cmd typecheck`                                                                   | PASS after affected fixes; `.tools/p5-closure-static.tsv`                                                                                                                                                                                 |
| `node --max-old-space-size=12288 node_modules/eslint/bin/eslint.js . --max-warnings 0` | PASS, full repository with unchanged lint rules. Standard 8 GiB invocation exhausted its heap; 12 GiB invocation passed. Latest five affected source/test files also pass; `.tools/p5-final-affected.tsv`, `.tools/p5-closure-static.tsv` |
| `pnpm.cmd architecture`                                                                | PASS: 846 modules, 5,850 dependencies, no violations; repeated after scope fixes                                                                                                                                                          |
| `pnpm.cmd format:check`; `pnpm.cmd openapi:check`                                      | PASS; `.tools/p5-final-artifact-checks.tsv`. Latest affected source, ADR and handoff formatting also passed                                                                                                                               |
| `node .tools/p5-run-scope.cjs`                                                         | PASS: all six previously failing scope cases / six files. Its direct Vitest command selects the six exact failure names; 167 other cases were unselected, not disabled. `.tools/p5-scope-final.log`                                       |
| Four-file PostgreSQL rerun (exact command below)                                       | PASS: 126 tests / four files, exit 0, including all 29 P5 cases, owner-only command denial and all three earlier runtime failures. `.tools/p5-runtime-acceptance.tsv`, `.tools/p5-runtime-acceptance-runtime-regressions.log`             |
| `node .tools/p5-preservation-check.cjs`; `git diff --check`                            | PASS: all 145 tracked migration files equal HEAD bytes, compose unchanged, M119–M121 frozen, no staged files, OpenAPI mirrors semantically identical, no local/secret candidate files                                                     |

The six scope regressions came from adding child-scope coordinates to existing
root decision inputs and treating a Company department as a separately billable
Team. Root usage inputs now preserve the approved free-mode contract; only actual
child Teams use their own commercial scope. All six exact failures pass without
changing the existing assertions. The three other full-checkpoint failures
were a communication burst timeout, a Team purge timeout and a finance connection
timeout under concurrent heavy validation. All three passed in the four-file
rerun, including the complete P5 suite and the new owner-only customer command
denial. Original test timeouts and database connection limits were preserved.

Earlier P5 fixture omissions (explicit archived flag and completedAt), a nullable
Company scope, duplicated history properties and duplicated event arguments were
corrected. No test timeout or connection limit was relaxed. OpenAPI has 1,536
operations and 14,020 validated references: 51 new Admin, 14 ordinary authenticated
and one anonymous pricing operation. Historical Client compatibility tests passed.

Affected PostgreSQL invocations (the first was spawned with a direct argument
array to preserve the literal test-name alternatives on Windows):

```powershell
node --env-file-if-exists=.env.test.local node_modules/vitest/vitest.mjs run --project integration apps/api/test/integration/companies.spec.ts apps/api/test/integration/project-core.spec.ts apps/api/test/integration/project-execution.spec.ts apps/api/test/integration/project-tools.spec.ts apps/api/test/integration/team-analytics.spec.ts apps/api/test/integration/team-interactions.spec.ts -t "does not revive child authority|executes free-mode feature decisions|checks aggregate growth ownership|applies retained usage-owner checks|uses the existing free growth seam|uses the free growth seam" --maxWorkers=1
pnpm.cmd test:integration apps/api/test/integration/platform-admin-commerce.spec.ts apps/api/test/integration/communication-lifecycle.spec.ts apps/api/test/integration/finance.spec.ts apps/api/test/integration/team-lifecycle.spec.ts --maxWorkers=1
```

No test was weakened, removed or disabled. Only affected checks ran during implementation;
the mandatory full gates ran at final phase acceptance with affected reruns for confirmed failures.

NOT RUN / excluded: E2E, frontend, deployment, live charging/providers, production
migrations, Docker/TLS/proxy/off-host restore release drills. The existing conditional
live-scanner check requires `CLAMAV_SMOKE_HOST` and is not claimed as passed.

Non-blocking observation: PostgreSQL tests emitted the pinned pg driver's warning
about concurrent `client.query()` use being deprecated for a future pg 9 release.
The affected tests passed with the approved current dependency versions. No driver
upgrade or unrelated refactoring was introduced.

Git: P4 is published as above; P5 remains uncommitted/unpushed on main. Owner compose
and historical SQL remain preserved. P6 is NOT STARTED and not authorized. No blocking
product decision or local acceptance blocker remains.

## End-of-batch report

- Batch: Platform Admin P5. Status: COMPLETE — LOCAL DEVELOPMENT.
- Scope implemented: all approved Plans/Entitlements, Subscription Management and
  Billing/Financial Operations requirements in the traceability table above.
- Files/modules: new `admin-commerce`, its contracts, public Spaces/storage
  adapters, lifecycle/export integration, worker wiring, runtime enforcement and
  focused security/migration/compatibility coverage. No dependency or frontend
  source changes. ADR 0077, OpenAPI and frontend handoff are current.
- Entities/migrations/constraints: 27 tables and 61 FKs in frozen additive
  M119–M121; historical bytes and checksums preserved; immutable financial and
  term histories, scoped currency constraints and unique deduplication keys.
- API/events/jobs: 51 Admin, 14 ordinary authenticated and one public operation;
  durable commercial events, private expiry notices and pg-boss reconciliation.
- Security/edge cases: independent Admin realm, MFA/capabilities, ordinary scope
  ownership, financial visibility grants, tenant isolation, exact money,
  concurrent idempotency, no duplicate credit/refund spending, no destructive
  expiration and no financial-history mutation. Default commercial enforcement
  remains OFF and future online providers cannot be activated.
- Commands/results and NOT RUN: recorded above; all applicable local gates pass
  through the full checkpoint and successful affected reruns. Release-only drills
  are deferred, not passed. No E2E was written or run.
- Deviations/ADRs: no product-scope deviation or outstanding owner decision;
  12 GiB lint heap is an execution-only accommodation with identical rules.
- Git: P4 alone was committed and pushed as `13c45246bad4fc817bf96dd8f5023c6cb7e17585`.
  P5 is uncommitted/unpushed, index empty; owner compose is byte-for-byte preserved.
- Next eligible phase: P6, NOT STARTED and excluded by the current instruction.
