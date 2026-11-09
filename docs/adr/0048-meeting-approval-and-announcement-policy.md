# 0048: P5-05 meeting audience, minutes approval and announcement acknowledgements

Status: **APPROVED by the owner**, 2026-11-09. The owner explicitly selected
the recommended option for all three decisions below.
P5-05 local implementation is authorized after independently verified P5-03
publication at `4515f1516f9dcdb4274c4a20b5981f444d7b019d`.
The three content-disclosure, approval and acknowledgement decisions below are
now binding for the authorized local implementation.

## Existing approved contract

V3 documents 01/03/05 require independent/personal and Project/Team/Company
meetings, invitations/RSVP, agenda, minutes draft/review/approval/final, decisions,
authoritative Task action items, attachments, external meeting URL, and scoped
published/pinned announcements with optional acknowledgement.

ADR 0033 deliberately limits old Team meetings to Team-readable Calendar
scheduling/agenda and current-member invitations. Its published API and that
visibility cannot be narrowed by this batch. ADRs 0045–0047 settle conversation
admission, messaging history/receipts and chat Push; they do not authorize meeting
minutes access, minutes approval or announcement reader identification.

No new retention period, realtime transport, external meeting provider, native
call, automatic Task copy or new external Push event is inferred.

## Decision 1: Meeting participation and content authority

**Approved: named acceptance protects full meeting content.**

- An independent meeting's verified active creator is its organizer. Named
  verified active invitees see only their own safe invitation summary: meeting
  title, schedule/timezone and external meeting URL only after acceptance.
  The invitation exposes no minutes, attachments, decisions, participant list,
  confidential agenda or unrelated calendar. No anonymous content preview.
- ACCEPTED or TENTATIVE is explicit admission. DECLINED/pending/expired/revoked
  invitations grant no full-content access. A participant may leave or decline;
  later re-admission is explicit and gets a new generation. Restored/revoked
  invitation or approval receipts never revive membership.
- Work meetings additionally require current full membership in the exact
  Project/Team/Company source; no grant-only, unrelated child/associated
  context, Company/platform admin bypass or implicit source-to-meeting admission.
- Work organizers must also have existing management authority: Project
  Owner/Admin/Manager; Team Owner/Admin/Lead; Company-root Owner/Org Admin.
  Delegating organizer status requires the same current source authority.
  Role alone never grants new meeting-content access.
- Accepted participants read the meeting's currently authorized agenda,
  minutes/decisions and attachments. Accepted non-Viewer participants may add
  agenda proposals and draft contributions; organizers manage schedule,
  invitations, selected agenda and workflow. Viewers read and manage their own
  RSVP only; they cannot change shared content or approve.
- A meeting is a discrete shared document, not a chat history: explicit
  admission grants its current agenda and published minutes/decisions, including
  a currently published version finalized before that admission. Withdrawn
  drafts/private review notes do not become readable through re-admission.
- Existing Team Calendar event/agenda visibility remains as approved by ADR 0033. Extending an old Team meeting protects only the new full meeting
  content; old source-readable scheduling/agenda is not made private.
- Independent organizer departure does not silently promote another participant
  or transfer custody. Remaining admitted participants retain authorized reads;
  shared edits requiring an organizer stop until an authorized organizer exists.
  Account closure/erasure remains available and shared content stays protected
  by existing retention/disposal safeguards, without implementing P5-06.

Alternative: all current full source members can read work-meeting full content
without meeting acceptance; independent meetings still need named acceptance.
This exposes minutes/files/decisions to nonattendees and future source members.
An explicit owner choice is necessary before this broader disclosure is added.

## Decision 2: Exact-version minutes approval and Task publication

**Approved: one designated separate reviewer, immutable final versions and
explicit action-item release.**

- Organizers select one named current accepted non-Viewer reviewer who differs
  from the author submitting the minutes. Reviewer designation grants no other
  management or source rights. Reviewer must stay eligible when approving and
  when finalization occurs; stale admission, role loss, withdrawal, source
  revocation or restore invalidates pending approval authority.
