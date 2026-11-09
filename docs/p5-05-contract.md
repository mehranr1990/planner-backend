# P5-05 meeting and announcement contract

Authority: approved ADR 0048 and V3 Phase 5 specifications. P5-03 was published at
`4515f1516f9dcdb4274c4a20b5981f444d7b019d` before this local implementation.
The generated [OpenAPI](api/openapi.json) defines 52 additive operations.
All 736 published operations and every historical signature remain compatible.

## Meetings

`/api/v1/meetings` supports creation, personal discovery and invitation discovery.
Named invitations require an explicit ACCEPTED or TENTATIVE response at
`/meetings/invitations/{invitationId}/respond`. Pending recipients get only title,
schedule and invitation state. Full content additionally requires current source
membership, admission generation, active identity/custody and restore generation.
Source roles alone never admit a participant. Grant-only access is insufficient.

`/meetings/{id}` supports reads and organizer schedule/URL/state changes.
Its invitations, members and agenda endpoints support named offers/revocation,
delegation/removal/leave, proposals and organizer selection. Delegating an
independent organizer gives that admitted participant actual scoped management
authority; it neither changes custody nor promotes participants automatically.
Work organizers also need their exact source's approved management role.
Viewers may read and respond for themselves, without shared writes.
Accepted RSVP remains discoverable for explicit later changes. Cancellation
synchronizes the authoritative Calendar status; organizers may still revoke
participants after cancellation.

The Calendar owner creates the sole authoritative event. Personal/independent
meetings have MEETING custody rather than a fake Personal authorization object.
Project, Team and Company-root meetings stay in the exact source. New Team meeting
events are filtered before Calendar pagination for unadmitted callers; direct
Calendar writes require organizer admission. Existing Team Calendar/meeting
visibility remains intact. `POST /teams/{id}/meetings/{meetingId}/extend` reuses the
legacy Calendar event and imports its agenda without narrowing the old API.

`/meetings/{id}/versions` creates immutable content snapshots: selected agenda,
minutes, decisions, action items, attachment IDs and contributors. A correction
creates a new version, optionally identifying its parent. Reviewer assignment,
submission, review, withdrawal and finalization use current revisions. Only the
named separate reviewer approves; the organizer finalizes that exact approval.
Withdrawal requires fresh review. A sole independent owner can self-finalize only
while no other participant has ever been admitted. Current author/reviewer
eligibility is checked again at finalization. Draft bodies and review reasons are
limited to organizers, author, explicit contributors and reviewer; final readers
do not receive private review notes. New admission grants current published
document versions, including versions finalized before admission.

An action's `/release` is explicit organizer permission to publish its immutable
text to the work source's broader Task audience. `/tasks` explicitly creates or
links an authoritative Task through the Tasks public facade. Work conversion stays
in the exact source and requires current Task creation authority and a current
valid release. One work Task link exists per action. Independent conversion goes
only to the requesting participant's Personal Tasks; other participants cannot
list that private Task link or body. Commands replay without duplicate Tasks;
erasure can null a Task pointer while retained shared decisions survive.
The Tasks transfer owner recognizes the new FK through a narrow Meetings public
reference count. Its existing REJECT reference policy blocks moving a linked
private Task; unlinked Task/checklist transfers retain their previous behavior.

## Private files

Meeting and announcement `/attachments` endpoints initiate, list, inspect,
complete, cancel and download private files through SharedFiles/StoragePort.
Completion streams `application/octet-stream`; an empty JSON READY retry returns
metadata. Existing size/type/hash/filename constraints apply. Upload claim and
final commit independently check authority, as do download lookup and stream-open
handoff. Pending/revoked participants, foreign parents and unapproved draft
readers get no bytes. Work downloads additionally require `file.read` under the
source's existing policy, including default Company denials.

Meeting uploads begin private to the uploader. Explicit organizer `/share` exposes
an unlinked own upload as agenda material; otherwise version links control draft
or final visibility. The `shared` metadata flag denotes direct agenda sharing,
not every possible authorized version link. Announcement uploads become readable
through an eligible published version. Linked/shared files cannot be canceled.
The existing durable worker sweep rechecks authority and collects expired,
unlinked files in bounded batches; linked content remains protected by retention.

## Announcements and private acknowledgement

`/api/v1/announcements` creates exact Project/Team/Company-root announcements.
Scope lists, versions, publish/withdraw, pin and acknowledgement operations use
current source authority. Only source managers read drafts and publish; they
retain version-history access for administration. Recipient ALL or NAMED audiences
are snapshotted with current access/restore generations at publication.
New/rejoined recipients do not acquire old publications. Publishing a
replacement withdraws the previous publication atomically; body, attachment
identity and target snapshots cannot silently change. Pinning broadens no access.

An optional acknowledgement is explicit, personal and idempotent. GET/download
does not acknowledge. A recipient sees only their own acknowledgement; source
managers see aggregate eligible/acknowledged counts without reader IDs or times.
Closure/erasure removes private acknowledgements while retained shared content
survives. There is no shared read-activity event or message receipt inference.

## Compatibility and operations

All new operations use verified sessions, strict Zod parsing, no-store responses,
current authorization, opaque IDs and existing rate limits. Revision-bearing
commands require quoted If-Match; idempotent commands require Idempotency-Key as
documented in OpenAPI. Lists use signed cursors and authorization before content
projection/counting. HTTPS meeting URLs are stored, never fetched or executed.

Domain changes use existing metadata-only shared audit/outbox and usage policies;
no new queue, provider or dependency is added. Discovery uses REST polling.
Messaging, delivery/read consent, chat Push and their retry/subscription contracts
remain unchanged. Meetings and announcements create no new chat Push events.
P5-04 realtime transport and P5-06 lifecycle work remain deferred. Existing source
disposal returns MEETING_RETENTION_PENDING before any destructive owner cleanup
when these retained resources exist. There is no deployment or Shared activation.
