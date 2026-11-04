# P2-05 execution record

Status: COMPLETE for local implementation. Owner accepted P2-04 and explicitly authorized P2-05.
HEAD remains `d0945368169baf9f97669ba420847d949533715d`; accepted P2-04 work is
uncommitted and must be preserved. Existing untracked architecture/frontend handoff
documents remain untouched. No commit, push, deployment or production DB change.

Scope: immutable workflow versions, controlled custom statuses/transitions and
approvals, typed/versioned/deprecated custom fields and bounded filters, directed
FS/SS/FF/SF dependencies with signed lag/lead, explicit reschedule preview/apply.
P2-06 risks/issues/templates/bulk/CSV/reporting/workload are not started.

Tasks owns source status/schedule, workflow/field/dependency records and guards.
Projects orchestrates through its public Task facade under the existing account,
identity/session and custody locks. No reverse Projects import into Tasks and no
second Task engine. New metadata/status endpoints preserve all prior DTOs and
Personal/Shared/Project/assignment/calendar contracts. Published workflows pin
in-flight Tasks; explicit binding/migration never silently rewrites existing state.

Completed work: pure domain rules and tests; typed additive M07 persistence and
reviewed hash/rehearsal; Task-owner facade/guards on existing write paths; Project
HTTP/Zod/OpenAPI and compatibility signatures; targeted adversarial/concurrency,
typed-filter, stale-manifest and source-compatibility tests; final 13-stage gate
once, compiled restart and required affected regressions.

Owner decision recorded in [ADR 0032](adr/0032-designated-workflow-approval.md):
current eligible full-member approvers are designated per transition and bound to
their admission generation; requester self-approval is forbidden. The owner
explicitly accepted this rule during P2-05. No further product decision is pending.

Implemented: pure directed-graph validation, signed lag/lead checks and read-only
reschedule calculation. Planning preserves elapsed duration, only shifts affected
descendants later as needed, does not alter unrelated sources, and never invents
zoned instants for date-only Tasks. Source revisions, graph/auth versions, manifest
hash/expiry and current permission are checked again at apply.

Real Shared activation remains gated by approved operator retention, independent
current control/checkpoint, security acceptance and operational prerequisites.

Final evidence: 496 nonintegration plus 504 integration tests pass. The 13-stage
gate ran once; its three failed tooling checks were corrected and rerun alone.
All final gate stages and the five compiled smoke commands pass. M07 rehearsals
preserve 98 prior table data sets, 1,536 constraints (apart from the approved
additive feature CHECK), and all 33 prior checksums. No repeated full suite.
See [completion report](p2-05-report.md). P2-06 is NOT STARTED.