- DRAFT → IN_REVIEW → APPROVED → FINAL operates on an exact immutable submitted
  version (agenda/minutes/decisions/action items and attachment IDs). Only the
  designated reviewer approves/rejects with a reason; an organizer finalizes the
  exact approved version. Rejection returns to a new draft; changing reviewed
  content requires a new version and approval. Published final versions cannot
  be silently edited; a correction is a separately approved replacement.
- An owner-only independent/personal meeting may explicitly self-finalize.
  Once another participant is admitted, the separate-reviewer rule applies.
  No automatic vote, majority/quorum, generic approval engine or silent timeout
  approval is introduced.
- Participants see authorized agenda and published final versions. Draft/review
  notes are limited to organizers, explicit draft contributors and the named
  reviewer. Reading a draft is not authorization to disclose it elsewhere.
- Conversion/linking is explicit, idempotent and uses the Tasks owner's public
  contract. Only approved final action items may create a Task. The caller must
  still have current meeting access and destination Task creation authority.
- Work action-item conversion stays in the meeting's exact source. It additionally
  requires an organizer's explicit release of the exact action-item text to that
  source's Task audience; this may be broader than meeting participation and must
  never happen merely because the minutes were approved.
- Independent action items may be copied only to the explicitly requesting
  participant's Personal Tasks. A private Task link/body is visible only to its
  current authorized owner, not automatically to other meeting participants.
  Existing Task association is checked independently and never grants Task access.
  No automatic assignment or duplicate Task engine is added.

Alternative: an organizer may approve/finalize their own minutes in every meeting.
The exact-version, immutable final, disclosure-release and Task permission rules
remain. This removes independent review and requires an explicit owner decision.

## Decision 3: Announcement targeting and acknowledgement privacy

**Approved: publication-time target snapshot and aggregate-only acknowledgement.**

- Scope is the exact Project/Team/Company root, without global/DM/social broadcast.
  Existing source management roles from Decision 1 create, publish, withdraw and
  pin announcements. Drafts are manager-only; publication is explicit.
- A publication targets either named current full member generations, or a
  snapshot of all eligible current full members when published. Viewer recipients
  can read and optionally acknowledge; grant-only users are excluded. New/rejoined
  members receive no old publication through a previous generation. Current
  source eligibility is rechecked on lists, reads, counts and acknowledgements.
- Published text/attachment identity and target snapshot are immutable per
  version. Editing requires a new explicit publication; withdrawal removes current
  access and cancels eligibility. Pinning does not broaden the audience.
- Acknowledgement is optional per publication, explicit, personal and idempotent.
  Fetching a page, a download, a message receipt or a Push acceptance never counts.
  Only authorized source managers see aggregate eligible/acknowledged counts;
  recipients see their own acknowledgement. No reader list, individual timestamps,
  general last-seen state or shared read-activity feed is exposed.
- A new publication version starts its own acknowledgement set. Departure,
  closure, stale generation and revocation remove eligibility/contribution.
  Personal erasure clears personal acknowledgement state while preserving
  necessary shared publication content under existing lifecycle safeguards.
- Invitation and announcement discovery use authenticated REST polling.
  Existing Messaging/Web Push contracts and approved chat event/consent policy
  stay intact; no meeting/announcement body or new event is silently added to Push.

Alternative: source managers may additionally see the named current publication
recipients who explicitly acknowledged. That is identifiable activity disclosure;
it requires explicit owner approval and still cannot be inferred from reads.

## Unaffected engineering work

Verify/preserve the accepted publication and protected files/databases; snapshot
the isolated baseline; freeze all P5-03 API signatures; prepare bounded owner
contracts and the acceptance/security matrix. All three policy decisions are now
closed; proceed with their implementation without a further routine approval.

Implementation will reuse authoritative Calendar/Tasks/StoragePort and public
source facades, current account/custody/session fences, typed relationships,
optimistic concurrency, durable idempotency and metadata-only audit/outbox.
No new library/provider, deployment, Shared activation, P5-04 or P5-06 is authorized.
P5-05 stays unstaged, uncommitted and unpushed.
