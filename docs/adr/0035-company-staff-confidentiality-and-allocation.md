# 0035: Proposed Company staff confidentiality and allocation authority

Status: **APPROVED by owner, 2026-11-07**, through explicit approval of this
proposal for local P4-02 implementation in the project session.
Scope: P4-02 local implementation only; no commit, push or production activation.

## Why a decision is required

The approved V3 roadmap assigns staff work profiles, sensitive employee case files,
basic availability and resource/equipment allocation to P4-02. Its
[Company specification](../../MEHRAN_BACKEND_PRODUCTION_V3_2026-10-30/03_PHASE_2_TO_7_BACKEND_SPEC.md)
requires separate personnel-file authorization and explicitly denies Company Admin
access to sealed files without a grant. The audit also identifies the missing HR
disclosure matrix as a prerequisite before this slice.

[ADR 0034](0034-company-foundation-roles-and-inheritance.md) authorizes metadata
only: structure administration grants no employee content access, and its policy
catalog contains only `structure.read` and `directory.read`.
[ADR 0033](0033-team-confidentiality-and-reviewed-disclosure.md) supplies an approved
Team confidentiality pattern, but explicitly grants no Company inheritance.
Under AGENTS.md sections 1 and 5, extending either rule requires an owner decision.

## Approved permission matrix

All actors need current verified identity, active Company root admission and
current lifecycle authority. Child-context participation additionally requires
explicit admission bound to the current root generation. Scope and subject
admission generations are checked on every operation, including receipt replay.
Company role names and existing policy keys remain unchanged.

| Resource / operation                                | Approved authority                                                                                                                                                           |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work profile create and administrative update       | Owner / Org Admin; Dept Manager only for subjects explicitly admitted in the same child context as that manager                                                              |
| Work profile read / list                            | Current full members in its explicit Company or child context, subject to effective directory policy; no implicit access through a parent role                               |
| Publish or withdraw verified work contact           | Subject only, explicit opt-in; hidden by default; use the current provider-verified email, never manufacture verification for supplied text                                  |
| Work profile position, supervisor and work status   | Administrative authority above; supervisor must be an explicitly eligible same-Company member; work status never changes login, membership, permissions or employment rights |
| Availability read / list                            | Same admitted-context visibility as work profiles; only explicit planning date, timezone and available minutes                                                               |
| Availability create / update / clear                | Subject for self; Owner / Org Admin; Dept Manager only in the shared explicitly admitted child context                                                                       |
| Resource/equipment metadata read / list             | Current full admission in its explicit context; parent membership alone grants no child access                                                                               |
| Resource/equipment create / update / retire         | Owner / Org Admin; Dept Manager only in their explicitly admitted child context                                                                                              |
| Allocate / cancel / record return                   | Same resource management authority; recipient must be a current full member explicitly admitted in that resource's context                                                   |
| Sensitive case create                               | Owner / Org Admin; Dept Manager only for a subject in their shared explicitly admitted child context; distinct author, subject and named reviewer required                   |
| Sensitive case and entry read / list                | Only recorded author, subject and named reviewer, with current admission and matching recorded generation; reviewer additionally remains Owner / Org Admin                   |
| Sensitive case entry / correction                   | Author may append evidence/correction; subject may append response or appeal, including a Viewer subject; named reviewer alone appends reasoned review/resolution            |
| Sensitive content disclosure / export / new readers | Denied in P4-02; no broad directory publication, administrator override, role-wide reader, break-glass mechanism or arbitrary grant delegation                               |

An administrator may not designate themselves on an existing case to acquire its
contents. The reviewer is fixed at creation, differs from author and subject and
has no authority after demotion or loss of the recorded admission. A case's
explicit participant bindings constitute its narrow content authorization; they
never grant access to another case. No new HR role or permission language is added.

Ordinary work profiles contain bounded work information, separate from confidential
case bodies. No national identifier, home address, medical field, salary, private
contact, personal performance score or automatic employment consequence is added.
Company employment/profile status, membership and identity remain distinct.

## Availability and allocation behavior

Reuse the established work-capacity convention: explicit civil date and IANA
timezone, integer 0–1440 available minutes, null for unknown, zero for unavailable.
These Company records do not read or rewrite Personal or Team capacity, Calendar,
Focus, Tasks or private absence reasons. No automatic task assignment, cross-context
capacity aggregation or capacity-based rejection is introduced.

Initially each resource represents one individually allocatable item. An allocation
has an explicit recipient and half-open UTC interval `[startAt, endAt)`, with end
strictly after start. Overlapping effective allocations for the same item conflict
atomically; adjacent intervals are allowed. Cancellation and recorded return are
audited state transitions, with immutable original allocation facts. Retirement
rejects outstanding allocations rather than deleting them. Recording a return
does not assert recipient acknowledgement, payment, penalties or a lending contract.
Quantity pools, recurring bookings, approval workflows and automatic reassignment
are outside this batch.

## Confidentiality, departure and erasure

Sensitive content and original entries are immutable except for explicit privacy
redaction; corrections and appeals append history. Reads are audited with opaque
case/entry IDs, actor and action only. Text, work contacts, reasons, evidence and
appeals never enter audit, outbox, receipts, signed recovery evidence, logs, metrics
or general search. Lists filter authorization before pagination and visible counts.

Departure, suspension, identity closure and root rejoin immediately deny old
bindings. Rejoin grants no historical case or availability authority. Remaining
eligible participants may read retained cases under their original bindings.
Membership changes do not silently delete another participant's shared history.

Independent Personal erasure remains unblocked. Explicit erasure of the subject's
sensitive profile/case removes its contact and confidential payloads while retaining
only opaque structural/audit evidence required for integrity. Restrictive signed
evidence must prevent restored payloads from being served after redaction; missing
or unresolved evidence fails closed. Company retention is not permission to retain
subject-sensitive content indefinitely. No legal hold or jurisdiction-specific
retention period is invented; an applicable approved obligation requires a separate
reviewed disposition before the affected erasure can be implemented or enabled.
Automatic Company disposal and operational lifecycle reconciliation remain P4-06.
Production HR/legal acceptance remains a separate release gate.

## Implementation and acceptance after approval

Companies owns these records; Spaces continues owning admission and fences. Reuse
existing identity, receipts, audit/outbox, free-mode usage and restrictive restore
infrastructure. Use typed same-Company/context/admission-generation FKs, immutable
identity bindings and revisions. PostgreSQL constraints and custody fencing must
prevent overlapping allocation and stale-authority commits.

Prepare strict Zod request/result contracts and proposed routes before code. Publish
only real implemented operations in generated OpenAPI. Use bounded signed pages,
Origin enforcement, no-store, Idempotency-Key for creation and If-Match for updates.
Reauthorize before receipts or confidential output. Preserve all 557 P4-01 and prior
operation signatures, independent ownership and Personal erasure behavior.

Required evidence: permission matrix including Viewer subjects, non-enumerating
cases/counts and nested IDs, contact consent/withdrawal, generation/reviewer
invalidation, observed revocation-versus-write/read ordering, overlap/adjacency and
concurrent allocation, cancellation/return/retirement, erasure/restore denial,
atomic receipt/usage/audit effects, populated predecessor migration preservation,
compiled restart smoke and one complete mandatory quality gate with affected reruns.

Shared activation stays disabled. File uploads/attachments, Company integrations,
Company attachment of independent Teams/Projects, finance, exports, deployment and
P4-03 are not activated. Existing Team confidential records remain Team-owned.

Owner decision: this matrix and behavior are approved for P4-02 local
implementation. Approval does not authorize commit,
push, deployment, production migration or a later batch.
