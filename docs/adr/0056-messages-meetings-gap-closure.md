# 0056: Messages and Meetings gap closure

Status: owner-approved implementation scope, 2026-11-17, through the explicit
P5-GAP-CLOSURE request. No deployment, Shared activation, development-database
migration, commit, push or Phase 6 work is authorized.

Reuse ADRs 0044–0049. Channels remain Conversations with explicit accepted
ConversationMember admissions and current exact-source authority. User IDs,
ContextAccess IDs, actor IDs and ConversationMember IDs remain distinct.
Existing receipt-sharing, contact blocking and notification preferences implement
MB-3; no new initiation audience, preview disclosure or privacy default is approved.
Independent Meetings implement Personal invitations without Personal Space access.
Add an organizer-only invitation ledger view; recipient discovery remains unchanged.

Announcements retain DRAFT/PUBLISHED/WITHDRAWN version states. A separate durable
schedule has SCHEDULED/CANCELED/PUBLISHED status and captures the scheduling
manager's exact admission and restore generation. Execution rechecks that manager,
source lifecycle, version revision and attachments inside the existing custody
fence. ALL snapshots current eligible members at publication; NAMED retains the
explicitly selected admission generations and fails closed if any are invalid.
No role audience or new approval workflow is introduced. Cancellation prevents
publication; rescheduling requires a new revision and explicit authority. Existing
metadata-only outbox effects and authenticated polling remain authoritative; no
new external Push event is approved. The existing pg-boss worker's maintenance
callback sweeps due durable rows after restart. An obsolete/unauthorized schedule
cannot publish; an explicit authorized reschedule is required to replace it.

Advanced agenda details extend existing stable entries and UUID ordering. Planned
duration is nullable positive integer minutes (PostgreSQL integer bound), without
an inferred duration. Totals cover ACCEPTED entries; excess over timed meeting
length is advisory. Existing source non-Viewer accepted participants may contribute
shared notes; organizers manage duration/completion, consistent with selected-agenda
management. Each changed detail stores an immutable revision, actor admission and
server timestamp. Final/reviewed minutes remain immutable snapshots; agenda detail
changes stop while a submitted/approved/final version exists. No Task completion,
meeting completion, calendar resizing or implicit attachment sharing occurs.

Operational retention and malware gates remain unchanged. Additive migration
verification and application are limited to isolated mehran_test. P5-04 is
DEFERRED BY OWNER.

## Finalization authorization amendment — 2026-11-17

The owner subsequently approved P5-GAP-CLOSURE and explicitly authorized normal
M075/M076 development deployment only if read-only investigation conclusively
dismissed the reported historical checksum discrepancies. That condition was met:
the comparison had incorrectly included two old rolled-back attempts; all 99
successful development entries matched canonical SQL and verified baselines.
The [integrity checkpoint](../p5-database-integrity-checkpoint.md) records the
evidence, successful normal Prisma deployment and both 101-migration ledgers.
Historical SQL, checksums and rollback records remain unchanged.

The owner also authorized the approved P5 commit and normal push to origin/main
after that success, with the exact message in the checkpoint. No tests, quality
gates or rehearsals may be rerun in this finalization. This amendment grants no
Shared activation, frontend changes, production/staging access, production
deployment, realtime features or Phase 6 implementation.
