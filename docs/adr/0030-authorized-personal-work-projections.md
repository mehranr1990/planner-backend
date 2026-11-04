# 0030 / A07: Authorized Personal projections of shared work

Status: APPROVED by owner for implementation planning, 2026-10-30.
Execution still requires explicit batch authorization.

## Decision and proposed contract

Preserve Personal /tasks, /goals, calendar, sync and export contracts. Add separate
shared-view schemas and proposed routes GET /me/work/tasks, /me/work/goals and
/me/calendar/overlays. These are not existing OpenAPI operations.

- Accepted shared assignments appear in shared-work Tasks and calendar overlays.
  Pending assignments expose only the authorized acceptance preview. Assignment
  Pending/Accepted/Declined is independent of Task status; primary assignee and
  contributors remain distinct. Require a reason on decline and audited reassignment.
- Owner modules return current authorized source state/IDs; never copy Task/Goal rows.
- Goals are current permission-filtered projections, not invented Goal-assignment states.
- Calendar range initially max 93 local dates, page max 100; stable cross-source
  ordering and source UUID dedup. Preserve timezone/date-only/recurrence semantics.
- Counts/filters/cursors use the same source visibility. Sign/bind cursors to actor,
  query, source scopes and authorization versions; changed versions invalidate
  safely. Revalidate current source visibility, not merely the cursor signature.
- Departure, grant revocation and closure remove source visibility. No private
  Focus/Journal/Mood/Finance or annotations enter workplace projections.

## Optional private scheduling

TimeBlockSharedTaskLink has a Personal block FK, shared Task/scope FKs and selected
source revision. Enforce exactly one Personal or shared Task-link shape; preserve
the current same-Space TimeBlock FK and old response shape. Create private blocks
only by explicit action/user preference, without silently persisting source content.
The title is user-controlled. After source revocation the user may retain their
own private scheduling block with unavailable source detail.

Shared work does not enter the Personal sync feed. Personal export includes owned
private scheduling/reference metadata, never an implicit shared-resource export.
Personal Task/history DTOs keep their non-null User attribution; shared views use
dedicated actor-reference schemas.

## Alternatives, migration and acceptance

Reject Personal Task copies and broadening current Personal APIs into shared
extraction. Typed links preserve source identity without dropping same-Space FKs;
add only when P2-04 or the approved transfer slice requires them. See
[0028](0028-shared-references-and-custody-transfer.md) and
[migration plan](../g0-implementation-prerequisites.md).

Required VIEW-01–10: acceptance/decline, dedup, source filters, stale cursor,
revocation/closure, timezones, optional private block, Personal export boundaries,
source unavailable disposition and private Focus nondisclosure.

Owner approval: explicit approval of revised A01–A08 for implementation planning.
