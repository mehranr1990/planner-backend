# P1-01 requirements and verification

Scope: PHASE_0_1_IMPLEMENTATION sections 3 (Task and links), P1-01, approved Task
events and applicable security/quality requirements. No binding specification,
dependency version, provider-owned scalar schema or Phase 0 API contract changed.

| Requirement                                                         | Implementation                                                                | Verification                                                                                                                          |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Unified Task aggregate; strict input and rich versioned description | tasks domain/application/http, shared tasks.ts schemas                        | domain boundary tests; integration create/overposting/UTC/date-only/SQL and HTML data tests                                           |
| Task CRUD, explicit completion/reopen, revision preconditions       | TasksService and scoped repository                                            | HTTP concurrent update/completion, stale/malformed/missing revision, no-op and immutable history tests                                |
| Same-space subtasks; cycles and depth bound                         | metadata recursive queries, pure hierarchy rule, per-Space transaction lock   | self/descendant cycle, five-edge limit, subtree reparent height and concurrent cross-reparent tests                                   |
| Thirty-day subtree soft-delete/recovery                             | internal deletion batch and transactional subtree writes                      | ordinary descendants, preexisting trash, independent recovery/re-delete/detach, expiry and row preservation tests                     |
| Checklist CRUD/order, separate completion                           | checklist rows and Task revision/history                                      | deterministic tie ordering/cursor, reorder, wrong parent, stale version and parent OPEN tests                                         |
| Case-insensitive scoped labels; CRUD and Task links                 | Label functional unique index; typed TaskLabel composite FKs                  | duplicate name per owner, foreign lookup/filter/mutation, link retry, rename/delete revision/history tests                            |
| Existing private file binding/unbinding                             | typed TaskAttachment; storage public FileCatalog                              | real READY upload bind, incomplete/foreign deny, safe metadata, deleted-file unlink, readiness lock/rollback and cross-space FK tests |
| Scoped reads, lists, nested IDs and creator distinction             | spaces public authorization, scoped repository                                | foreign Task/action/nested read tests; creator is not ownership; audit denial evidence                                                |
| Durable atomic events/history and optional creation retries         | existing outbox/idempotency facilities                                        | rollback, exactly one concurrent completion transition, safe empty events/history, replay/body/actor/parent tests                     |
| Bounded pagination, session and CSRF security                       | existing guard/Origin middleware and scoped keysets                           | cursor abuse/context/owner/filter bounds, revoked/unverified sessions, trusted PUT preflight                                          |
| Safe additive migration and integrity                               | fourth reviewed migration; no changes to previous migrations                  | FK/check tests; migration gate empty schema and populated P0-04 upgrade/redeploy; local DB checksums                                  |
| Stable Phase 0 contracts, architecture and tooling                  | OpenAPI generation + P0-04 signatures; existing CI rules discover tasks owner | contract route/security/revision tests, Phase 0 compatibility signatures, full existing regression suite and architecture gates       |

Implementation policies and route details are recorded in
[task operations](./runbooks/tasks.md). They use the specified default depth and
retention, a versioned Markdown representation, typed attachment integrity and
existing transaction capabilities. No architectural deviation or new ADR is
required. No Phase 1 job, recurrence, Goal, calendar, bulk or sync capability is
activated. P1-02 remains unstarted.

Verification results and migration checksums are recorded in
[the batch report](./p1-01-report.md). Docker deployment verification is DEFERRED,
never reported as a local pass.
