# P2-05 local contract

Shared remains disabled by default. Operator retention approval, independent
control/checkpoint, security acceptance and operational release gates remain
mandatory. Synthetic isolated fixtures authorize no real workspace activation.

Tasks owns workflow state, field metadata, dependencies and schedules. Projects
orchestrates only through Tasks and Spaces public contracts. Existing Task status,
Personal APIs, assignment consent and Calendar links retain their contracts.

## Workflows

`/projects/{projectId}/workflows` lists/publishes registries; `/{workflowId}/versions`
reads an explicit `?version=` or publishes with registry If-Match. Publication
requires `workflow.publish`; immutable versions contain up to 32 states/128 edges.
States map to the existing OPEN/IN_PROGRESS/DONE/CANCELED Task categories.

Task `/workflow` reads or explicitly binds a version/state with source If-Match,
`workflow.publish` and `task.update`. Binding preserves the existing base status.
Publishing a version never migrates existing bindings. `/workflow/transitions`
requires `workflow.transition`, source visibility and the target status write
capability. Old status PATCH follows a unique nonapproval edge; it cannot bypass
an approval or choose between ambiguous custom states. Unbound Tasks are unchanged.

Approval requests expire after 30 minutes. `/workflow/approvals` lists source-bound
history; `/{approvalId}/approve` or `/reject` uses approval If-Match. Approved
[ADR 0032](adr/0032-designated-workflow-approval.md) requires the exact designated
member/generation, current requester/approver eligibility and policy, current
source revision and pinned transition. Requesters, including Owner, cannot approve
themselves. No notification channel or new broad grant action is introduced.

## Fields

`/custom-fields`, `/{fieldId}/versions` and `/{fieldId}/deprecate` manage immutable
typed versions under `work.manage`. At most 100 fields per scope; types are fixed
for the lifetime of each field. Options/defaults belong to a particular version.
Explicit null defaults are retained. Published content cannot be appended/edited
after its publication transaction, including through direct SQL.

Task `/field-values` reads persisted values; `/{fieldId}` PUT uses source If-Match
and `task.update`, including eligible named Task grants. Exactly one of `value`
or `useDefault: true` is required. Defaults never silently retrofit Tasks. Old
values remain pinned to old versions/options. Soft deprecation blocks writes and
filtering while retaining values/history. Person values reference concrete scoped
admissions/generations; they do not imply assignment or expose account identities.

TEXT, NUMBER, DATE, BOOLEAN, SINGLE_SELECT, MULTI_SELECT, PERSON and CURRENCY are
validated by type. Decimal values are exact strings, with up to 24 integer and six
fractional digits; currencies use the existing frozen ISO register and scale.
Text is bounded to 2,000 characters, options to 100 and multiselections to 20.

POST `/task-search` requires scope-wide `task.read`; a named Task grant cannot
search a Project. Filters use persisted typed values and versioned indexed columns.
EQ applies to scalar types; ordered comparisons apply to number/date/currency.
HAS on a select field accepts one selected option (a one-item array for multi).
Pagination is bounded and signed against current authority and filter identity.

## Dependencies and explicit rescheduling

`/dependencies` reads or creates typed FS/SS/FF/SF edges. PATCH changes signed lag
minutes; DELETE soft-retires an edge. Mutations require `work.manage`. All kinds
participate in the same DAG; self/cross-scope links and cycles are rejected under
custody fencing and PostgreSQL constraints. Safety bounds: 1,000 graph Tasks,
5,000 active edges and lag/lead within plus/minus 525,600 minutes.

Edges never silently move dates. Existing direct schedule writes validate adjacent
timed constraints. POST `/reschedule-previews` explicitly supplies an anchor/source
revision and schedule, then computes later shifts of affected descendants while
preserving duration. Missing/date-only endpoints never acquire an invented time
zone; timed graph planning requires explicit instants.

`/{previewId}` reads the creator's admission-bound immutable manifest; `/apply`
requires its hash/If-Match, current `work.manage`/`task.update`, source revisions,
graph revision and custody authorization version within 30 minutes. Any relevant
change invalidates the preview. Final schedules/history commit atomically; retries
of an applied plan do not repeat writes. Unchanged predecessors are included in
the manifest's revision checks. Source metadata history has its own Task-owned
append-only stream; the legacy TaskChange field contract is preserved.

All 26 new HTTP operations are strict, session-authenticated, no-store, Origin
protected for unsafe methods and represented in generated OpenAPI. Publication,
transition request and preview creation use scoped idempotency keys. Durable
initial creation replay remains safe after receipt expiration and does not add
usage/audit effects. Existing API signatures remain frozen through P2-04.
