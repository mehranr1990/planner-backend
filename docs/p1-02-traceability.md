# P1-02 requirements traceability

Authority: MP-IMP-001 P1-02, shared sections 3/5/6/7/10.5 and owner-approved
[ADR 0008](./adr/0008-task-recurrence-semantics.md).

| Requirement                                                          | API / persistence                                                                   | Verification                                                                                                                                                                   |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Master/occurrence separation, unified Task identity                  | task-recurrences, TaskRecurrence.masterTaskId; TaskOccurrence.taskId                | Integration: master identity/history/exclusion/action denial; independent Task completion/reopen; compiled restart smoke                                                       |
| Daily, weekly, selected weekdays, monthly date/nth, yearly, interval | Version-1 definition, strict RecurrenceRuleSchema; pure recurrence.ts               | Domain parameter matrix; invalid schedule contracts; persisted monthly/leap tests                                                                                              |
| Start/end, timezone and exclusions                                   | Inclusive local dates, IANA timezone, explicit policy fields                        | Domain exclusion/start/end; persisted month/leap; account timezone change; midnight                                                                                            |
| DST gaps and folds                                                   | SKIPPED/DST_GAP with nullable taskId; earlier fold instant                          | New York, Lord Howe half-hour transitions, Apia missing day, local midnight; persisted DST skip/fold; compiled smoke                                                           |
| No duplicate occurrence, concurrent/retried generation               | Unique (seriesId,recurrenceKey), scoped FKs; space transaction advisory lock        | Five concurrent generators, cursor replay, creation/history/outbox counts; DB uniqueness/FK failures                                                                           |
| Bounded catch-up and safe progress                                   | POST task-recurrences/{id}/catch-up; scannedThrough; scoped revision-bound cursor   | Sparse domain scan ≤366 days; paginated generation and replay; invalid foreign/stale cursors; injected rollback; smoke process restart                                         |
| Completion/skip/cancel and no implicit DONE                          | occurrence action routes and ordinary Task mutations                                | Lifecycle coupling, skip/cancel/stale revisions, no skip completion event; delete/restore; sibling/master independence                                                         |
| THIS_OCCURRENCE                                                      | Pending exception, original recurrence key and Task UUID retained                   | Exception-only edit and retained schedule on entire edit; mismatched nested ID denial                                                                                          |
| THIS_AND_FUTURE                                                      | Linked successor, cutoff, retained/canceled old records                             | Split lineage, earlier preservation, future terminal retention, successor no duplicates; retired-edit denial                                                                   |
| ENTIRE_SERIES                                                        | Definition and optional scalar taskPatch; nonterminal non-exceptions only           | Stable identities across wall-time edits, immutable terminal gap/history, explicit timezone changes; affected gap cancellation/history                                         |
| Templates and safe application                                       | TaskTemplate CRUD/apply; version-1 values; scoped receipt                           | No ownership/parent/file/lifecycle injection; unchecked checklist; source revision; concurrent application/replay; copied Task independent of source edits/deletion            |
| 100-item partial bulk with per-item errors                           | POST tasks/bulk; existing Task command paths; savepoints/JSON result receipts       | 100 mixed owned/foreign/stale items; malformed item plus six supported lifecycle/link actions; concurrent replay, whole-request binding, foreign-key isolation, key/cap checks |
| Normalized validated saved DSL                                       | SavedTaskFilter CRUD and tasks execution                                            | No SQL/operators/cursors; canonical flags/UTC bounds; scoped nested IDs checked again after Label deletion; foreign resource and result denial                                 |
| Existing revisions/history/files/audit/outbox                        | Existing Task/TaskChange/StoragePort plus metadata audit; no new event types/worker | Phase 0/P1-01 regressions; safe metadata/empty event payloads; atomic rollback; compiled single completion event                                                               |
| Additive migrations and preserved existing data                      | Fifth migration; four tables and one nullable receipt column                        | Empty namespace/prior-schema replay; preserved Task/checklist/attachment/settings/file/audit/outbox/receipt fixtures; repeat deploy and checksums                              |
| API compatibility and architecture                                   | Existing modules, shared Zod/OpenAPI; frozen P1-01 signatures                       | task-tools-openapi.spec.ts; all prior signatures; dependency-cruiser and deliberate forbidden-import/cycle probes                                                              |

Main executable suites:

- `apps/api/src/modules/tasks/domain/recurrence.spec.ts`
- `packages/api-contracts/src/task-tools.spec.ts`
- `apps/api/test/integration/task-recurrence-tools.spec.ts`
- `apps/api/test/contract/task-tools-openapi.spec.ts`
- `tooling/scripts/migrations-check.ts`
- `tooling/scripts/p1-02-smoke.ts`

The final gate is `pnpm quality`; compiled functional evidence is additionally
produced by `pnpm smoke:p1-02`. Docker/deployment checks remain DEFERRED. No
P1-03/later feature, worker, new provider or dependency is implemented.
