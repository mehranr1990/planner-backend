# P1-08 requirements traceability

Baseline: P1-07 pushed commit `4ad8c3bffdf65289111940d97361f3cfaff68642`.
Policies: approved [ADR 0014](adr/0014-private-writing-capture-and-search.md) and
[ADR 0015](adr/0015-private-voice-file-compatibility.md).

| Requirement                                          | Implementation                                                                  | Executable verification                                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Personal Notes, organization, archive/delete/restore | Notes module; versioned Markdown; Note/NoteFolder scoped repositories           | writing integration organization/lifecycle/history/large note cases; writing schema tests                        |
| Acyclic ordered folders                              | complete graph validation, maximum five levels; scoped serialized changes       | folder domain tests; concurrent reciprocal moves, depth and cross-user folder tests                              |
| Immutable writing and mood corrections               | stable logical UUID, typed physical revision, predecessor/current uniqueness    | integration old/new revision history and history pagination; compiled restart history                            |
| Private Journal and daily check-ins                  | distinct FREEFORM/CHECK_IN; unique current daily check-in; atomic optional mood | duplicate/concurrent daily check-ins; multiple freeform entries; compiled check-in persistence                   |
| Mood/energy and historical attribution               | subjective 1-5; VOID corrections; immutable localDate/timezone                  | score contracts; API correction/void, leap date, midnight/DST and account travel cases                           |
| Existing Task/Goal annotations                       | same-space typed FKs and owner public facades; no source mutation               | authorized and foreign references; retained deleted Task annotations/filter; unchanged Task assertions           |
| Explicit Inbox/capture types and retained source     | CaptureItem; INBOX/TRIAGED/ARCHIVED; typed target links                         | schema type tests; expense retention/archive and immutable triaged-source tests                                  |
| Atomic safe triage                                   | owner Task/Notes/Journal/Habit commands in outer SQL transaction                | injected post-target outbox failure rollback and retry; concurrent conversion; cross-user Habit failure rollback |
| Retry guarantees                                     | actor-scoped receipt and fingerprint, revision checks and Space locks           | same-key replay, changed payload, stale/concurrent changes; compiled replay after process restart                |
| Habit conversion through owning module               | CaptureHabits public contract, existing validation/history rules                | quantity Habit log conversion and typed target reference; existing Habit regression suite                        |
| Deterministic parsing preview only                   | version-1 trailing English date grammar, requested/account timezone             | parser unit tests and API no-write checks; compiled recognized preview                                           |
| Private voice attachment                             | dedicated WAV routes, strict bytes, owned READY FileCatalog, retained source FK | WAV policy tests; malformed/truncated/nonvoice/foreign/not-ready denial; compiled bytes after restart            |
| Old file API compatibility                           | unchanged four-MIME schemas and family checks                                   | old-route/voice-route rejection tests and frozen P1-07 contract signatures                                       |
| Scoped literal personal search                       | owner-provided current data, bounded merged keyset order/snippets               | literal wildcard, same UUID/time across types, query-bound cursors and isolation tests                           |
| Journal/Mood opt-in and no count leak                | private providers invoked only with per-request flags                           | provider spy, explicit private flags, later default request, private cursor scope and empty foreign results      |
| Metadata-only audit and outbox                       | safe action enum, empty capture.triaged v1 payload                              | integration audit/outbox and logging redaction tests; compiled private text exclusion                            |
| Privacy and authorization on nested operations       | verified owner Space, scoped repositories/FKs, safe validation/errors           | foreign IDs, history, filters, conversion targets and voice routes; anonymous file denial                        |
| Preserve PlanningReview and earlier modules          | no reflection duplication, no Task/Goal cross-module writes                     | planning data unchanged case; mandatory earlier integration and compatibility regressions                        |
| Safe migrations and previous data                    | five new registered entities; exact approved CHECK expansion                    | migration safety tests; empty/previous-schema/redeploy gate; dev/test full-row hashes and 15 checksums           |
| Contracts and module boundaries                      | strict Zod/OpenAPI; public facades only; no dependencies/workers                | writing OpenAPI route/security tests; all frozen prior signatures; architecture and auth-schema gates            |
| Compiled runtime and restart                         | pnpm smoke:p1-08, isolated fixtures                                             | real stop/start; writing/check-in/mood/WAV persistence; triage receipt replay and isolation                      |

Only Note, NoteFolder, CaptureItem, JournalEntry and MoodEntry are new business
entities. No AI, external NLP, transcription, finance posting, sync, worker,
notification, insight or later-batch implementation is included.
