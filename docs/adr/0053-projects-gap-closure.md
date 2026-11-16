# 0053: Projects gap closure

Status: Owner-approved P2-GAP-CLOSURE scope, 2026-11-15; key namespace decision
explicitly approved by the owner, 2026-11-16.

Extend the existing Projects, unified Tasks, Workflows, Invitations, Notifications
and private StoragePort owners. Preserve custom Project templates and existing
resource grants; neither receives new product capability. Initial setup offers
exactly version 1 Blank, Kanban and Scrum, with deterministic structure IDs.
Kanban uses existing native statuses/transitions. Scrum adds Backlog/Ready sections;
it does not invent sprint dates or admit Team members into a Project.

Task deletion uses the existing soft-delete/deletion-batch convention. Active
children block parent deletion; assignments end with REVOKED, dependency edges
retire, source and linked history remain. Real subtasks share the depth-five Task
engine. Ordering belongs to ProjectTask; changes advance the source revision and
the association revision atomically. Ordering cursors bind the current ordering
snapshot. Independent concurrent changes serialize through existing custody fences.

Withdrawal preserves an accepted assignment and creates a new pending offer to
the same recipient, after rechecking issuer authority. Reminder delivery reuses
the existing in-app preference/outbox pipeline and Team's once-per-UTC-day limit.
No scheduler or notification channel is introduced. Drafts never mutate published
workflow versions or existing pinned task bindings.

Inviter HTTP responses never contain recipient acceptance proofs. Resend rotates
the proof, preserves the invitation identity and uses the existing in-app offer
mechanism; sentAt does not claim SMTP delivery. Optional decline notes are private
to authorized invitation management. Existing direct internal invitation methods
and Team behavior remain compatible.

Independent Project keys are unique in the current owner's account. A Project
created with an explicit authorized Team selection uses that Team's namespace;
ordinary portfolio references do not silently change its key namespace. Existing
keyed Projects with one active Team reference are migrated to that namespace;
multiple references or unresolved owners block migration. Preserve original key
spelling and stable IDs/URLs; PostgreSQL generates lower(trim(key)) for uniqueness.
Typed User/Team FKs and two unique constraints enforce concurrency. Custody
handover updates the independent namespace transactionally. Team deletion rehomes
its namespaces to current Project owners. Any collision blocks the whole change;
no automatic renaming. Null keys remain supported. Read-only preflight on both
local databases found zero existing non-null keys/duplicates/ambiguities.

Phase and milestone progress derives from currently authorized non-deleted Tasks;
CANCELED tasks are excluded from the denominator, empty progress is null. Links
with two explicit different phases are rejected, including component edits.
Advisory health uses factual overdue/blocker/deadline/completion evidence and
UNKNOWN otherwise. It never changes lifecycle or permissions. Cycle time starts
at the first recorded IN_PROGRESS event and ends at current DONE, including reopen
intervals; missing evidence is unknown. Analytics use current visible task and
primary-assignee membership, union overlapping shared logs per recorded member,
and expose their basis. Personal colleague schedules are never imported. Capacity
stays unknown without explicit authorized Project availability.

Risk identity and closure/checklist/conversion metadata extend existing register
items with scoped R-/I- codes. Numeric probability stays 0–100. Conversion retains
the source status and creates one typed linked target in a single transaction.
Risk comments reuse existing comment/version authorization. Detailed activity uses
actual new event details, safe field allowlists and current authorization; earlier
events retain missing details. Workflow drafts require publish authority to view.

File folders and versions reuse existing ProjectFile/StoredFile attachment and
private byte pipelines. Original binary is version 1; later versions are separate
real uploads. Highest numbered READY version is current. Original attachment IDs
remain valid. Root deletion denies all version downloads and marks their binaries
for existing cleanup. Metadata and binary revisions are distinct. Configuration
reports the effective minimum of storage configuration and the existing upload DTO
bound. No public storage URL is added.

Migrations 060–070 are additive to the 84-migration Personal checkpoint. Old SQL
and data are preserved; backfills write only new metadata. The reviewed FK catalog
contains 970 entries. Unknown references continue to block all shared disposal.
No deployment, Shared activation, development migration, frontend write, commit
or push is authorized by this record.

Account erasure: an irreversibly ERASED current owner loses the account key
namespace identity; a private erased-owner tombstone preserves the original key
and Project history without retaining the User ID or blocking Personal erasure.
Migration 070 enforces this in the existing actor-erasure and identity-FK pipeline.

Finalization authority (owner-approved, 2026-11-16): apply the tested 060–070
migrations to local mehran_dev, verify both local databases and relevant gates,
commit the approved P2 batch and push normally to origin/main. This extends the
implementation checkpoint's Git/local-development boundary only. Production,
Shared activation, frontend changes and subsequent implementation batches remain
outside this authorization.
