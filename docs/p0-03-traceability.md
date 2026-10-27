# P0-03 traceability

| Approved requirement             | Implementation                                                             | Evidence                                                                                                        |
| -------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Authenticated reusable context   | session guard, RequestActor/CurrentActor, spaces capability                | reliability HTTP session/header spoof test; P0-02 lifecycle regression                                          |
| Scoped repository helper         | scopedWhere, explicit owner repositories                                   | unit scope override, real cross-space queries, composite receipt FK test                                        |
| Concurrency/version              | UserSettings revision, ETag/If-Match, compare-and-increment                | simultaneous HTTP writes: one 200/one 409; malformed tag; legacy PATCH                                          |
| Cursor pagination                | strict shared query schema, scoped cursor/keyset helpers                   | limits/malformed/cross-scope/cross-filter unit cases; tied-timestamp PostgreSQL pages                           |
| Safe errors                      | class-checked Prisma mapping and shared exception filter                   | ORM classification/envelope privacy tests; existing health/HTTP/security regressions                            |
| Transaction pattern              | owner transaction + explicit platform writers, bounded serializable helper | all-or-nothing settings/audit/outbox rollback; real serialization-conflict retry                                |
| Versioned minimal event envelope | OutboxEvent, account.timezone_changed v1, empty payload                    | DB payload/version constraints; payload rejection; correlation and live HTTP event                              |
| Durable commit-before-processing | same-transaction outbox                                                    | actual child-process exit before/after commit; fresh-connection persistence                                     |
| Idempotency storage/fingerprint  | scoped unique receipt, canonical hash, transaction lock, 24h expiry        | eight simultaneous retries: one effect; changed body conflict; actor/operation isolation; rollback/retry/expiry |
| Sensitive auth/account audit     | constrained metadata sink, intent/outcome protocol, atomic settings audit  | profile/auth/denial metadata assertions; no token/email/value; audit outage prevents sign-in                    |
| Migration safety/reset/upgrade   | additive SQL review; owned disposable-schema harness                       | empty replay, fixture-schema reset, P0-02 data upgrade/backfill, deploy/status/repeat deploy                    |
| API compatibility/OpenAPI/CI     | canonical P0-02 signatures + current snapshot; existing quality CI         | compatibility negatives; generated OpenAPI; full quality gate                                                   |
| No scope expansion               | passive platform storage only                                              | no worker, consumers, jobs, file endpoint, sync, or Phase 1 entities/routes                                     |

Commands and observed results are recorded in [the batch report](./p0-03-report.md).
